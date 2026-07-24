-- ============================================================================
-- Free "Garbage Zone / Needs Attention" report pins + crowdfunding bridge
-- ============================================================================

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS is_report boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.missions.is_report IS
  'True for free civic garbage/hazard zone reports (status=reported). Converted pins clear this flag.';

CREATE INDEX IF NOT EXISTS idx_missions_is_report_status
  ON public.missions (is_report, status)
  WHERE is_report = true;

-- ---------------------------------------------------------------------------
-- Free report creation (no token deduction)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_garbage_zone_report(
  p_location_lat double precision,
  p_location_lng double precision,
  p_description text,
  p_photo_urls text[] DEFAULT ARRAY[]::text[],
  p_service_type text DEFAULT 'beach_street_cleanup'
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_location_lat IS NULL OR p_location_lng IS NULL THEN
    RAISE EXCEPTION 'Location required';
  END IF;

  v_service := lower(coalesce(nullif(btrim(p_service_type), ''), 'beach_street_cleanup'));
  IF NOT public.is_garbage_removal_service(v_service) THEN
    -- Reports are civic garbage/hazard zones only.
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
    photo_urls
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
    p_photo_urls[1:9]
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_garbage_zone_report(double precision, double precision, text, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_garbage_zone_report(double precision, double precision, text, text[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_garbage_zone_report(double precision, double precision, text, text[], text) TO service_role;

COMMENT ON FUNCTION public.create_garbage_zone_report(double precision, double precision, text, text[], text) IS
  'Free civic garbage-zone report pin. No token deduction. status=reported, is_report=true.';

-- ---------------------------------------------------------------------------
-- Convert report → crowdfunding (or open paid) mission — any authenticated user
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convert_report_to_mission(
  p_mission_id uuid,
  p_expected_price integer,
  p_crowdfunding_mode boolean DEFAULT true
)
RETURNS public.missions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mission public.missions;
  v_price integer;
  v_crowd boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_mission
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  IF NOT coalesce(v_mission.is_report, false)
     OR lower(coalesce(v_mission.status::text, '')) <> 'reported' THEN
    RAISE EXCEPTION 'Only open report pins can be converted';
  END IF;

  v_price := floor(coalesce(p_expected_price, 0));
  IF v_price < 5 THEN
    RAISE EXCEPTION 'Target budget must be at least 5 USD';
  END IF;

  v_crowd := coalesce(p_crowdfunding_mode, true)
    AND public.is_garbage_removal_service(v_mission.service_type);

  IF v_crowd THEN
    UPDATE public.missions
    SET
      is_report = false,
      crowdfunding_mode = true,
      status = 'funding',
      expected_price = v_price,
      amount_target = v_price,
      current_funding = coalesce(current_funding, 0),
      crowdfunding_expires_at = now() + interval '7 days'
    WHERE id = p_mission_id
    RETURNING * INTO v_mission;
  ELSE
    UPDATE public.missions
    SET
      is_report = false,
      crowdfunding_mode = false,
      status = 'available',
      expected_price = v_price,
      amount_target = v_price,
      crowdfunding_expires_at = NULL
    WHERE id = p_mission_id
    RETURNING * INTO v_mission;
  END IF;

  RETURN v_mission;
END;
$$;

REVOKE ALL ON FUNCTION public.convert_report_to_mission(uuid, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_report_to_mission(uuid, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_report_to_mission(uuid, integer, boolean) TO service_role;

COMMENT ON FUNCTION public.convert_report_to_mission(uuid, integer, boolean) IS
  'Any authenticated user converts a free report pin into funding (crowdfund) or available (paid bounty).';
