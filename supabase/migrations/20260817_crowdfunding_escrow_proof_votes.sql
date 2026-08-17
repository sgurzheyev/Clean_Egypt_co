-- ============================================================================
-- Crowdfunding escrow proof votes (R2 video → awaiting_approval)
-- Paste into Supabase SQL Editor. P2P missions keep in_progress → review.
-- Statuses (lowercase, matches existing missions.status): awaiting_approval,
-- approved, failed.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) mission_proof_votes — one donor, one vote per mission
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mission_proof_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  voter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_approved boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mission_id, voter_id)
);

COMMENT ON TABLE public.mission_proof_votes IS
  'Crowdfunding donor votes on R2 proof video. First vote decides approved vs failed.';

CREATE INDEX IF NOT EXISTS idx_mission_proof_votes_mission_id
  ON public.mission_proof_votes (mission_id, created_at DESC);

ALTER TABLE public.mission_proof_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mission_proof_votes_select_participants ON public.mission_proof_votes;
CREATE POLICY mission_proof_votes_select_participants
  ON public.mission_proof_votes
  FOR SELECT TO authenticated
  USING (
    voter_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.missions m
      WHERE m.id = mission_id
        AND (m.creator_id = auth.uid() OR m.cleaner_id = auth.uid())
    )
    OR EXISTS (
      SELECT 1
      FROM public.contributions c
      WHERE c.mission_id = mission_proof_votes.mission_id
        AND c.contributor_id = auth.uid()
    )
  );

REVOKE ALL ON public.mission_proof_votes FROM PUBLIC;
GRANT SELECT ON public.mission_proof_votes TO authenticated;
GRANT ALL ON public.mission_proof_votes TO service_role;

CREATE INDEX IF NOT EXISTS idx_missions_awaiting_approval_submitted
  ON public.missions (report_submitted_at)
  WHERE lower(coalesce(status::text, '')) = 'awaiting_approval'
    AND coalesce(crowdfunding_mode, false) = true;

