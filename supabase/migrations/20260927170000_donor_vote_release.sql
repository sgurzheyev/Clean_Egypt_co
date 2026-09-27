-- ============================================================================
-- Donor vote is the only release of crowdfund donations.
-- ----------------------------------------------------------------------------
-- Apply after 20260927160000. Do not db push. Do not edit the earlier files.
--
-- Regular missions are SaaS: the client pays the worker off-platform.
-- confirm_mission_work_done still only sets status=completed. It does not
-- move USD or token donations.
--
-- Crowdfunded public cleanup holds Stripe USD (current_funding) and token
-- gifts (token_donations status=held). Those are released to cleaner_id
-- only when a donor approves the proof through process_proof_vote(true):
--   tokens  → payout_held_token_donations, 1:1, no bonus
--   USD     → one row in crowdfund_donation_releases for floor(current_funding)
--             There is no Stripe transfer in this repo. The row is the
--             authorization to pay the worker. current_funding stays as raised.
-- status=completed does not release. auto_approved does not release.
--
-- Not cleaned (donor reject, or awaiting_approval with no approve for 24h
-- after report_submitted_at):
--   Stripe cards are not refunded.
--   Stripe donors get the closed-economy token credit ($100 → 6000 at defaults).
--   Held token gifts refund at floor(tokens * 120 / 100).
--   city_notification_events crowdfunding_expired queues the municipal PDF.
--   status=expired, donation_settlement=retained, cleaner unlocked.
-- The historical function auto_approve_escrow_proofs keeps its name and cron
-- so the existing job stops auto-approving and runs this unwind instead.
-- ============================================================================

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS donation_settlement text;

UPDATE public.missions
   SET donation_settlement = 'held'
 WHERE donation_settlement IS NULL;

ALTER TABLE public.missions
  ALTER COLUMN donation_settlement SET DEFAULT 'held';

ALTER TABLE public.missions
  ALTER COLUMN donation_settlement SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'missions_donation_settlement_check'
      AND conrelid = 'public.missions'::regclass
  ) THEN
    ALTER TABLE public.missions
      ADD CONSTRAINT missions_donation_settlement_check
      CHECK (donation_settlement IN ('held', 'released', 'retained'));
  END IF;
END $$;

COMMENT ON COLUMN public.missions.donation_settlement IS
  'Crowdfund donations: held until a donor yes, released to the worker, or retained after a not-cleaned unwind. Regular missions stay held and are not a platform payout.';

REVOKE UPDATE (donation_settlement) ON TABLE public.missions FROM PUBLIC;
REVOKE UPDATE (donation_settlement) ON TABLE public.missions FROM anon;
REVOKE UPDATE (donation_settlement) ON TABLE public.missions FROM authenticated;

