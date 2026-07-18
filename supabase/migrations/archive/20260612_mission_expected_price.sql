-- Separate worker work budget (USD) from platform token bid (amount_target).

ALTER TABLE public.missions
ADD COLUMN IF NOT EXISTS expected_price integer NULL
  CHECK (expected_price IS NULL OR expected_price >= 0);

COMMENT ON COLUMN public.missions.expected_price IS
  'Client-offered work budget in USD (what the worker earns). amount_target stores token bid for listing rank.';

CREATE OR REPLACE FUNCTION public.create_lead_mission_with_token(
  p_service_type text,
  p_location_lat double precision,
  p_location_lng double precision,
  p_description text,
  p_photo_urls text[],
  p_building_id text DEFAULT NULL,
  p_building_height_m double precision DEFAULT NULL,
  p_token_bid integer DEFAULT 1,
  p_expected_price integer DEFAULT NULL
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_service_type IS NULL OR length(trim(p_service_type)) = 0 THEN
    RAISE EXCEPTION 'Missing service_type';
  END IF;

  v_bid := greatest(1, floor(coalesce(p_token_bid, 1)));
  v_budget := floor(coalesce(p_expected_price, 0));

  IF v_budget < 1 THEN
    RAISE EXCEPTION 'Work budget required';
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

  INSERT INTO public.missions (
    creator_id,
    status,
    category,
    amount_target,
    expected_price,
    current_funding,
    service_type,
    pin_fee_usd,
    location_lat,
    location_lng,
    description,
    photo_urls,
    building_id,
    building_height_m
  )
  VALUES (
    v_uid,
    'available',
    'public',
    v_bid,
    v_budget,
    0,
    p_service_type,
    NULL,
    p_location_lat,
    p_location_lng,
    NULLIF(trim(coalesce(p_description, '')), ''),
    coalesce(p_photo_urls, array[]::text[]),
    NULLIF(trim(coalesce(p_building_id, '')), ''),
    p_building_height_m
  )
  RETURNING id INTO v_mid;

  RETURN v_mid;
END;
$$;

REVOKE ALL ON FUNCTION public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision, integer, integer
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision, integer, integer
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision, integer, integer
) TO service_role;
