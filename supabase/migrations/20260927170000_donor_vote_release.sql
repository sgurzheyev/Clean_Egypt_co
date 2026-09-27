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
-- only when the donor vote releases the proof:
--   tokens  → payout_held_token_donations, 1:1, no bonus
--   USD     → one row in crowdfund_donation_releases for floor(current_funding)
--             There is no Stripe transfer in this repo. The row is the
--             authorization to pay the worker. current_funding stays as raised.
-- status=completed does not release. auto_approved does not release.
--
-- Vote weight is in token-units at the closed-economy rate (bonus-inclusive
-- tokens_per_usd, default 60). It is not the shop rate (5000/99).
--   weight = tokens_per_usd * sum(contributions.amount_usd) + sum(held gifts)
--   $10 → 600. A 120-token gift → 120. Linear, so sum-then-convert matches
--   converting each gift.
-- One donor's "no" is not final. Inside the window (closed_economy_config
-- proof_vote_window_hours, default 24) after report_submitted_at:
--   early release only when approve weight is more than half of ALL donated
--   weight (approve * 2 > total). A no never closes early.
-- At the end of the window, only votes cast count:
--   approve > reject → release
--   no votes         → not cleaned (no re-upload)
--   reject > approve and retry_count < proof_reupload_limit (default 1)
--                    → one re-upload: in_progress, proof cleared, votes
--                      deleted, window restarts when the worker submits
--   tie, or reject with no re-upload left → not cleaned
-- A granted re-upload that is not resubmitted before the same window
-- (status_changed_at) is not cleaned. A first in_progress (retry_count = 0,
-- or no proof_reupload_granted event) is left alone.
-- Not cleaned:
--   Stripe cards are not refunded.
--   Stripe donors get the closed-economy token credit ($100 → 6000 at defaults).
--   Held token gifts refund at floor(tokens * 120 / 100).
--   Bonus refund runs BEFORE the status UPDATE. The expired-status trigger
--   would otherwise refund 1:1 first.
--   city_notification_events crowdfunding_expired queues the municipal PDF.
--   status=expired, donation_settlement=retained, cleaner unlocked.
-- The historical function auto_approve_escrow_proofs keeps its name and cron.
-- It tallies the window. It does not set auto_approved.
-- ============================================================================

-- Constant default: Postgres 11+ does not rewrite the table, so
-- missions_touch_location_and_updated_at does not stamp every pin.
ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS donation_settlement text NOT NULL DEFAULT 'held';

ALTER TABLE public.closed_economy_config
  ADD COLUMN IF NOT EXISTS proof_vote_window_hours integer NOT NULL DEFAULT 24;

ALTER TABLE public.closed_economy_config
  ADD COLUMN IF NOT EXISTS proof_reupload_limit integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'closed_economy_config_proof_vote_window_hours_check'
      AND conrelid = 'public.closed_economy_config'::regclass
  ) THEN
    ALTER TABLE public.closed_economy_config
      ADD CONSTRAINT closed_economy_config_proof_vote_window_hours_check
      CHECK (proof_vote_window_hours BETWEEN 1 AND 720);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'closed_economy_config_proof_reupload_limit_check'
      AND conrelid = 'public.closed_economy_config'::regclass
  ) THEN
    ALTER TABLE public.closed_economy_config
      ADD CONSTRAINT closed_economy_config_proof_reupload_limit_check
      CHECK (proof_reupload_limit BETWEEN 0 AND 5);
  END IF;
END $$;

COMMENT ON COLUMN public.closed_economy_config.proof_vote_window_hours IS
  'Hours after report_submitted_at (and after a granted re-upload) before the weighted donor tally closes. Default 24.';