CREATE TABLE IF NOT EXISTS public.crowdfund_donation_releases (
  mission_id uuid PRIMARY KEY,
  cleaner_id uuid NOT NULL,
  amount_usd integer NOT NULL CHECK (amount_usd >= 0),
  tokens_paid integer NOT NULL DEFAULT 0 CHECK (tokens_paid >= 0),
  vote_id uuid,
  released_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.crowdfund_donation_releases IS
  'Authorization to pay the locked worker the donated USD and the token gifts already credited 1:1. Written only after a donor approve vote. Not a Stripe transfer.';

ALTER TABLE public.crowdfund_donation_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crowdfund_donation_releases FROM PUBLIC;
REVOKE ALL ON TABLE public.crowdfund_donation_releases FROM anon;
REVOKE ALL ON TABLE public.crowdfund_donation_releases FROM authenticated;

-- Block clients from marking a pot released.
CREATE OR REPLACE FUNCTION public.protect_mission_lifecycle_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  n jsonb := to_jsonb(NEW);
  o jsonb := to_jsonb(OLD);
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     OR current_user IN ('postgres', 'supabase_admin')
     OR pg_catalog.pg_has_role(current_user, 'postgres', 'member')
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (n->>'status') IS DISTINCT FROM (o->>'status')
       OR (n->>'cleaner_id') IS DISTINCT FROM (o->>'cleaner_id')
       OR (n->>'creator_id') IS DISTINCT FROM (o->>'creator_id')
       OR (n->>'current_funding') IS DISTINCT FROM (o->>'current_funding')
       OR (n->>'expected_price') IS DISTINCT FROM (o->>'expected_price')
       OR (n->>'amount_target') IS DISTINCT FROM (o->>'amount_target')
       OR (n->>'target_funding') IS DISTINCT FROM (o->>'target_funding')
       OR (n->>'crowdfunding_mode') IS DISTINCT FROM (o->>'crowdfunding_mode')
       OR (n->>'crowdfunding_expires_at') IS DISTINCT FROM (o->>'crowdfunding_expires_at')
       OR (n->>'accepted_bid_id') IS DISTINCT FROM (o->>'accepted_bid_id')
       OR (n->>'is_report') IS DISTINCT FROM (o->>'is_report')
       OR (n->>'donation_settlement') IS DISTINCT FROM (o->>'donation_settlement')
    THEN
      RAISE EXCEPTION
        'Direct modification of protected mission lifecycle and economy fields is forbidden. Use designated RPCs.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_crowdfund_donations(p_mission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_mission public.missions%ROWTYPE;
  v_vote uuid;
  v_tokens integer := 0;
  v_usd integer := 0;
BEGIN
  IF p_mission_id IS NULL THEN
    RETURN jsonb_build_object('released', false, 'reason', 'missing_mission');
  END IF;

  SELECT *
    INTO v_mission
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('released', false, 'reason', 'missing_mission');
  END IF;

  IF NOT coalesce(v_mission.crowdfunding_mode, false) THEN
    RETURN jsonb_build_object('released', false, 'reason', 'not_crowdfunding');
  END IF;

  IF coalesce(v_mission.donation_settlement, 'held') = 'released' THEN
    RETURN jsonb_build_object('released', true, 'reason', 'already_released');
  END IF;

  IF coalesce(v_mission.donation_settlement, 'held') = 'retained' THEN
    RETURN jsonb_build_object('released', false, 'reason', 'already_retained');
  END IF;

  IF lower(coalesce(v_mission.status::text, '')) <> 'approved'
     OR coalesce(v_mission.auto_approved, false) THEN
    RETURN jsonb_build_object('released', false, 'reason', 'not_donor_approved');
  END IF;

  SELECT v.id
    INTO v_vote
  FROM public.mission_proof_votes v
  WHERE v.mission_id = p_mission_id
    AND v.is_approved = true
  ORDER BY v.created_at
  LIMIT 1;

  IF v_vote IS NULL THEN
    RETURN jsonb_build_object('released', false, 'reason', 'no_approve_vote');
  END IF;

  IF v_mission.cleaner_id IS NULL THEN
    RAISE EXCEPTION 'Crowdfund release requires an assigned worker';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = v_mission.cleaner_id
  ) THEN
    RAISE EXCEPTION 'Assigned worker has no profile';
  END IF;

  v_tokens := public.payout_held_token_donations(p_mission_id);
  v_usd := GREATEST(floor(coalesce(v_mission.current_funding, 0))::integer, 0);

  INSERT INTO public.crowdfund_donation_releases (
    mission_id, cleaner_id, amount_usd, tokens_paid, vote_id
  )
  VALUES (p_mission_id, v_mission.cleaner_id, v_usd, coalesce(v_tokens, 0), v_vote)
  ON CONFLICT (mission_id) DO NOTHING;

  UPDATE public.missions
     SET donation_settlement = 'released'
   WHERE id = p_mission_id
     AND donation_settlement IS DISTINCT FROM 'released';

  RETURN jsonb_build_object(
    'released', true,
    'amount_usd', v_usd,
    'tokens_paid', coalesce(v_tokens, 0),
    'vote_id', v_vote
  );
