-- ============================================================================
-- Fix submit_mission_proof: type "geography" does not exist
-- ============================================================================
-- Cause: SECURITY DEFINER used SET search_path = public only.
-- On Supabase, PostGIS types/functions usually live in `extensions`, so
-- unqualified `geography` / ST_* fail when submitting a video/photo proof.
--
-- Fix: SET search_path = public, extensions on the RPC + location sync trigger.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- Location sync trigger (lat/lng → missions.location)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.missions_touch_location_and_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.location IS NULL AND NEW.location_lat IS NOT NULL AND NEW.location_lng IS NOT NULL THEN
      NEW.location := ST_SetSRID(
        ST_MakePoint(NEW.location_lng, NEW.location_lat),
        4326
      )::geography;
    END IF;
    NEW.updated_at := coalesce(NEW.updated_at, now());
    RETURN NEW;
  END IF;

  IF NEW.location_lat IS DISTINCT FROM OLD.location_lat
     OR NEW.location_lng IS DISTINCT FROM OLD.location_lng THEN
    IF NEW.location_lat IS NOT NULL AND NEW.location_lng IS NOT NULL THEN
      NEW.location := ST_SetSRID(
        ST_MakePoint(NEW.location_lng, NEW.location_lat),
        4326
      )::geography;
    ELSE
      NEW.location := NULL;
    END IF;
  ELSIF NEW.location IS NULL AND NEW.location_lat IS NOT NULL AND NEW.location_lng IS NOT NULL THEN
    NEW.location := ST_SetSRID(
      ST_MakePoint(NEW.location_lng, NEW.location_lat),
      4326
    )::geography;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- submit_mission_proof — GPS gate + crowdfunding video / P2P photos
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_mission_proof(
  p_mission_id uuid,
  p_after_photo_urls text[],
  p_worker_lat double precision,
  p_worker_lng double precision,
  p_completion_distance_meters integer DEFAULT NULL,
  p_proof_video_url text DEFAULT NULL,
  p_liveness_lat double precision DEFAULT NULL,
  p_liveness_lng double precision DEFAULT NULL,
  p_completion_lat double precision DEFAULT NULL,
  p_completion_lng double precision DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  uid uuid := auth.uid();
  v_mission record;
  v_mission_loc geography;
  v_worker_lat double precision;
  v_worker_lng double precision;
  v_distance_m double precision;
  v_is_crowd boolean;
  v_video text;
  v_photos text[];
  v_new_status text;
  n integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_worker_lat := coalesce(p_completion_lat, p_worker_lat);
  v_worker_lng := coalesce(p_completion_lng, p_worker_lng);

  IF v_worker_lat IS NULL OR v_worker_lng IS NULL
     OR NOT (v_worker_lat BETWEEN -90 AND 90)
     OR NOT (v_worker_lng BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'Valid worker GPS coordinates are required';
  END IF;

  SELECT *
  INTO v_mission
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  IF v_mission.cleaner_id IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'Only the assigned cleaner can submit proof';
  END IF;

  IF lower(coalesce(v_mission.status::text, '')) <> 'in_progress' THEN
    RAISE EXCEPTION 'Mission is not in progress';
  END IF;

  v_is_crowd := coalesce(v_mission.crowdfunding_mode, false);
  v_video := nullif(trim(coalesce(p_proof_video_url, '')), '');
  v_photos := coalesce(p_after_photo_urls, ARRAY[]::text[]);

  IF v_is_crowd THEN
    IF v_video IS NULL THEN
      RAISE EXCEPTION 'Proof video is required for crowdfunding missions';
    END IF;
    v_new_status := 'awaiting_approval';
  ELSE
    IF v_photos IS NULL OR cardinality(v_photos) < 1 THEN
      RAISE EXCEPTION 'At least one proof photo is required';
    END IF;
    v_new_status := 'review';
  END IF;

  IF v_mission.location IS NOT NULL THEN
    v_mission_loc := v_mission.location;
  ELSIF v_mission.location_lat IS NOT NULL AND v_mission.location_lng IS NOT NULL THEN
    v_mission_loc := ST_SetSRID(
      ST_MakePoint(v_mission.location_lng, v_mission.location_lat),
      4326
    )::geography;
  ELSE
    RAISE EXCEPTION 'Mission location is missing; cannot verify GPS integrity';
  END IF;

  v_distance_m := ST_Distance(
    v_mission_loc,
    ST_SetSRID(ST_MakePoint(v_worker_lng, v_worker_lat), 4326)::geography
  );

  IF v_distance_m > 200 THEN
    RAISE EXCEPTION 'GPS integrity failed: too far from mission';
  END IF;

  UPDATE public.missions m
  SET
    after_photo_urls = CASE
      WHEN v_is_crowd THEN COALESCE(v_photos, m.after_photo_urls)
      ELSE v_photos
    END,
    completion_lat = coalesce(p_completion_lat, p_worker_lat, m.completion_lat),
    completion_lng = coalesce(p_completion_lng, p_worker_lng, m.completion_lng),
    completion_distance_meters = round(v_distance_m)::integer,
    proof_video_url = CASE
      WHEN v_video IS NULL THEN m.proof_video_url
      ELSE v_video
    END,
    liveness_lat = coalesce(p_liveness_lat, p_worker_lat, m.liveness_lat),
    liveness_lng = coalesce(p_liveness_lng, p_worker_lng, m.liveness_lng),
    report_submitted_at = now(),
    status = v_new_status,
    rejection_reason = NULL,
    auto_approved = false,
    location = coalesce(m.location, v_mission_loc),
    proof_events = coalesce(m.proof_events, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'type', 'proof_submitted',
        'at', now(),
        'by', uid,
        'distance_m', round(v_distance_m)::integer,
        'status', v_new_status,
        'has_video', v_video IS NOT NULL
      )
    )
  WHERE m.id = p_mission_id
    AND m.cleaner_id = uid
    AND lower(coalesce(m.status::text, '')) = 'in_progress';

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RAISE EXCEPTION 'Mission not found or not eligible for proof submission';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_mission_proof(
  uuid, text[], double precision, double precision, integer, text, double precision, double precision,
  double precision, double precision
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_mission_proof(
  uuid, text[], double precision, double precision, integer, text, double precision, double precision,
  double precision, double precision
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_mission_proof(
  uuid, text[], double precision, double precision, integer, text, double precision, double precision,
  double precision, double precision
) TO service_role;

COMMENT ON FUNCTION public.submit_mission_proof(
  uuid, text[], double precision, double precision, integer, text, double precision, double precision,
  double precision, double precision
) IS
  'Worker-only. P2P: photos → review. Crowdfunding: R2 proof_video_url → awaiting_approval. GPS ≤200m (search_path includes extensions for PostGIS).';