COMMENT ON COLUMN public.closed_economy_config.proof_reupload_limit IS
  'How many times a weighted no-majority may send the worker back to in_progress. Default 1.';

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
       OR (n->>'hidden_at') IS DISTINCT FROM (o->>'hidden_at')
       OR (n->>'hidden_by') IS DISTINCT FROM (o->>'hidden_by')
       OR (n->>'donation_settlement') IS DISTINCT FROM (o->>'donation_settlement')
    THEN
      RAISE EXCEPTION
        'Direct modification of protected mission lifecycle and economy fields is forbidden. Use designated RPCs.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.protect_mission_lifecycle_columns() IS
  'Wave F (SEC-2) + Admin P1 + donation_settlement: blocks direct client updates of status, cleaner, funds, hidden_at, hidden_by, and donation_settlement. DEFINER RPCs bypass.';

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

-- Weighted no-majority, no votes, a tie, or a missed re-upload.
-- Same economics as an unfinished expiry. Bonus refund is inside the
-- nested block and runs before the status change, so a 0-row update
-- rolls the credit back (CE001) instead of paying a pin that did not move.
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
  v_from text;
  v_token_credit integer := 0;
  v_stripe_credit integer := 0;
  v_raised integer := 0;
  v_reports integer := 0;
  v_photos text[];
  v_event_id uuid;
  v_expires timestamptz;
  v_landed boolean := false;
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

  v_from := lower(coalesce(v_mission.status::text, ''));
  IF v_from = 'awaiting_approval' THEN
    NULL;
  ELSIF v_from = 'in_progress' AND coalesce(v_mission.retry_count, 0) >= 1 THEN
    NULL;
  ELSE
    RETURN jsonb_build_object('unapproved', false, 'reason', 'not_awaiting_approval');
  END IF;

  -- Restored if CE001 rolls the block back, so a prior call cannot leak.
  v_landed := false;
  v_token_credit := 0;
  v_stripe_credit := 0;
  v_event_id := NULL;
  BEGIN
    -- Bonus refund BEFORE the status UPDATE. The expired trigger refunds
    -- again and finds nothing left to credit.
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
             WHEN v_reason = 'majority_rejected' THEN 'Donors rejected the proof by donation weight. Cleanup treated as not done.'
             WHEN v_reason = 'no_votes' THEN 'No donor voted on the proof before the review window ended.'
             WHEN v_reason = 'vote_tie' THEN 'Donor votes tied. Cleanup treated as not done.'
             WHEN v_reason = 'missed_reupload' THEN 'The worker did not upload a new proof before the review window ended.'
             WHEN v_reason = 'vote_deadline' THEN 'No donor voted on the proof before the review window ended.'
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
       AND lower(coalesce(status::text, '')) = v_from
       AND coalesce(donation_settlement, 'held') = 'held'
       AND (
         v_from = 'awaiting_approval'
         OR (v_from = 'in_progress' AND coalesce(retry_count, 0) >= 1)
       );

    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN
      RAISE EXCEPTION 'crowdfund unapproved lost the race'
        USING ERRCODE = 'CE001';
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
        jsonb_build_object('status', v_from, 'raised_usd', v_raised),
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

    v_landed := true;
  EXCEPTION
    WHEN SQLSTATE 'CE001' THEN
      NULL;
  END;

  IF NOT v_landed THEN
    RETURN jsonb_build_object('unapproved', false, 'reason', 'lost_race');
  END IF;

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
  'Crowdfund not cleaned: awaiting_approval, or in_progress after a granted re-upload. Retains USD, queues the Gov Notice PDF, credits Stripe donors and refunds token gifts with the closed-economy bonus. Does not release to the worker.';

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

-- 150000 already installed this trigger. Recreate it so the replaced body
-- is what runs when status becomes approved or expired.
DROP TRIGGER IF EXISTS trg_settle_token_donations ON public.missions;
CREATE TRIGGER trg_settle_token_donations
  AFTER UPDATE OF status
  ON public.missions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_settle_token_donations();

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

REVOKE ALL ON FUNCTION public.enqueue_crowdfunding_completion_notification() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_crowdfunding_completion_notification() FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_crowdfunding_completion_notification() FROM authenticated;

