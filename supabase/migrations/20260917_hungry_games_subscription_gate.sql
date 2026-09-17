-- =============================================================================
-- Hungry-Games: Active subscription required to place bids (Phase 3 Roadmap)
-- =============================================================================
-- In addition to the 1-token stake per new bid, workers must have an active
-- subscription (subscription_expires_at > now()) to submit bids.
-- Platform admins (is_platform_admin) are exempted for QA/testing.
-- Updating an existing pending bid does not re-check subscription or re-debit tokens.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.place_mission_bid(
  p_mission_id uuid,
  p_bid_amount integer,
  p_offer_packages jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  v_mission record;
  v_amount integer;
  v_bid_id uuid;
  v_balance integer;
  v_sub_expires timestamptz;
  v_status text;
  v_is_crowd boolean;
  v_packages jsonb := '[]'::jsonb;
  v_pkg jsonb;
  v_pkg_price integer;
  v_min_price integer := NULL;
  v_count integer := 0;
  v_existing_id uuid;
  v_is_admin boolean;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_amount := floor(coalesce(p_bid_amount, 0));

  -- Normalize optional packages (max 3).
  IF p_offer_packages IS NOT NULL AND jsonb_typeof(p_offer_packages) = 'array' THEN
    FOR v_pkg IN
      SELECT value
      FROM jsonb_array_elements(p_offer_packages)
      LIMIT 3
    LOOP
      v_pkg_price := floor(coalesce((v_pkg ->> 'price')::numeric, 0));
      IF v_pkg_price < 1 THEN
        CONTINUE;
      END IF;
      IF nullif(btrim(coalesce(v_pkg ->> 'title', '')), '') IS NULL THEN
        CONTINUE;
      END IF;
      v_packages := v_packages || jsonb_build_array(
        jsonb_build_object(
          'id', coalesce(nullif(btrim(v_pkg ->> 'id'), ''), gen_random_uuid()::text),
          'tier', coalesce(nullif(btrim(v_pkg ->> 'tier'), ''), 'custom'),
          'title', left(btrim(v_pkg ->> 'title'), 80),
          'description', left(btrim(coalesce(v_pkg ->> 'description', '')), 400),
          'price', v_pkg_price,
          'includes_supplies', coalesce((v_pkg ->> 'includes_supplies')::boolean, false),
          'supply_labels', coalesce(v_pkg -> 'supply_labels', '[]'::jsonb)
        )
      );
      v_count := v_count + 1;
      IF v_min_price IS NULL OR v_pkg_price < v_min_price THEN
        v_min_price := v_pkg_price;
      END IF;
    END LOOP;
  END IF;

  IF v_count > 0 THEN
    v_amount := v_min_price;
  END IF;

  IF v_amount < 1 THEN
    RAISE EXCEPTION 'Bid amount must be at least 1 USD';
  END IF;

  SELECT *
  INTO v_mission
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  IF v_mission.creator_id IS NOT DISTINCT FROM uid THEN
    RAISE EXCEPTION 'Cannot bid on your own mission';
  END IF;

  IF v_mission.cleaner_id IS NOT NULL THEN
    RAISE EXCEPTION 'Mission already has an assigned worker';
  END IF;

  v_status := lower(coalesce(v_mission.status::text, ''));
  v_is_crowd := coalesce(v_mission.crowdfunding_mode, false);

  IF v_is_crowd THEN
    IF v_status NOT IN ('funding', 'available', 'pending') THEN
      RAISE EXCEPTION 'Mission is not open for crowd-bidding';
    END IF;
    IF v_status = 'funding'
       AND v_mission.crowdfunding_expires_at IS NOT NULL
       AND v_mission.crowdfunding_expires_at < now() THEN
      RAISE EXCEPTION 'Crowdfunding window has expired';
    END IF;
  ELSE
    IF v_status NOT IN ('available', 'pending') THEN
      RAISE EXCEPTION 'Mission is not open for bidding';
    END IF;
  END IF;

  -- Update existing pending bid (no second token debit or subscription check).
  SELECT id
  INTO v_existing_id
  FROM public.mission_bids
  WHERE mission_id = p_mission_id
    AND cleaner_id = uid
    AND lower(coalesce(status::text, '')) = 'pending'
  FOR UPDATE;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.mission_bids
    SET
      bid_amount = v_amount,
      offer_packages = v_packages
    WHERE id = v_existing_id;

    RETURN v_existing_id;
  END IF;

  -- Check admin exemption for testing
  v_is_admin := public.is_platform_admin(uid);

  -- Fetch user profile for subscription and token balance
  SELECT token_balance, subscription_expires_at
  INTO v_balance, v_sub_expires
  FROM public.profiles
  WHERE id = uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  -- Hungry-Games rule: active subscription required to place a new bid
  IF NOT v_is_admin AND (v_sub_expires IS NULL OR v_sub_expires <= now()) THEN
    RAISE EXCEPTION 'Active subscription required to place bids.';
  END IF;

  -- New bid: debit 1 token (P2P and crowdfunding)
  IF coalesce(v_balance, 0) < 1 THEN
    RAISE EXCEPTION 'Insufficient tokens. 1 token required to place a bid.';
  END IF;

  UPDATE public.profiles
  SET token_balance = token_balance - 1
  WHERE id = uid;

  INSERT INTO public.token_transactions (user_id, mission_id, amount, reason)
  VALUES (uid, p_mission_id, -1, 'bid_placement');

  INSERT INTO public.mission_bids (
    mission_id,
    cleaner_id,
    bid_amount,
    status,
    offer_packages
  )
  VALUES (
    p_mission_id,
    uid,
    v_amount,
    'pending',
    v_packages
  )
  RETURNING id INTO v_bid_id;

  RETURN v_bid_id;
END;
$$;

REVOKE ALL ON FUNCTION public.place_mission_bid(uuid, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_mission_bid(uuid, integer, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.place_mission_bid(uuid, integer, jsonb) IS
  'Hungry-Games: Active subscription required + 1 token debit per new bid. Admins exempt. Existing pending bids update without re-debiting.';

COMMIT;
