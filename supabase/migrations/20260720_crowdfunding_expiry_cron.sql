-- ============================================================================
-- Crowdfunding funding-window expiry (street / Garbage Removal)
-- ============================================================================
-- Product name "funding_expires_at" maps to existing column:
--   missions.crowdfunding_expires_at
-- Default window: 7 days from create.
-- Sweep: funding + past expiry + underfunded → status=expired + city_notification_events.
-- ============================================================================

COMMENT ON COLUMN public.missions.crowdfunding_expires_at IS
  'Funding window end (aka funding_expires_at). Crowdfunding campaigns expire after this timestamp if underfunded.';

-- Backfill: open funding missions without an expiry get created_at + 7 days (or now()+7d).
UPDATE public.missions
SET crowdfunding_expires_at = COALESCE(created_at, now()) + interval '7 days'
WHERE coalesce(crowdfunding_mode, false) = true
  AND lower(coalesce(status::text, '')) = 'funding'
  AND crowdfunding_expires_at IS NULL;

-- Recreate expire sweep: also treat NULL expiry as created_at + 7 days.
CREATE OR REPLACE FUNCTION public.process_expired_crowdfunding_missions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
  v_expires timestamptz;
BEGIN
  FOR v_row IN
    SELECT m.*
    FROM public.missions m
    WHERE coalesce(m.crowdfunding_mode, false) = true
      AND lower(coalesce(m.status::text, '')) = 'funding'
      AND coalesce(m.current_funding, 0) < coalesce(m.expected_price, 0)
      AND COALESCE(
            m.crowdfunding_expires_at,
            m.created_at + interval '7 days',
            now() - interval '1 second'
          ) < now()
  LOOP
    v_expires := COALESCE(
      v_row.crowdfunding_expires_at,
      v_row.created_at + interval '7 days',
      now()
    );

    UPDATE public.missions
    SET
      status = 'expired',
      crowdfunding_expires_at = COALESCE(crowdfunding_expires_at, v_expires)
    WHERE id = v_row.id;

    INSERT INTO public.city_notification_events (mission_id, event_type, payload, pdf_status)
    VALUES (
      v_row.id,
      'crowdfunding_expired',
      jsonb_build_object(
        'service_type', v_row.service_type,
        'location_lat', v_row.location_lat,
        'location_lng', v_row.location_lng,
        'target_budget', v_row.expected_price,
        'raised', coalesce(v_row.current_funding, 0),
        'description', v_row.description,
        'funding_expires_at', v_expires,
        'expired_at', now()
      ),
      'pending'
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.process_expired_crowdfunding_missions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_expired_crowdfunding_missions() TO service_role;

COMMENT ON FUNCTION public.process_expired_crowdfunding_missions() IS
  'Service-role / pg_cron: expire underfunded crowdfunding missions and queue city_notification_events.';

-- New crowdfunding missions: 7-day funding window (was 14).
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

-- Schedule hourly sweep when pg_cron is available (Supabase Pro / enabled projects).
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;

  -- Unschedule prior job with same name if present (idempotent re-run).
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-crowdfunding-missions') THEN
    PERFORM cron.unschedule('expire-crowdfunding-missions');
  END IF;

  PERFORM cron.schedule(
    'expire-crowdfunding-missions',
    '20 * * * *',
    $cron$SELECT public.process_expired_crowdfunding_missions();$cron$
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available or schedule failed (%). Call process_expired_crowdfunding_missions() via external cron / Edge.',
      SQLERRM;
END $$;