-- ---------------------------------------------------------------------------
-- 2) submit_mission_proof — crowd → awaiting_approval (video required);
--    P2P unchanged → review (photos required)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_mission_proof(
  p_mission_id uuid,
  p_after_photo_urls text[],
  p_worker_lat double precision,
  p_worker_lng double precision,
  p_completion_distance_meters integer DEFAULT NULL,
  p_proof_video_url text DEFAULT NULL,
  p_liveness_lat double precision DEFAULT NULL,
  p_liveness_lng double precision DEFAULT NULL,
  p_completion_lat double precision DEFAULT NULL,
  p_completion_lng double precision DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_mission record;
  v_mission_loc geography;
  v_worker_lat double precision;
  v_worker_lng double precision;
  v_distance_m double precision;
  v_is_crowd boolean;
  v_video text;
  v_photos text[];
  v_new_status text;
  n integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_worker_lat := coalesce(p_completion_lat, p_worker_lat);
  v_worker_lng := coalesce(p_completion_lng, p_worker_lng);

  IF v_worker_lat IS NULL OR v_worker_lng IS NULL
     OR NOT (v_worker_lat BETWEEN -90 AND 90)
     OR NOT (v_worker_lng BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'Valid worker GPS coordinates are required';
  END IF;

  SELECT *
  INTO v_mission
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  IF v_mission.cleaner_id IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'Only the assigned cleaner can submit proof';
  END IF;

  IF lower(coalesce(v_mission.status::text, '')) <> 'in_progress' THEN
    RAISE EXCEPTION 'Mission is not in progress';
  END IF;

  v_is_crowd := coalesce(v_mission.crowdfunding_mode, false);
  v_video := nullif(trim(coalesce(p_proof_video_url, '')), '');
  v_photos := coalesce(p_after_photo_urls, ARRAY[]::text[])[1:9];

  IF v_is_crowd THEN
    IF v_video IS NULL THEN
      RAISE EXCEPTION 'Proof video is required for crowdfunding missions';
    END IF;
    v_new_status := 'awaiting_approval';
  ELSE
    IF v_photos IS NULL OR cardinality(v_photos) < 1 THEN
      RAISE EXCEPTION 'At least one proof photo is required';
    END IF;
    v_new_status := 'review';
  END IF;

  IF v_mission.location IS NOT NULL THEN
    v_mission_loc := v_mission.location;
  ELSIF v_mission.location_lat IS NOT NULL AND v_mission.location_lng IS NOT NULL THEN
    v_mission_loc := ST_SetSRID(
      ST_MakePoint(v_mission.location_lng, v_mission.location_lat),
      4326
    )::geography;
  ELSE
    RAISE EXCEPTION 'Mission location is missing; cannot verify GPS integrity';
  END IF;

  v_distance_m := ST_Distance(
    v_mission_loc,
    ST_SetSRID(ST_MakePoint(v_worker_lng, v_worker_lat), 4326)::geography
  );

  IF v_distance_m > 200 THEN
    RAISE EXCEPTION 'GPS integrity failed: too far from mission';
  END IF;

  UPDATE public.missions m
  SET
    after_photo_urls = CASE
      WHEN v_is_crowd THEN COALESCE(v_photos, m.after_photo_urls)
      ELSE v_photos
    END,
    completion_lat = coalesce(p_completion_lat, p_worker_lat, m.completion_lat),
    completion_lng = coalesce(p_completion_lng, p_worker_lng, m.completion_lng),
    completion_distance_meters = round(v_distance_m)::integer,
    proof_video_url = CASE
      WHEN v_video IS NULL THEN m.proof_video_url
      ELSE v_video
    END,
    liveness_lat = coalesce(p_liveness_lat, p_worker_lat, m.liveness_lat),
    liveness_lng = coalesce(p_liveness_lng, p_worker_lng, m.liveness_lng),
    report_submitted_at = now(),
    status = v_new_status,
    rejection_reason = NULL,
    auto_approved = false,
    location = coalesce(m.location, v_mission_loc),
    proof_events = coalesce(m.proof_events, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'type', 'proof_submitted',
        'at', now(),
        'by', uid,
        'distance_m', round(v_distance_m)::integer,
        'status', v_new_status,
        'has_video', v_video IS NOT NULL
      )
    )
  WHERE m.id = p_mission_id
    AND m.cleaner_id = uid
    AND lower(coalesce(m.status::text, '')) = 'in_progress';

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RAISE EXCEPTION 'Mission not found or not eligible for proof submission';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_mission_proof(
  uuid, text[], double precision, double precision, integer, text, double precision, double precision,
  double precision, double precision
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_mission_proof(
  uuid, text[], double precision, double precision, integer, text, double precision, double precision,
  double precision, double precision
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_mission_proof(
  uuid, text[], double precision, double precision, integer, text, double precision, double precision,
  double precision, double precision
) TO service_role;

COMMENT ON FUNCTION public.submit_mission_proof(
  uuid, text[], double precision, double precision, integer, text, double precision, double precision,
  double precision, double precision
) IS
  'Worker-only. P2P: photos → review. Crowdfunding: R2 proof_video_url → awaiting_approval. GPS ≤200m.';

-- P2P 3-day auto-complete must not swallow crowdfunding escrow missions.
CREATE OR REPLACE FUNCTION public.process_stuck_reviews()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH stuck AS (
    UPDATE public.missions m
    SET
      status = 'completed',
      auto_approved = true,
      proof_events = coalesce(m.proof_events, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'type', 'auto_approved_timeout',
          'at', now()
        )
      )
    WHERE lower(coalesce(m.status::text, '')) IN ('review', 'pending_approval')
      AND coalesce(m.crowdfunding_mode, false) = false
      AND coalesce(m.report_submitted_at, m.updated_at) < (now() - interval '3 days')
    RETURNING m.id
  )
  SELECT count(*)::integer INTO v_count FROM stuck;

  RETURN coalesce(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.process_stuck_reviews() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_stuck_reviews() TO service_role;

-- ---------------------------------------------------------------------------
-- 3) process_proof_vote — first donor vote decides approved / failed
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

  INSERT INTO public.mission_proof_votes (mission_id, voter_id, is_approved)
  VALUES (p_mission_id, uid, p_is_approved)
  RETURNING id INTO v_vote_id;

  v_new_status := CASE WHEN p_is_approved THEN 'approved' ELSE 'failed' END;

  UPDATE public.missions m
  SET
    status = v_new_status,
    auto_approved = false,
    rejection_reason = CASE
      WHEN p_is_approved THEN NULL
      ELSE 'Donor rejected proof (fraud / poor work)'
    END,
    proof_events = coalesce(m.proof_events, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'type', CASE WHEN p_is_approved THEN 'donor_approved' ELSE 'donor_rejected' END,
        'at', now(),
        'by', uid,
        'vote_id', v_vote_id,
        'status', v_new_status
      )
    )
  WHERE m.id = p_mission_id
    AND lower(coalesce(m.status::text, '')) = 'awaiting_approval';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission is not awaiting donor approval';
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
  'Donor-only. First vote on awaiting_approval crowdfunding proof → approved (true) or failed (false).';

-- ---------------------------------------------------------------------------
-- 4) auto_approve_escrow_proofs — 24h fallback awaiting_approval → approved
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auto_approve_escrow_proofs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH expired AS (
    UPDATE public.missions m
    SET
      status = 'approved',
      auto_approved = true,
      rejection_reason = NULL,
      proof_events = coalesce(m.proof_events, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'type', 'escrow_auto_approved',
          'at', now(),
          'reason', 'awaiting_approval_idle_24h'
        )
      )
    WHERE coalesce(m.crowdfunding_mode, false) = true
      AND lower(coalesce(m.status::text, '')) = 'awaiting_approval'
      AND coalesce(m.report_submitted_at, m.updated_at) < (now() - interval '24 hours')
    RETURNING m.id
  )
  SELECT count(*)::integer INTO v_count FROM expired;

  RETURN coalesce(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.auto_approve_escrow_proofs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_approve_escrow_proofs() TO service_role;

COMMENT ON FUNCTION public.auto_approve_escrow_proofs() IS
  'Service-role / pg_cron: crowdfunding awaiting_approval idle >24h since report_submitted_at → approved.';

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-approve-escrow-proofs') THEN
    PERFORM cron.unschedule('auto-approve-escrow-proofs');
  END IF;

  PERFORM cron.schedule(
    'auto-approve-escrow-proofs',
    '20 * * * *',
    $cron$SELECT public.auto_approve_escrow_proofs();$cron$
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE
      'pg_cron not available (%). Call auto_approve_escrow_proofs() via external cron / Edge.',
      SQLERRM;
END $$;
