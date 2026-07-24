-- ============================================================================
-- Global mission location fields (country + city) for worldwide filters
-- ============================================================================

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS city text;

COMMENT ON COLUMN public.missions.country IS
  'ISO-friendly country display name from Mapbox reverse geocode (e.g. United States).';
COMMENT ON COLUMN public.missions.city IS
  'City / place display name from Mapbox reverse geocode (e.g. Santa Barbara).';

CREATE INDEX IF NOT EXISTS idx_missions_country
  ON public.missions (country)
  WHERE country IS NOT NULL AND length(btrim(country)) > 0;

CREATE INDEX IF NOT EXISTS idx_missions_country_city
  ON public.missions (country, city)
  WHERE country IS NOT NULL AND city IS NOT NULL;

-- ---------------------------------------------------------------------------
-- create_lead_mission_with_token — persist country/city
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision, integer, integer, boolean
);

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
  p_crowdfunding_mode boolean DEFAULT false,
  p_country text DEFAULT NULL,
  p_city text DEFAULT NULL
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
  v_country text := nullif(btrim(coalesce(p_country, '')), '');
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
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
    v_expires := now() + interval '7 days';
  END IF;

  IF v_country IS NOT NULL AND char_length(v_country) > 120 THEN
    v_country := left(v_country, 120);
  END IF;
  IF v_city IS NOT NULL AND char_length(v_city) > 120 THEN
    v_city := left(v_city, 120);
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
    crowdfunding_expires_at,
    country,
    city
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
    v_expires,
    v_country,
    v_city
  )
  RETURNING id INTO v_mid;

  RETURN v_mid;
END;
$$;

REVOKE ALL ON FUNCTION public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision, integer, integer, boolean, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision, integer, integer, boolean, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision, integer, integer, boolean, text, text
) TO service_role;

-- ---------------------------------------------------------------------------
-- create_garbage_zone_report — persist country/city
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_garbage_zone_report(
  double precision, double precision, text, text[], text
);

CREATE OR REPLACE FUNCTION public.create_garbage_zone_report(
  p_location_lat double precision,
  p_location_lng double precision,
  p_description text,
  p_photo_urls text[] DEFAULT ARRAY[]::text[],
  p_service_type text DEFAULT 'beach_street_cleanup',
  p_country text DEFAULT NULL,
  p_city text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_service text;
  v_desc text;
  v_country text := nullif(btrim(coalesce(p_country, '')), '');
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_location_lat IS NULL OR p_location_lng IS NULL THEN
    RAISE EXCEPTION 'Location required';
  END IF;

  v_service := lower(coalesce(nullif(btrim(p_service_type), ''), 'beach_street_cleanup'));
  IF NOT public.is_garbage_removal_service(v_service) THEN
    v_service := 'beach_street_cleanup';
  END IF;

  v_desc := nullif(btrim(coalesce(p_description, '')), '');
  IF v_desc IS NULL THEN
    v_desc := '#GarbageZone Needs attention';
  END IF;
  IF char_length(v_desc) > 2000 THEN
    RAISE EXCEPTION 'Description too long';
  END IF;

  IF p_photo_urls IS NULL OR coalesce(cardinality(p_photo_urls), 0) < 1 THEN
    RAISE EXCEPTION 'At least one photo is required';
  END IF;

  IF v_country IS NOT NULL AND char_length(v_country) > 120 THEN
    v_country := left(v_country, 120);
  END IF;
  IF v_city IS NOT NULL AND char_length(v_city) > 120 THEN
    v_city := left(v_city, 120);
  END IF;

  INSERT INTO public.missions (
    creator_id,
    category,
    service_type,
    status,
    is_report,
    crowdfunding_mode,
    amount_target,
    expected_price,
    current_funding,
    location_lat,
    location_lng,
    description,
    photo_urls,
    country,
    city
  )
  VALUES (
    v_uid,
    'public',
    v_service,
    'reported',
    true,
    false,
    0,
    0,
    0,
    p_location_lat,
    p_location_lng,
    v_desc,
    p_photo_urls[1:9],
    v_country,
    v_city
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_garbage_zone_report(
  double precision, double precision, text, text[], text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_garbage_zone_report(
  double precision, double precision, text, text[], text, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_garbage_zone_report(
  double precision, double precision, text, text[], text, text, text
) TO service_role;
