-- Lower the mission work-budget floor from $5 to $2 (create lead + report convert).

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
  p_city text DEFAULT NULL,
  p_recurrence_type text DEFAULT 'one_time',
  p_video_proof_url text DEFAULT NULL
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
  v_recurrence text := lower(nullif(btrim(coalesce(p_recurrence_type, 'one_time')), ''));
  v_video text := nullif(btrim(coalesce(p_video_proof_url, '')), '');
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

  IF v_recurrence IS NULL OR v_recurrence NOT IN ('one_time', 'weekly', 'bi_weekly', 'monthly') THEN
    v_recurrence := 'one_time';
  END IF;

  IF v_video IS NOT NULL AND char_length(v_video) > 500 THEN
    RAISE EXCEPTION 'Video proof URL too long';
  END IF;

  v_bid := greatest(1, floor(coalesce(p_token_bid, 1)));
  v_budget := floor(coalesce(p_expected_price, 0));

  IF v_budget < 2 THEN
    RAISE EXCEPTION 'Work budget must be at least 2 USD';
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
    video_proof_url,
    building_id,
    building_height_m,
    crowdfunding_mode,
    crowdfunding_expires_at,
    country,
    city,
    recurrence_type
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
    v_video,
    NULLIF(trim(coalesce(p_building_id, '')), ''),
    p_building_height_m,
    v_crowdfund,
    v_expires,
    v_country,
    v_city,
    v_recurrence
  )
  RETURNING id INTO v_mid;

  RETURN v_mid;
END;
$$;

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
  IF v_price < 2 THEN
    RAISE EXCEPTION 'Target budget must be at least 2 USD';
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
