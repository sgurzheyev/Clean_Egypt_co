-- ============================================================================
-- Fix create_lead_mission_with_token for live USD schema drift
-- ----------------------------------------------------------------------------
-- Production still has pin_fee_egp (or neither pin column) on some envs; the
-- previous RPC always INSERTed pin_fee_usd = NULL and failed with 400.
-- Omit pin-fee columns entirely (always NULL historically). Also enforce
-- minimum work budget of 5 USD to match the frontend.
-- ============================================================================

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
    v_expires := now() + interval '14 days';
  END IF;

  -- Do NOT reference pin_fee_usd / pin_fee_egp — schemas diverge and both are unused (NULL).
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
