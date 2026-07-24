-- ============================================================================
-- Restore crowdfunding +30 day timer bump on every successful contribution
-- ============================================================================
-- Regression history:
--   20260722_dynamic_crowdfunding_timers.sql introduced:
--     crowdfunding_expires_at := now() + 30 days on apply_stripe_contribution
--   20260722_stabilize_crowdfunding_proof_concurrency.sql replaced the RPC
--     without the timer bump (concurrency/overfunding fixes only).
--   20260723_dynamic_funding_bid_acceptance.sql replaced it again for
--     cleaner-lock → in_progress, still missing the +30 day bump.
--
-- This migration restores the timer rule while keeping the dynamic bid /
-- pre-selected cleaner state machine from 20260723.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_stripe_contribution(
  p_mission_id uuid,
  p_contributor_id uuid,
  p_amount_usd integer,
  p_stripe_checkout_session_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mission record;
  v_amount integer;
  v_new_funding integer;
  v_target integer;
  v_remaining integer;
  v_opened boolean := false;
  v_started boolean := false;
  v_existing uuid;
  v_new_expires timestamptz;
BEGIN
  IF p_stripe_checkout_session_id IS NULL OR length(trim(p_stripe_checkout_session_id)) = 0 THEN
    RAISE EXCEPTION 'Missing Stripe session id';
  END IF;

  -- Idempotency: same Stripe session never double-credits.
  SELECT id INTO v_existing
  FROM public.contributions
  WHERE stripe_checkout_session_id = p_stripe_checkout_session_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    SELECT *
    INTO v_mission
    FROM public.missions
    WHERE id = p_mission_id;

    RETURN jsonb_build_object(
      'mission_id', p_mission_id,
      'amount_usd', p_amount_usd,
      'current_funding', coalesce(v_mission.current_funding, 0),
      'target_budget', coalesce(v_mission.expected_price, 0),
      'opened_for_bidding', lower(coalesce(v_mission.status::text, '')) = 'available',
      'started_work', lower(coalesce(v_mission.status::text, '')) = 'in_progress',
      'crowdfunding_expires_at', v_mission.crowdfunding_expires_at,
      'idempotent', true
    );
  END IF;

  v_amount := floor(coalesce(p_amount_usd, 0));
  IF v_amount < 1 THEN
    RAISE EXCEPTION 'Contribution must be at least 1 USD';
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
    RAISE EXCEPTION 'This mission is direct-payment only';
  END IF;

  IF NOT public.is_garbage_removal_service(v_mission.service_type) THEN
    RAISE EXCEPTION 'Crowdfunding contributions are only for Garbage Removal';
  END IF;

  -- Only open funding campaigns accept new money.
  IF lower(coalesce(v_mission.status::text, '')) <> 'funding' THEN
    RAISE EXCEPTION 'Mission is not accepting contributions';
  END IF;

  IF v_mission.crowdfunding_expires_at IS NOT NULL
     AND v_mission.crowdfunding_expires_at < now() THEN
    RAISE EXCEPTION 'Crowdfunding window has expired';
  END IF;

  v_target := coalesce(v_mission.expected_price, 0);
  IF v_target < 1 THEN
    RAISE EXCEPTION 'Campaign target budget is invalid';
  END IF;

  v_remaining := greatest(0, v_target - coalesce(v_mission.current_funding, 0));
  IF v_remaining < 1 THEN
    RAISE EXCEPTION 'Campaign already funded';
  END IF;

  -- Reject oversubscription so Stripe ops can refund; do not silently credit excess.
  IF v_amount > v_remaining THEN
    RAISE EXCEPTION 'Contribution exceeds remaining budget (% USD left)', v_remaining;
  END IF;

  INSERT INTO public.contributions (
    mission_id,
    contributor_id,
    amount_usd,
    stripe_checkout_session_id
  )
  VALUES (
    p_mission_id,
    p_contributor_id,
    v_amount,
    p_stripe_checkout_session_id
  );

  v_new_funding := coalesce(v_mission.current_funding, 0) + v_amount;

  -- ANY successful contribution extends the funding window by +30 days from now
  -- (never shorten an already-longer deadline).
  v_new_expires := GREATEST(
    coalesce(v_mission.crowdfunding_expires_at, now()),
    now() + interval '30 days'
  );

  IF v_new_funding >= v_target THEN
    IF v_mission.cleaner_id IS NOT NULL THEN
      -- Worker was pre-selected during funding → start the job immediately.
      UPDATE public.missions
      SET
        current_funding = v_new_funding,
        status = 'in_progress',
        started_at = coalesce(started_at, now()),
        crowdfunding_expires_at = v_new_expires
      WHERE id = p_mission_id;
      v_started := true;
    ELSE
      UPDATE public.missions
      SET
        current_funding = v_new_funding,
        status = 'available',
        crowdfunding_expires_at = v_new_expires
      WHERE id = p_mission_id;
      v_opened := true;
    END IF;
  ELSE
    UPDATE public.missions
    SET
      current_funding = v_new_funding,
      crowdfunding_expires_at = v_new_expires
    WHERE id = p_mission_id;
  END IF;

  RETURN jsonb_build_object(
    'mission_id', p_mission_id,
    'amount_usd', v_amount,
    'current_funding', v_new_funding,
    'target_budget', v_target,
    'opened_for_bidding', v_opened,
    'started_work', v_started,
    'crowdfunding_expires_at', v_new_expires,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_stripe_contribution(uuid, uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_stripe_contribution(uuid, uuid, integer, text) TO service_role;

COMMENT ON FUNCTION public.apply_stripe_contribution(uuid, uuid, integer, text) IS
  'Credits Stripe contribution (idempotent). Extends crowdfunding_expires_at via GREATEST(expires, now()+30d). On target met: in_progress if cleaner pre-assigned, else available.';

COMMENT ON COLUMN public.missions.crowdfunding_expires_at IS
  'Funding window end. New campaigns: now/created_at + 7 days. After ANY successful contribution: GREATEST(expires_at, now() + 30 days).';

-- Heal live underfunded campaigns that already received money but still sit on the
-- initial ~7-day window (regression from missing bump in later RPC rewrites).
UPDATE public.missions
SET crowdfunding_expires_at = GREATEST(
  coalesce(crowdfunding_expires_at, now()),
  now() + interval '30 days'
)
WHERE coalesce(crowdfunding_mode, false) = true
  AND lower(coalesce(status::text, '')) = 'funding'
  AND coalesce(current_funding, 0) > 0;
