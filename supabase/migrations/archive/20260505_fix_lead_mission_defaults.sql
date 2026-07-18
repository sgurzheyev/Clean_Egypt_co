-- Fix lead-gen mission defaults:
-- - Ensure category is never NULL for new lead missions
-- - Ensure amount_target is non-zero (legacy UI still reads it)
--
-- For SaaS lead-gen pins:
-- - category is used by legacy UI; set to 'public' (city-style pin)
-- - amount_target is used as a display value; set to 1 (token pin placement)

CREATE OR REPLACE FUNCTION public.create_lead_mission_with_token(
  p_service_type text,
  p_location_lat double precision,
  p_location_lng double precision,
  p_description text,
  p_photo_urls text[],
  p_building_id text DEFAULT NULL,
  p_building_height_m double precision DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_balance integer;
  v_mid uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_service_type IS NULL OR length(trim(p_service_type)) = 0 THEN
    RAISE EXCEPTION 'Missing service_type';
  END IF;

  -- Lock profile row and deduct token
  SELECT token_balance
  INTO v_balance
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF coalesce(v_balance, 0) < 1 THEN
    RAISE EXCEPTION 'Insufficient tokens';
  END IF;

  UPDATE public.profiles
  SET token_balance = token_balance - 1
  WHERE id = v_uid;

  INSERT INTO public.missions (
    creator_id,
    status,
    category,
    amount_target,
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
    1,
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
  text, double precision, double precision, text, text[], text, double precision
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision
) TO service_role;