-- ---------------------------------------------------------------------------
-- Vote weight. Bonus-inclusive tokens_per_usd (default 60), not the shop rate.
-- $10 of card gifts → 600. A held 120-token gift → 120.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crowdfund_proof_vote_window_hours()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_hours integer := 24;
BEGIN
  SELECT proof_vote_window_hours
    INTO v_hours
  FROM public.closed_economy_config
  WHERE id = 1;

  IF v_hours IS NULL OR v_hours < 1 OR v_hours > 720 THEN
    RETURN 24;
  END IF;
  RETURN v_hours;
END;
$$;

CREATE OR REPLACE FUNCTION public.crowdfund_proof_reupload_limit()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_limit integer := 1;
BEGIN
  SELECT proof_reupload_limit
    INTO v_limit
  FROM public.closed_economy_config
  WHERE id = 1;

  IF v_limit IS NULL OR v_limit < 0 OR v_limit > 5 THEN
    RETURN 1;
  END IF;
  RETURN v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.crowdfund_donation_weight(p_mission_id uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_usd bigint := 0;
  v_gifts bigint := 0;
BEGIN
  IF p_mission_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT coalesce(sum(c.amount_usd)::bigint, 0)
    INTO v_usd
  FROM public.contributions c
  WHERE c.mission_id = p_mission_id;

  SELECT coalesce(sum(d.tokens)::bigint, 0)
    INTO v_gifts
  FROM public.token_donations d
  WHERE d.mission_id = p_mission_id
    AND d.status = 'held';

  RETURN v_usd * public.closed_economy_tokens_per_usd()::bigint + v_gifts;
END;
$$;

CREATE OR REPLACE FUNCTION public.crowdfund_vote_weight(
  p_mission_id uuid,
  p_approved boolean
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_weight bigint := 0;
BEGIN
  IF p_mission_id IS NULL OR p_approved IS NULL THEN
    RETURN 0;
  END IF;

  SELECT coalesce(sum(voter.weight), 0)
    INTO v_weight
  FROM (
    SELECT
      coalesce((
        SELECT sum(c.amount_usd)::bigint
        FROM public.contributions c
        WHERE c.mission_id = p_mission_id
          AND c.contributor_id = v.voter_id
      ), 0) * public.closed_economy_tokens_per_usd()::bigint
      + coalesce((
        SELECT sum(d.tokens)::bigint
        FROM public.token_donations d
        WHERE d.mission_id = p_mission_id
          AND d.donor_id = v.voter_id
          AND d.status = 'held'
      ), 0) AS weight
    FROM public.mission_proof_votes v
    WHERE v.mission_id = p_mission_id
      AND v.is_approved = p_approved
  ) voter;

  RETURN v_weight;
END;
$$;

-- release | hold | retry | not_cleaned
-- Early release (approve * 2 > total) is checked even before the window ends.
-- retry and not_cleaned are only returned when p_at_window_end is true.
CREATE OR REPLACE FUNCTION public.crowdfund_proof_decision(
  p_mission_id uuid,
  p_at_window_end boolean
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_approve bigint := 0;
  v_reject bigint := 0;
  v_total bigint := 0;
  v_votes integer := 0;
  v_retry integer := 0;
  v_limit integer := 1;
BEGIN
  IF p_mission_id IS NULL THEN
    RETURN 'hold';
  END IF;

  v_approve := public.crowdfund_vote_weight(p_mission_id, true);
  v_reject := public.crowdfund_vote_weight(p_mission_id, false);
  v_total := public.crowdfund_donation_weight(p_mission_id);

  IF v_total > 0 AND (v_approve * 2) > v_total THEN
    RETURN 'release';
  END IF;

  IF coalesce(p_at_window_end, false) IS NOT TRUE THEN
    RETURN 'hold';
  END IF;

  SELECT count(*)::integer
    INTO v_votes
  FROM public.mission_proof_votes
  WHERE mission_id = p_mission_id;

  IF coalesce(v_votes, 0) <= 0 THEN
    RETURN 'not_cleaned';
  END IF;

  IF v_approve > v_reject THEN
    RETURN 'release';
  END IF;

  SELECT coalesce(m.retry_count, 0)
    INTO v_retry
  FROM public.missions m
  WHERE m.id = p_mission_id;

  v_limit := public.crowdfund_proof_reupload_limit();

  IF v_reject > v_approve AND coalesce(v_retry, 0) < coalesce(v_limit, 1) THEN
    RETURN 'retry';
  END IF;

  RETURN 'not_cleaned';
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_crowdfund_proof_reupload(p_mission_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_cleaner uuid;
  n integer;
BEGIN
  IF p_mission_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.missions m
     SET status = 'in_progress',
         after_photo_urls = NULL,
         proof_video_url = NULL,
         report_submitted_at = NULL,
         completion_lat = NULL,
         completion_lng = NULL,
         completion_distance_meters = NULL,
         liveness_lat = NULL,
         liveness_lng = NULL,
         rejection_reason = 'Donors voted no by donation weight. Upload proof once more.',
         auto_approved = false,
         retry_count = coalesce(m.retry_count, 0) + 1,
         proof_events = coalesce(m.proof_events, '[]'::jsonb) || jsonb_build_array(
           jsonb_build_object(
             'type', 'proof_reupload_granted',
             'at', now(),
             'status', 'in_progress',
             'recoverable', true
           )
         )
   WHERE m.id = p_mission_id
     AND coalesce(m.crowdfunding_mode, false)
     AND lower(coalesce(m.status::text, '')) = 'awaiting_approval'
     AND coalesce(m.donation_settlement, 'held') = 'held'
     AND coalesce(m.retry_count, 0) < public.crowdfund_proof_reupload_limit()
  RETURNING m.cleaner_id INTO v_cleaner;

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RETURN false;
  END IF;

  DELETE FROM public.mission_proof_votes
   WHERE mission_id = p_mission_id;

  IF v_cleaner IS NOT NULL THEN
    PERFORM public.create_notification(
      v_cleaner,
      'proof_rejected',
      p_mission_id,
      NULL,
      'Upload proof once more',
      'Donors voted no by donation weight. You can submit one new proof. The donated funds stay held.'
    );
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_crowdfund_on_weighted_yes(p_mission_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_cleaner uuid;
  n integer;
BEGIN
  UPDATE public.missions m
     SET status = 'approved',
         auto_approved = false,
         rejection_reason = NULL,
         proof_events = coalesce(m.proof_events, '[]'::jsonb) || jsonb_build_array(
           jsonb_build_object(
             'type', 'donor_weighted_release',
             'at', now(),
             'status', 'approved'
           )
         )
   WHERE m.id = p_mission_id
     AND coalesce(m.crowdfunding_mode, false)
     AND lower(coalesce(m.status::text, '')) = 'awaiting_approval'
     AND coalesce(m.donation_settlement, 'held') = 'held'
     AND coalesce(m.auto_approved, false) = false
     AND EXISTS (
       SELECT 1
       FROM public.mission_proof_votes v
       WHERE v.mission_id = m.id
         AND v.is_approved = true
     )
  RETURNING m.cleaner_id INTO v_cleaner;

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RETURN false;
  END IF;

  IF v_cleaner IS NOT NULL THEN
    PERFORM public.create_notification(
      v_cleaner,
      'mission_approved',
      p_mission_id,
      NULL,
      'Work approved',
      'Donors approved your proof. Donated funds are released to you.'
    );
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.crowdfund_proof_vote_window_hours() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crowdfund_proof_vote_window_hours() FROM anon;
REVOKE ALL ON FUNCTION public.crowdfund_proof_vote_window_hours() FROM authenticated;

REVOKE ALL ON FUNCTION public.crowdfund_proof_reupload_limit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crowdfund_proof_reupload_limit() FROM anon;
REVOKE ALL ON FUNCTION public.crowdfund_proof_reupload_limit() FROM authenticated;

REVOKE ALL ON FUNCTION public.crowdfund_donation_weight(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crowdfund_donation_weight(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.crowdfund_donation_weight(uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public.crowdfund_vote_weight(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crowdfund_vote_weight(uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.crowdfund_vote_weight(uuid, boolean) FROM authenticated;

REVOKE ALL ON FUNCTION public.crowdfund_proof_decision(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crowdfund_proof_decision(uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.crowdfund_proof_decision(uuid, boolean) FROM authenticated;

REVOKE ALL ON FUNCTION public.grant_crowdfund_proof_reupload(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_crowdfund_proof_reupload(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.grant_crowdfund_proof_reupload(uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public.release_crowdfund_on_weighted_yes(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_crowdfund_on_weighted_yes(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.release_crowdfund_on_weighted_yes(uuid) FROM authenticated;

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
  v_decision text;
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

  IF coalesce(v_mission.donation_settlement, 'held') <> 'held' THEN
    RAISE EXCEPTION 'Donations on this mission are already settled';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.contributions c
    WHERE c.mission_id = p_mission_id
      AND c.contributor_id = uid
    UNION ALL
    SELECT 1
    FROM public.token_donations d
    WHERE d.mission_id = p_mission_id
      AND d.donor_id = uid
      AND d.status = 'held'
  ) THEN
    RAISE EXCEPTION 'Only donors can vote on this proof';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.mission_proof_votes
    WHERE mission_id = p_mission_id
      AND voter_id = uid
  ) THEN
    RAISE EXCEPTION 'You have already voted on this proof';
  END IF;

  INSERT INTO public.mission_proof_votes (mission_id, voter_id, is_approved)
  VALUES (p_mission_id, uid, p_is_approved)
  RETURNING id INTO v_vote_id;

  v_new_status := 'awaiting_approval';
  v_decision := public.crowdfund_proof_decision(p_mission_id, false);

  IF v_decision = 'release' AND p_is_approved THEN
    IF public.release_crowdfund_on_weighted_yes(p_mission_id) THEN
      v_new_status := 'approved';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'mission_id', p_mission_id,
    'vote_id', v_vote_id,
    'is_approved', p_is_approved,
    'status', v_new_status,
    'decision', v_decision
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_proof_vote(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_proof_vote(uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.process_proof_vote(uuid, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_proof_vote(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_proof_vote(uuid, boolean) TO service_role;

COMMENT ON FUNCTION public.process_proof_vote(uuid, boolean) IS
  'Donor-only, one vote. Weight is donation size. A yes that already exceeds half of all donated weight releases funds. Any other vote, including a no, stays open until the review window.';

COMMENT ON TABLE public.mission_proof_votes IS
  'One row per donor for the current crowdfund proof. Deleted when a weighted no-majority grants one re-upload. A yes majority releases donations. A single no is not final.';

-- Historical name. The cron still calls this. It never sets auto_approved.
CREATE OR REPLACE FUNCTION public.auto_approve_escrow_proofs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_count integer := 0;
  v_decision text;
  v_approve bigint;
  v_reject bigint;
  v_votes integer;
  v_reason text;
  v_unwind jsonb;
  v_hours integer;
  v_cutoff timestamptz;
BEGIN
  v_hours := public.crowdfund_proof_vote_window_hours();
  v_cutoff := now() - make_interval(hours => v_hours);

  FOR v_id IN
    SELECT m.id
    FROM public.missions m
    WHERE coalesce(m.crowdfunding_mode, false) = true
      AND lower(coalesce(m.status::text, '')) = 'awaiting_approval'
      AND coalesce(m.donation_settlement, 'held') = 'held'
      AND coalesce(m.report_submitted_at, m.updated_at) < v_cutoff
    FOR UPDATE OF m SKIP LOCKED
  LOOP
    BEGIN
      v_decision := public.crowdfund_proof_decision(v_id, true);

      IF v_decision = 'release' THEN
        IF public.release_crowdfund_on_weighted_yes(v_id) THEN
          v_count := v_count + 1;
        END IF;
      ELSIF v_decision = 'retry' THEN
        IF public.grant_crowdfund_proof_reupload(v_id) THEN
          v_count := v_count + 1;
        END IF;
      ELSIF v_decision = 'not_cleaned' THEN
        v_approve := public.crowdfund_vote_weight(v_id, true);
        v_reject := public.crowdfund_vote_weight(v_id, false);
        SELECT count(*)::integer
          INTO v_votes
        FROM public.mission_proof_votes
        WHERE mission_id = v_id;

        IF coalesce(v_votes, 0) <= 0 THEN
          v_reason := 'no_votes';
        ELSIF v_reject > v_approve THEN
          v_reason := 'majority_rejected';
        ELSE
          v_reason := 'vote_tie';
        END IF;

        v_unwind := public.settle_crowdfund_as_unapproved(v_id, v_reason);
        IF coalesce((v_unwind->>'unapproved')::boolean, false) THEN
          v_count := v_count + 1;
        END IF;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'auto_approve_escrow_proofs skipped %: %', v_id, SQLERRM;
    END;
  END LOOP;

  -- Re-upload was granted and the worker did not submit again in time.
  -- A normal first in_progress (no proof_reupload_granted event) is skipped.
  FOR v_id IN
    SELECT m.id
    FROM public.missions m
    WHERE coalesce(m.crowdfunding_mode, false) = true
      AND lower(coalesce(m.status::text, '')) = 'in_progress'
      AND coalesce(m.retry_count, 0) >= 1
      AND m.report_submitted_at IS NULL
      AND coalesce(m.donation_settlement, 'held') = 'held'
      AND coalesce(m.status_changed_at, m.updated_at) < v_cutoff
      AND coalesce(m.proof_events, '[]'::jsonb) @> '[{"type":"proof_reupload_granted"}]'::jsonb
    FOR UPDATE OF m SKIP LOCKED
  LOOP
    BEGIN
      v_unwind := public.settle_crowdfund_as_unapproved(v_id, 'missed_reupload');
      IF coalesce((v_unwind->>'unapproved')::boolean, false) THEN
        v_count := v_count + 1;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'auto_approve_escrow_proofs skipped reupload %: %', v_id, SQLERRM;
    END;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_approve_escrow_proofs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_approve_escrow_proofs() FROM anon;
REVOKE ALL ON FUNCTION public.auto_approve_escrow_proofs() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.auto_approve_escrow_proofs() TO postgres;
GRANT EXECUTE ON FUNCTION public.auto_approve_escrow_proofs() TO service_role;

COMMENT ON FUNCTION public.auto_approve_escrow_proofs() IS
  'Service-role / postgres / pg_cron. At the end of the donor window: yes-weight wins releases, no-weight wins may grant one re-upload, no votes or a tie settles as not cleaned. Never sets auto_approved.';

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
REVOKE ALL ON FUNCTION public.confirm_mission_direct_payment(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.confirm_mission_direct_payment(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_mission_direct_payment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_mission_direct_payment(uuid) TO service_role;

COMMENT ON FUNCTION public.confirm_mission_direct_payment(uuid) IS
  'Creator-only close for a regular mission: review → completed. No wallet move. Refuses crowdfunding.';

COMMENT ON FUNCTION public.process_expired_crowdfunding_missions() IS
  'Service-role / postgres / pg_cron. Underfunded funding past the clock: USD retained, Gov Notice PDF, donor token credits. A funded cleanup in donor review is closed by auto_approve_escrow_proofs, not here. Donor approval is the only release.';

REVOKE ALL ON FUNCTION public.process_expired_crowdfunding_missions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_expired_crowdfunding_missions() FROM anon;
REVOKE ALL ON FUNCTION public.process_expired_crowdfunding_missions() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_expired_crowdfunding_missions() TO postgres;
GRANT EXECUTE ON FUNCTION public.process_expired_crowdfunding_missions() TO service_role;

-- Re-state after every CREATE OR REPLACE above. Replacing a function can
-- restore the default PUBLIC execute grant.
REVOKE ALL ON FUNCTION public.release_crowdfund_donations(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_crowdfund_donations(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.release_crowdfund_donations(uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public.settle_crowdfund_as_unapproved(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_crowdfund_as_unapproved(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.settle_crowdfund_as_unapproved(uuid, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.trg_settle_token_donations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_settle_token_donations() FROM anon;
REVOKE ALL ON FUNCTION public.trg_settle_token_donations() FROM authenticated;

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
  IF has_function_privilege('anon', 'public.process_proof_vote(uuid, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: anon can execute process_proof_vote';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.process_proof_vote(uuid, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: authenticated cannot execute process_proof_vote';
  END IF;
  IF has_function_privilege('anon', 'public.confirm_mission_direct_payment(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: anon can execute confirm_mission_direct_payment';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.confirm_mission_direct_payment(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: authenticated cannot execute confirm_mission_direct_payment';
  END IF;
  IF has_function_privilege('anon', 'public.auto_approve_escrow_proofs()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.auto_approve_escrow_proofs()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: auto_approve_escrow_proofs is executable by anon or authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.auto_approve_escrow_proofs()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: service_role cannot execute auto_approve_escrow_proofs';
  END IF;
  IF NOT has_function_privilege('postgres', 'public.auto_approve_escrow_proofs()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: postgres cannot execute auto_approve_escrow_proofs';
  END IF;
  IF NOT has_function_privilege('postgres', 'public.process_expired_crowdfunding_missions()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: postgres cannot execute process_expired_crowdfunding_missions';
  END IF;
  IF has_function_privilege('anon', 'public.process_expired_crowdfunding_missions()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.process_expired_crowdfunding_missions()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: process_expired_crowdfunding_missions is executable by anon or authenticated';
  END IF;
  IF has_function_privilege('anon', 'public.crowdfund_proof_decision(uuid, boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.crowdfund_proof_decision(uuid, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: crowdfund_proof_decision is executable by anon or authenticated';
  END IF;
  IF has_function_privilege('anon', 'public.release_crowdfund_on_weighted_yes(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.release_crowdfund_on_weighted_yes(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: release_crowdfund_on_weighted_yes is executable by anon or authenticated';
  END IF;

  v_def := pg_get_functiondef('public.protect_mission_lifecycle_columns()'::regprocedure);
  IF position('hidden_at' IN v_def) = 0 OR position('hidden_by' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Post-flight failed: protect_mission_lifecycle_columns dropped hidden_at/hidden_by';
  END IF;
  IF position('donation_settlement' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Post-flight failed: protect_mission_lifecycle_columns ignores donation_settlement';
  END IF;

  v_def := pg_get_functiondef('public.settle_crowdfund_as_unapproved(uuid, text)'::regprocedure);
  IF position('SAVEPOINT' IN v_def) > 0 THEN
    RAISE EXCEPTION 'Post-flight failed: settle_crowdfund_as_unapproved still uses SAVEPOINT';
  END IF;
  IF position('CE001' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Post-flight failed: settle_crowdfund_as_unapproved has no lost-race rollback';
  END IF;

  v_def := pg_get_functiondef('public.trg_settle_token_donations()'::regprocedure);
  IF position('release_crowdfund_donations' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Post-flight failed: settlement trigger does not release on donor approval';
  END IF;
  IF position('v_new = ''completed''' IN v_def) > 0 THEN
    RAISE EXCEPTION 'Post-flight failed: settlement trigger still branches on completed';
  END IF;

  v_def := pg_get_functiondef('public.auto_approve_escrow_proofs()'::regprocedure);
  IF position('crowdfund_proof_decision' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Post-flight failed: vote window does not tally weights';
  END IF;
  IF position('auto_approved = true' IN v_def) > 0 THEN
    RAISE EXCEPTION 'Post-flight failed: vote window still auto-approves';
  END IF;

  v_def := pg_get_functiondef('public.process_proof_vote(uuid, boolean)'::regprocedure);
  IF position('settle_crowdfund_as_unapproved' IN v_def) > 0 THEN
    RAISE EXCEPTION 'Post-flight failed: a single vote still settles the pot';
  END IF;
  IF position('already been decided' IN v_def) > 0 THEN
    RAISE EXCEPTION 'Post-flight failed: the first vote is still final';
  END IF;

  IF (
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'missions'
      AND column_name = 'donation_settlement'
  ) IS NULL THEN
    RAISE EXCEPTION 'Post-flight failed: donation_settlement has no default';
  END IF;
END
$pf$;
