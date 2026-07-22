-- ============================================================================
-- Phase 1: Dynamic crowdfunding timers
-- ============================================================================
-- Rules (Roadmap_to_GooglePlay):
--   • New crowdfunding mission @ $0 raised → crowdfunding_expires_at = now() + 7 days
--   • ANY successful Stripe contribution → crowdfunding_expires_at = now() + 30 days
--     (from the payment moment; subsequent payments re-apply +30d)
-- ============================================================================

COMMENT ON COLUMN public.missions.crowdfunding_expires_at IS
  'Funding window end. New campaigns: created_at/now + 7 days. After any successful contribution: reset to payment time + 30 days.';

-- ---------------------------------------------------------------------------
-- 1) Ensure create path always stamps exactly now() + 7 days
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_lead_mission_with_token(
  p_service_type text,
  p_location_lat double precision,
  p_location_lng double precision,
  p_description text,
  p_photo_urls text[],
  p_building_id text DEFAULT NULL,
  p_building_height_m double precision DEFAULT NULL,
  p_token_bid integer DEFAULT 1,
  p_expected_price integer DEFAULT NULL,
  p_crowdfunding_mode boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_balance integer;
  v_bid integer;
  v_budget integer;
  v_mid uuid;
  v_category text;
  v_crowdfund boolean := coalesce(p_crowdfunding_mode, false);
  v_status text := 'available';
  v_expires timestamptz := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_service_type IS NULL OR length(trim(p_service_type)) = 0 THEN
    RAISE EXCEPTION 'Missing service_type';
  END IF;

  IF p_location_lat IS NULL OR p_location_lng IS NULL THEN
    RAISE EXCEPTION 'Location required';
  END IF;

  IF v_crowdfund AND NOT public.is_garbage_removal_service(p_service_type) THEN
    RAISE EXCEPTION 'Crowdfunding is only allowed for Garbage Removal services';
  END IF;

  v_bid := greatest(1, floor(coalesce(p_token_bid, 1)));
  v_budget := floor(coalesce(p_expected_price, 0));

  IF v_budget < 5 THEN
    RAISE EXCEPTION 'Work budget must be at least 5 USD';
  END IF;

  SELECT token_balance
  INTO v_balance
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF coalesce(v_balance, 0) < v_bid THEN
    RAISE EXCEPTION 'Insufficient tokens';
  END IF;

  UPDATE public.profiles
  SET token_balance = token_balance - v_bid
  WHERE id = v_uid;

  v_category := public.mission_category_for_service(p_service_type);

  IF v_crowdfund THEN
    v_status := 'funding';
    -- Strict default: exactly 7 days from create (Phase 1).
    v_expires := now() + interval '7 days';
  END IF;

  INSERT INTO public.missions (
    creator_id,
    status,
    category,
    amount_target,
    expected_price,
    current_funding,
    service_type,
    location_lat,
    location_lng,
    description,
    photo_urls,
    building_id,
    building_height_m,
    crowdfunding_mode,
    crowdfunding_expires_at
  )
  VALUES (
    v_uid,
    v_status,
    v_category,
    v_bid,
    v_budget,
    0,
    p_service_type,
    p_location_lat,
    p_location_lng,
    NULLIF(trim(coalesce(p_description, '')), ''),
    coalesce(p_photo_urls, array[]::text[]),
    NULLIF(trim(coalesce(p_building_id, '')), ''),
    p_building_height_m,
    v_crowdfund,
    v_expires
  )
  RETURNING id INTO v_mid;

  RETURN v_mid;
END;
$$;

REVOKE ALL ON FUNCTION public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision, integer, integer, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision, integer, integer, boolean
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision, integer, integer, boolean
) TO service_role;

COMMENT ON FUNCTION public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision, integer, integer, boolean
) IS
  'Create mission; deduct token bid. Crowdfunding → status=funding, crowdfunding_expires_at = now()+7 days.';

-- Safety net: any crowdfunding INSERT missing expiry gets now()+7d (RPC / seed / admin).
CREATE OR REPLACE FUNCTION public.trg_missions_crowdfunding_default_expiry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF coalesce(NEW.crowdfunding_mode, false)
     AND NEW.crowdfunding_expires_at IS NULL THEN
    NEW.crowdfunding_expires_at := now() + interval '7 days';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_missions_crowdfunding_default_expiry ON public.missions;
CREATE TRIGGER trg_missions_crowdfunding_default_expiry
  BEFORE INSERT ON public.missions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_missions_crowdfunding_default_expiry();

-- ---------------------------------------------------------------------------
-- 2) On every successful contribution → extend window to now() + 30 days
-- ---------------------------------------------------------------------------
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
  v_existing uuid;
  v_new_expires timestamptz;
BEGIN
  IF p_stripe_checkout_session_id IS NULL OR length(trim(p_stripe_checkout_session_id)) = 0 THEN
    RAISE EXCEPTION 'Missing Stripe session id';
  END IF;

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
  -- Phase 1: ANY successful payment resets the funding window to +30 days from now.
  v_new_expires := now() + interval '30 days';

  IF v_new_funding >= v_target THEN
    UPDATE public.missions
    SET
      current_funding = v_new_funding,
      status = 'available',
      crowdfunding_expires_at = v_new_expires
    WHERE id = p_mission_id;
    v_opened := true;
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
    'crowdfunding_expires_at', v_new_expires,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_stripe_contribution(uuid, uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_stripe_contribution(uuid, uuid, integer, text) TO service_role;

COMMENT ON FUNCTION public.apply_stripe_contribution(uuid, uuid, integer, text) IS
  'Service-role: credit contribution (idempotent on Stripe session). Extends crowdfunding_expires_at to now()+30 days.';

-- ---------------------------------------------------------------------------
-- 3) One-time alignment for live funding campaigns
-- ---------------------------------------------------------------------------
-- Unfunded open campaigns missing expiry → 7 days from create (or now).
UPDATE public.missions
SET crowdfunding_expires_at = COALESCE(created_at, now()) + interval '7 days'
WHERE coalesce(crowdfunding_mode, false) = true
  AND lower(coalesce(status::text, '')) = 'funding'
  AND coalesce(current_funding, 0) = 0
  AND crowdfunding_expires_at IS NULL;

-- Already-funded open campaigns (had ≥1 contribution) → at least now()+30 days
-- so they pick up the new extension rule without shortening a longer window.
UPDATE public.missions
SET crowdfunding_expires_at = now() + interval '30 days'
WHERE coalesce(crowdfunding_mode, false) = true
  AND lower(coalesce(status::text, '')) = 'funding'
  AND coalesce(current_funding, 0) > 0
  AND (
    crowdfunding_expires_at IS NULL
    OR crowdfunding_expires_at < now() + interval '30 days'
  );
