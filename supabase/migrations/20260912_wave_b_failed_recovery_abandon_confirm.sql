-- ============================================================================
-- Wave B — P1-1 failed recovery + P1-2 crowd abandon exclude + P3-3 confirm RPC
-- ============================================================================
-- APPLY (remote CLI history is out of sync — do NOT rely on `supabase db push`
-- to replay older files). Paste this entire file into the Supabase SQL Editor
-- (or `psql` as a privileged role) AFTER
-- `20260912_overfund_refund_and_creator_convert.sql` (PR #4 / Wave A).
-- Safe to re-run: CREATE OR REPLACE / DELETE+UPDATE keyed by current status.
--
-- P1-1: first donor "no" must NOT set status=failed forever. Paid pots have no
-- refund / Gov Notice on failed, and the cleaner cannot re-upload. Chosen rule
-- (product-consistent with P2P creator_reject_proof): reject → in_progress,
-- keep cleaner_id, clear proof, increment retry_count. First *approve* still
-- closes the job (plus 24h auto_approve_escrow_proofs). Quorum-to-fail was
-- rejected — it still ends in a dead-end failed with no money unwind.
--
-- P1-2: process_abandoned_missions must not silently re-tender funded
-- crowdfunding in_progress (clears cleaner → available). P2P 24h abandon is
-- unchanged. Explicit crowd re-tender (donor notify) is a later wave.
--
-- P3-3: confirm_mission_work_done (and its confirm_mission_direct_payment
-- body) lived only under supabase/migrations/archive/. Profile.tsx still
-- calls confirm_mission_work_done to close P2P. Recreate both in the active
-- tree with the archived security/behavior.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- P1-1) process_proof_vote — approve still first-yes; reject retries
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.process_proof_vote(
  p_mission_id uuid,
  p_is_approved boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_mission record;
  v_new_status text;
  v_vote_id uuid;
  v_already uuid;
  n integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_is_approved IS NULL THEN
    RAISE EXCEPTION 'is_approved is required';
  END IF;

  SELECT *
  INTO v_mission
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  IF NOT coalesce(v_mission.crowdfunding_mode, false) THEN
    RAISE EXCEPTION 'Votes are only for crowdfunding missions';
  END IF;

  IF lower(coalesce(v_mission.status::text, '')) <> 'awaiting_approval' THEN
    RAISE EXCEPTION 'Mission is not awaiting donor approval';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.contributions c
    WHERE c.mission_id = p_mission_id
      AND c.contributor_id = uid
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Only donors can vote on this proof';
  END IF;

  SELECT id INTO v_already
  FROM public.mission_proof_votes
  WHERE mission_id = p_mission_id
  LIMIT 1;

  IF v_already IS NOT NULL THEN
    RAISE EXCEPTION 'This proof has already been decided';
  END IF;

  IF p_is_approved THEN
    INSERT INTO public.mission_proof_votes (mission_id, voter_id, is_approved)
    VALUES (p_mission_id, uid, true)
    RETURNING id INTO v_vote_id;

    v_new_status := 'approved';

    UPDATE public.missions m
    SET
      status = v_new_status,
      auto_approved = false,
      rejection_reason = NULL,
      proof_events = coalesce(m.proof_events, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'type', 'donor_approved',
          'at', now(),
          'by', uid,
          'vote_id', v_vote_id,
          'status', v_new_status
        )
      )
    WHERE m.id = p_mission_id
      AND lower(coalesce(m.status::text, '')) = 'awaiting_approval';

    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN
      RAISE EXCEPTION 'Mission is not awaiting donor approval';
    END IF;

    IF v_mission.cleaner_id IS NOT NULL THEN
      PERFORM public.create_notification(
        v_mission.cleaner_id,
        'mission_approved',
        p_mission_id,
        uid,
        'Work approved',
        'A donor approved your proof video.'
      );
    END IF;
  ELSE
    -- Recoverable reject (P2P creator_reject_proof shape). Do not persist a
    -- deciding vote row — the next proof is a new vote window.
    DELETE FROM public.mission_proof_votes
    WHERE mission_id = p_mission_id;

    v_new_status := 'in_progress';

    UPDATE public.missions m
    SET
      status = v_new_status,
      after_photo_urls = NULL,
      proof_video_url = NULL,
      report_submitted_at = NULL,
      completion_lat = NULL,
      completion_lng = NULL,
      completion_distance_meters = NULL,
      liveness_lat = NULL,
      liveness_lng = NULL,
      rejection_reason = 'Donor rejected proof — re-upload required',
      auto_approved = false,
      retry_count = coalesce(m.retry_count, 0) + 1,
      proof_events = coalesce(m.proof_events, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'type', 'donor_rejected',
          'at', now(),
          'by', uid,
          'status', v_new_status,
          'recoverable', true
        )
      )
    WHERE m.id = p_mission_id
      AND lower(coalesce(m.status::text, '')) = 'awaiting_approval';

    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN
      RAISE EXCEPTION 'Mission is not awaiting donor approval';
    END IF;

    IF v_mission.cleaner_id IS NOT NULL THEN
      PERFORM public.create_notification(
        v_mission.cleaner_id,
        'proof_rejected',
        p_mission_id,
        uid,
        'Proof rejected',
        'A donor asked you to re-upload proof. The job and pot are still yours.'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'mission_id', p_mission_id,
    'vote_id', v_vote_id,
    'is_approved', p_is_approved,
    'status', v_new_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_proof_vote(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_proof_vote(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_proof_vote(uuid, boolean) TO service_role;

COMMENT ON FUNCTION public.process_proof_vote(uuid, boolean) IS
  'Donor-only. First approve on awaiting_approval → approved. First reject → in_progress (cleaner kept; proof cleared). Never writes failed.';

COMMENT ON TABLE public.mission_proof_votes IS
  'Crowdfunding donor votes on the current R2 proof video. An approve row closes the job. Rejects do not persist — they open a new proof round.';

-- Recover crowd jobs already stuck in failed (first-no-wins era).
DELETE FROM public.mission_proof_votes v
USING public.missions m
WHERE v.mission_id = m.id
  AND coalesce(m.crowdfunding_mode, false) = true
  AND lower(coalesce(m.status::text, '')) = 'failed';

UPDATE public.missions m
SET
  status = 'in_progress',
  after_photo_urls = NULL,
  proof_video_url = NULL,
  report_submitted_at = NULL,
  completion_lat = NULL,
  completion_lng = NULL,
  completion_distance_meters = NULL,
  liveness_lat = NULL,
  liveness_lng = NULL,
  rejection_reason = coalesce(
    nullif(trim(m.rejection_reason), ''),
    'Donor rejected proof — re-upload required'
  ),
  auto_approved = false,
  retry_count = coalesce(m.retry_count, 0) + 1,
  proof_events = coalesce(m.proof_events, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'type', 'donor_reject_recovered',
      'at', now(),
      'previous_status', 'failed',
      'status', 'in_progress'
    )
  )
WHERE coalesce(m.crowdfunding_mode, false) = true
  AND lower(coalesce(m.status::text, '')) = 'failed'
  AND m.cleaner_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- P1-2) process_abandoned_missions — P2P only (keep funded cleaner lock)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.process_abandoned_missions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH abandoned AS (
    UPDATE public.missions m
    SET
      status = 'available',
      cleaner_id = NULL,
      started_at = NULL,
      after_photo_urls = NULL,
      proof_video_url = NULL,
      report_submitted_at = NULL,
      completion_lat = NULL,
      completion_lng = NULL,
      completion_distance_meters = NULL,
      liveness_lat = NULL,
      liveness_lng = NULL,
      rejection_reason = NULL,
      auto_approved = false,
      proof_events = coalesce(m.proof_events, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'type', 'abandoned_timeout',
          'at', now(),
          'previous_cleaner_id', m.cleaner_id,
          'in_progress_since', m.status_changed_at
        )
      )
    WHERE lower(coalesce(m.status::text, '')) = 'in_progress'
      AND coalesce(m.crowdfunding_mode, false) = false
      AND coalesce(m.status_changed_at, m.started_at, m.updated_at) < (now() - interval '24 hours')
    RETURNING m.id
  )
  SELECT count(*)::integer INTO v_count FROM abandoned;

  RETURN coalesce(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.process_abandoned_missions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_abandoned_missions() TO service_role;

COMMENT ON FUNCTION public.process_abandoned_missions() IS
  'Service-role / pg_cron: P2P in_progress idle >24h since status_changed_at → available (clears cleaner). Crowdfunding is excluded (P1-2) so a funded cleaner lock is not silently undone.';

-- ---------------------------------------------------------------------------
-- P3-3) P2P confirm RPCs (from archive/20260614 + archive/20260615)
-- Profile.tsx → supabase.rpc('confirm_mission_work_done', { p_mission_id })
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_mission_direct_payment(p_mission_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mission record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT *
  INTO v_mission
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  IF v_mission.creator_id IS NULL OR v_mission.creator_id <> v_uid THEN
    RAISE EXCEPTION 'Only the mission creator can confirm payment';
  END IF;

  IF lower(coalesce(v_mission.status::text, '')) NOT IN ('review', 'pending_approval') THEN
    RAISE EXCEPTION 'Mission is not awaiting client review';
  END IF;

  IF v_mission.cleaner_id IS NULL THEN
    RAISE EXCEPTION 'No worker assigned';
  END IF;

  UPDATE public.missions
  SET
    status = 'completed',
    is_disputed = false
  WHERE id = p_mission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_mission_direct_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_mission_direct_payment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_mission_direct_payment(uuid) TO service_role;

COMMENT ON FUNCTION public.confirm_mission_direct_payment(uuid) IS
  'Creator-only P2P close: review / pending_approval → completed. No wallet / escrow move. Archived 20260614 body, now in the active tree (P3-3).';

CREATE OR REPLACE FUNCTION public.confirm_mission_work_done(p_mission_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.confirm_mission_direct_payment(p_mission_id);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_mission_work_done(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_mission_work_done(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_mission_work_done(uuid) TO service_role;

COMMENT ON FUNCTION public.confirm_mission_work_done(uuid) IS
  'Profile P2P “work done” alias. Calls confirm_mission_direct_payment. Recreated from archive/20260615 (P3-3).';