END;
$$;

REVOKE ALL ON FUNCTION public.release_crowdfund_donations(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_crowdfund_donations(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.release_crowdfund_donations(uuid) FROM authenticated;

COMMENT ON FUNCTION public.release_crowdfund_donations(uuid) IS
  'Pays held token gifts 1:1 to cleaner_id and records the donated USD as payable. Requires status=approved, auto_approved=false, and a yes row in mission_proof_votes.';

-- Reject or a missed vote deadline. Same economics as an unfinished expiry.
CREATE OR REPLACE FUNCTION public.settle_crowdfund_as_unapproved(
  p_mission_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_mission public.missions%ROWTYPE;
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'unapproved');
  v_token_credit integer := 0;
  v_stripe_credit integer := 0;
  v_raised integer := 0;
  v_reports integer := 0;
  v_photos text[];
  v_event_id uuid;
  v_expires timestamptz;
  n integer;
BEGIN
  IF p_mission_id IS NULL THEN
    RETURN jsonb_build_object('unapproved', false, 'reason', 'missing_mission');
  END IF;

  SELECT *
    INTO v_mission
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('unapproved', false, 'reason', 'missing_mission');
  END IF;

  IF coalesce(v_mission.donation_settlement, 'held') = 'released' THEN
    RETURN jsonb_build_object('unapproved', false, 'reason', 'already_released');
  END IF;

  IF coalesce(v_mission.donation_settlement, 'held') = 'retained'
     OR lower(coalesce(v_mission.status::text, '')) IN ('expired', 'hidden', 'archived', 'cancelled') THEN
    RETURN jsonb_build_object('unapproved', true, 'reason', 'already_unapproved');
  END IF;

  IF NOT coalesce(v_mission.crowdfunding_mode, false) THEN
    RETURN jsonb_build_object('unapproved', false, 'reason', 'not_crowdfunding');
  END IF;

  IF lower(coalesce(v_mission.status::text, '')) <> 'awaiting_approval' THEN
    RETURN jsonb_build_object('unapproved', false, 'reason', 'not_awaiting_approval');
  END IF;

  -- Credits commit only if the status change lands. A lost race must not pay bonuses.
  SAVEPOINT crowdfund_unapproved;
  v_token_credit := public.refund_held_token_donations_with_bonus(p_mission_id);
  v_stripe_credit := public.credit_stripe_expiry_tokens(p_mission_id);
  v_raised := GREATEST(floor(coalesce(v_mission.current_funding, 0))::integer, 0);
  v_reports := public.closed_economy_report_count(p_mission_id);
  v_photos := public.closed_economy_notice_photos(p_mission_id);
  v_expires := coalesce(
    v_mission.crowdfunding_expires_at,
    v_mission.created_at + interval '7 days',
    now()
  );

  UPDATE public.missions
     SET status = 'expired',
         donation_settlement = 'retained',
         cleaner_id = NULL,
         rejection_reason = CASE
           WHEN v_reason = 'donor_rejected' THEN 'Donor rejected the proof. Cleanup treated as not done.'
           WHEN v_reason = 'vote_deadline' THEN 'No donor approved the proof within 24 hours.'
           ELSE 'Cleanup was not approved by donors.'
         END,
         auto_approved = false,
         history_public_until = coalesce(history_public_until, now() + interval '7 days'),
         proof_events = coalesce(proof_events, '[]'::jsonb) || jsonb_build_array(
           jsonb_build_object(
             'type', 'crowdfund_unapproved',
             'at', now(),
             'reason', v_reason,
             'status', 'expired'
           )
         )
   WHERE id = p_mission_id
     AND lower(coalesce(status::text, '')) = 'awaiting_approval'
     AND coalesce(donation_settlement, 'held') = 'held';

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    ROLLBACK TO SAVEPOINT crowdfund_unapproved;
    RELEASE SAVEPOINT crowdfund_unapproved;
    RETURN jsonb_build_object('unapproved', false, 'reason', 'lost_race');
  END IF;

  UPDATE public.mission_bids
     SET status = 'rejected'
   WHERE mission_id = p_mission_id
     AND lower(coalesce(status::text, '')) IN ('pending', 'accepted');

  IF NOT EXISTS (
    SELECT 1
    FROM public.city_notification_events e
    WHERE e.mission_id = p_mission_id
      AND e.event_type = 'crowdfunding_expired'
  ) THEN
    INSERT INTO public.city_notification_events (mission_id, event_type, payload, pdf_status)
    VALUES (
      p_mission_id,
      'crowdfunding_expired',
      jsonb_build_object(
        'service_type', v_mission.service_type,
        'location_lat', v_mission.location_lat,
        'location_lng', v_mission.location_lng,
        'city', v_mission.city,
        'country', v_mission.country,
        'target_budget', v_mission.expected_price,
        'raised', v_raised,
        'description', v_mission.description,
        'created_at', v_mission.created_at,
        'funding_expires_at', v_expires,
        'expired_at', now(),
        'history_public_until', now() + interval '7 days',
        'report_count', v_reports,
        'photo_urls', to_jsonb(coalesce(v_photos, ARRAY[]::text[])),
        'unapproved_reason', v_reason
      ),
      'pending'
    )
    RETURNING id INTO v_event_id;
  END IF;

  INSERT INTO public.closed_economy_expiries (
    mission_id,
    raised_usd,
    report_count,
    notice_event_id,
    stripe_tokens_credited,
    token_refund_credited
  )
  VALUES (
    p_mission_id,
    v_raised,
    v_reports,
    v_event_id,
    v_stripe_credit,
    v_token_credit
  )
  ON CONFLICT (mission_id) DO NOTHING;

  BEGIN
    PERFORM private.write_admin_audit(
      'closed_economy_expiry',
      'mission',
      p_mission_id::text,
      jsonb_build_object('status', 'awaiting_approval', 'raised_usd', v_raised),
      jsonb_build_object(
        'status', 'expired',
        'reason', v_reason,
        'raised_usd', v_raised,
        'report_count', v_reports,
        'notice_event_id', v_event_id,
        'stripe_tokens_credited', v_stripe_credit,
        'token_refund_credited', v_token_credit,
        'usd_retained', true
      )
    );
  EXCEPTION
    WHEN undefined_function OR invalid_schema_name THEN
      NULL;
  END;

  RELEASE SAVEPOINT crowdfund_unapproved;

  RETURN jsonb_build_object(
    'unapproved', true,
    'reason', v_reason,
    'stripe_tokens_credited', v_stripe_credit,
    'token_refund_credited', v_token_credit,
    'usd_retained', v_raised
  );
END;
$$;

REVOKE ALL ON FUNCTION public.settle_crowdfund_as_unapproved(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_crowdfund_as_unapproved(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.settle_crowdfund_as_unapproved(uuid, text) FROM authenticated;

COMMENT ON FUNCTION public.settle_crowdfund_as_unapproved(uuid, text) IS
  'Awaiting-approval crowdfund with no donor yes: retain USD, queue the Gov Notice PDF, credit Stripe donors and refund token gifts with the closed-economy bonus. Does not release to the worker.';

-- completed does not pay. approved + a real yes vote does.
-- expired still bonus-refunds; hide / archive / cancel stay 1:1.
CREATE OR REPLACE FUNCTION public.trg_settle_token_donations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_new text := lower(coalesce(NEW.status::text, ''));
  v_old text := lower(coalesce(OLD.status::text, ''));
BEGIN
  IF v_new IS NOT DISTINCT FROM v_old THEN
    RETURN NEW;
  END IF;

  IF v_new = 'approved'
     AND coalesce(NEW.auto_approved, false) = false
     AND coalesce(NEW.crowdfunding_mode, false)
     AND EXISTS (
       SELECT 1
       FROM public.mission_proof_votes v
       WHERE v.mission_id = NEW.id
         AND v.is_approved = true
     ) THEN
    PERFORM public.release_crowdfund_donations(NEW.id);
  ELSIF v_new = 'expired'
        AND v_old NOT IN ('hidden', 'expired', 'archived', 'cancelled', 'completed', 'approved') THEN
    PERFORM public.refund_held_token_donations_with_bonus(NEW.id);
  ELSIF v_new IN ('hidden', 'archived', 'cancelled')
        AND v_old NOT IN ('hidden', 'expired', 'archived', 'cancelled', 'completed', 'approved') THEN
    PERFORM public.refund_held_token_donations(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_settle_token_donations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_settle_token_donations() FROM anon;
REVOKE ALL ON FUNCTION public.trg_settle_token_donations() FROM authenticated;

-- Success PDF only after a donor yes. completed is not that signal.
CREATE OR REPLACE FUNCTION public.enqueue_crowdfunding_completion_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_new text := lower(coalesce(NEW.status::text, ''));
  v_old text := lower(coalesce(OLD.status::text, ''));
BEGIN
  IF coalesce(NEW.crowdfunding_mode, false)
     AND v_new = 'approved'
     AND v_old IS DISTINCT FROM v_new
     AND coalesce(NEW.auto_approved, false) = false
     AND EXISTS (
       SELECT 1
       FROM public.mission_proof_votes v
       WHERE v.mission_id = NEW.id
         AND v.is_approved = true
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.city_notification_events e
       WHERE e.mission_id = NEW.id
         AND e.event_type = 'mission_completed'
     ) THEN
    INSERT INTO public.city_notification_events (mission_id, event_type, payload, pdf_status)
    VALUES (
      NEW.id,
      'mission_completed',
      jsonb_build_object(
        'service_type', NEW.service_type,
        'location_lat', NEW.location_lat,
        'location_lng', NEW.location_lng,
        'target_budget', NEW.expected_price,
        'raised', coalesce(NEW.current_funding, 0),
        'description', NEW.description,
        'funding_expires_at', NEW.crowdfunding_expires_at,
        'completed_at', now(),
        'final_status', v_new
      ),
      'pending'
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_crowdfunding_completion_notification() IS
  'Queue mission_completed only when a crowdfund becomes approved by a donor vote. status=completed does not queue it.';

CREATE OR REPLACE FUNCTION public.process_proof_vote(
  p_mission_id uuid,
  p_is_approved boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  v_mission record;
  v_new_status text;
  v_vote_id uuid;
  v_already uuid;
  v_unwind jsonb;
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

  SELECT id
    INTO v_already
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
       SET status = v_new_status,
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
        'A donor approved your proof. Donated funds are released to you.'
      );
    END IF;
  ELSE
    INSERT INTO public.mission_proof_votes (mission_id, voter_id, is_approved)
    VALUES (p_mission_id, uid, false)
    RETURNING id INTO v_vote_id;

    v_unwind := public.settle_crowdfund_as_unapproved(p_mission_id, 'donor_rejected');
    v_new_status := 'expired';

    IF coalesce((v_unwind->>'unapproved')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'Could not close the unapproved cleanup';
    END IF;

    IF v_mission.cleaner_id IS NOT NULL THEN
      PERFORM public.create_notification(
        v_mission.cleaner_id,
        'proof_rejected',
        p_mission_id,
        uid,
        'Proof not accepted',
        'A donor rejected the proof. The cleanup is closed as not done, and donated funds are not paid out.'
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
  'Donor-only. Yes on awaiting_approval → approved and releases donated USD and tokens to the worker. No → not cleaned: PDF, token credits +20%, USD retained.';

COMMENT ON TABLE public.mission_proof_votes IS
  'One donor decision on the current crowdfund proof. A yes row releases donations. A no row closes the cleanup as not done.';

-- Historical name. The cron still calls this. It no longer sets approved.
CREATE OR REPLACE FUNCTION public.auto_approve_escrow_proofs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_count integer := 0;
  v_unwind jsonb;
BEGIN
  FOR v_id IN
    SELECT m.id
    FROM public.missions m
    WHERE coalesce(m.crowdfunding_mode, false) = true
      AND lower(coalesce(m.status::text, '')) = 'awaiting_approval'
      AND coalesce(m.donation_settlement, 'held') = 'held'
      AND coalesce(m.report_submitted_at, m.updated_at) < (now() - interval '24 hours')
      AND NOT EXISTS (
        SELECT 1
        FROM public.mission_proof_votes v
        WHERE v.mission_id = m.id
          AND v.is_approved = true
      )
    FOR UPDATE OF m SKIP LOCKED
  LOOP
    v_unwind := public.settle_crowdfund_as_unapproved(v_id, 'vote_deadline');
    IF coalesce((v_unwind->>'unapproved')::boolean, false) THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_approve_escrow_proofs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_approve_escrow_proofs() FROM anon;
REVOKE ALL ON FUNCTION public.auto_approve_escrow_proofs() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.auto_approve_escrow_proofs() TO service_role;

COMMENT ON FUNCTION public.auto_approve_escrow_proofs() IS
  'Service-role / pg_cron. Crowdfund awaiting_approval with no donor yes for 24h after report_submitted_at is closed as not cleaned. It does not set approved and does not release donations.';

-- P2P confirm must not close a crowdfund, and it still moves no money.
CREATE OR REPLACE FUNCTION public.confirm_mission_direct_payment(p_mission_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
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

  IF coalesce(v_mission.crowdfunding_mode, false) THEN
    RAISE EXCEPTION 'Crowdfunding donations are released only after a donor approves the proof';
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
     SET status = 'completed',
         is_disputed = false
   WHERE id = p_mission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_mission_direct_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_mission_direct_payment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_mission_direct_payment(uuid) TO service_role;

COMMENT ON FUNCTION public.confirm_mission_direct_payment(uuid) IS
  'Creator-only close for a regular mission: review → completed. No wallet move. Refuses crowdfunding.';

COMMENT ON FUNCTION public.process_expired_crowdfunding_missions() IS
  'Service-role / pg_cron. Underfunded funding past the clock: USD retained, Gov Notice PDF, donor token credits. A funded cleanup still waiting on a donor vote is closed by auto_approve_escrow_proofs, not here. Donor approval is the only release.';

DO $pf$
DECLARE
  v_def text;
BEGIN
  IF has_function_privilege('anon', 'public.release_crowdfund_donations(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: anon can execute release_crowdfund_donations';
  END IF;
  IF has_function_privilege('authenticated', 'public.release_crowdfund_donations(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: authenticated can execute release_crowdfund_donations';
  END IF;
  IF has_function_privilege('anon', 'public.settle_crowdfund_as_unapproved(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: anon can execute settle_crowdfund_as_unapproved';
  END IF;
  IF has_function_privilege('authenticated', 'public.settle_crowdfund_as_unapproved(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: authenticated can execute settle_crowdfund_as_unapproved';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.process_proof_vote(uuid, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: authenticated cannot execute process_proof_vote';
  END IF;

  v_def := pg_get_functiondef('public.trg_settle_token_donations()'::regprocedure);
  IF position('release_crowdfund_donations' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Post-flight failed: settlement trigger does not release on donor approval';
  END IF;
  IF position('v_new = ''completed''' IN v_def) > 0 THEN
    RAISE EXCEPTION 'Post-flight failed: settlement trigger still branches on completed';
  END IF;

  v_def := pg_get_functiondef('public.auto_approve_escrow_proofs()'::regprocedure);
  IF position('settle_crowdfund_as_unapproved' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Post-flight failed: vote deadline does not unwind';
  END IF;
  IF position('status = ''approved''' IN v_def) > 0 THEN
    RAISE EXCEPTION 'Post-flight failed: vote deadline still auto-approves';
  END IF;
END
$pf$;
