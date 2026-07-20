-- ============================================================================
-- Proof of Work — backend security & lifecycle automations
-- ----------------------------------------------------------------------------
-- 1) Server-side GPS gate on submit_mission_proof (PostGIS, ≤200m)
-- 2) creator_reject_proof — creator-only retry path
-- 3) process_abandoned_missions — in_progress idle → available (24h)
-- 4) process_stuck_reviews — review idle → completed + auto_approved (3d)
-- 5) pg_cron schedules for (3) hourly and (4) daily
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- Schema: geometry, timestamps, auto-approve, proof event log
-- ---------------------------------------------------------------------------

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS location geography(Point, 4326);

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS auto_approved boolean NOT NULL DEFAULT false;

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS proof_events jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.missions.location IS
  'Mission pin as geography(Point,4326); kept in sync with location_lat/lng.';
COMMENT ON COLUMN public.missions.updated_at IS
  'Last status/content change; used by abandonment and review-expiry sweeps.';
COMMENT ON COLUMN public.missions.auto_approved IS
  'True when process_stuck_reviews closed a review mission (P2P platform close only).';
COMMENT ON COLUMN public.missions.proof_events IS
  'Append-only JSONB log for proof lifecycle (reject, auto_approve, etc.).';

-- Backfill geometry from lat/lng where missing.
UPDATE public.missions
SET location = ST_SetSRID(ST_MakePoint(location_lng, location_lat), 4326)::geography
WHERE location IS NULL
  AND location_lat IS NOT NULL
  AND location_lng IS NOT NULL;

-- Backfill updated_at so sweeps do not mass-fire on first deploy.
UPDATE public.missions
SET updated_at = COALESCE(
  CASE
    WHEN lower(coalesce(status::text, '')) = 'review' THEN report_submitted_at
    WHEN lower(coalesce(status::text, '')) = 'in_progress' THEN started_at
    ELSE NULL
  END,
  started_at,
  report_submitted_at,
  created_at,
  now()
)
WHERE updated_at IS NULL;

ALTER TABLE public.missions
  ALTER COLUMN updated_at SET DEFAULT now();

UPDATE public.missions
SET updated_at = now()
WHERE updated_at IS NULL;

ALTER TABLE public.missions
  ALTER COLUMN updated_at SET NOT NULL;

CREATE OR REPLACE FUNCTION public.missions_touch_location_and_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.location IS NULL AND NEW.location_lat IS NOT NULL AND NEW.location_lng IS NOT NULL THEN
      NEW.location := ST_SetSRID(ST_MakePoint(NEW.location_lng, NEW.location_lat), 4326)::geography;
    END IF;
    NEW.updated_at := coalesce(NEW.updated_at, now());
    RETURN NEW;
  END IF;

  -- UPDATE: refresh geometry when lat/lng change
  IF NEW.location_lat IS DISTINCT FROM OLD.location_lat
     OR NEW.location_lng IS DISTINCT FROM OLD.location_lng THEN
    IF NEW.location_lat IS NOT NULL AND NEW.location_lng IS NOT NULL THEN
      NEW.location := ST_SetSRID(ST_MakePoint(NEW.location_lng, NEW.location_lat), 4326)::geography;
    ELSE
      NEW.location := NULL;
    END IF;
  ELSIF NEW.location IS NULL AND NEW.location_lat IS NOT NULL AND NEW.location_lng IS NOT NULL THEN
    NEW.location := ST_SetSRID(ST_MakePoint(NEW.location_lng, NEW.location_lat), 4326)::geography;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_missions_touch_location_and_updated_at ON public.missions;
CREATE TRIGGER trg_missions_touch_location_and_updated_at
  BEFORE INSERT OR UPDATE ON public.missions
  FOR EACH ROW
  EXECUTE FUNCTION public.missions_touch_location_and_updated_at();

-- ---------------------------------------------------------------------------
-- 1) submit_mission_proof — PostGIS GPS gate (≤200m)
-- ---------------------------------------------------------------------------

-- Drop prior 8-arg overload if present (pre-GPS-gate signature).
DO $$
BEGIN
  DROP FUNCTION IF EXISTS public.submit_mission_proof(
    uuid, text[], double precision, double precision, integer, text, double precision, double precision
  );
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

CREATE OR REPLACE FUNCTION public.submit_mission_proof(
  p_mission_id uuid,
  p_after_photo_urls text[],
  p_completion_lat double precision DEFAULT NULL,
  p_completion_lng double precision DEFAULT NULL,
  p_completion_distance_meters integer DEFAULT NULL,
  p_proof_video_url text DEFAULT NULL,
  p_liveness_lat double precision DEFAULT NULL,
  p_liveness_lng double precision DEFAULT NULL,
  p_worker_lat double precision DEFAULT NULL,
  p_worker_lng double precision DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
  uid uuid := auth.uid();
  v_mission public.missions%ROWTYPE;
  v_worker_lat double precision;
  v_worker_lng double precision;
  v_mission_loc geography;
  v_distance_m double precision;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_after_photo_urls IS NULL OR coalesce(array_length(p_after_photo_urls, 1), 0) < 1 THEN
    RAISE EXCEPTION 'After photos are required';
  END IF;

  v_worker_lat := coalesce(p_worker_lat, p_completion_lat, p_liveness_lat);
  v_worker_lng := coalesce(p_worker_lng, p_completion_lng, p_liveness_lng);

  IF v_worker_lat IS NULL OR v_worker_lng IS NULL THEN
    RAISE EXCEPTION 'Worker GPS coordinates are required';
  END IF;

  SELECT *
  INTO v_mission
  FROM public.missions m
  WHERE m.id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found or not eligible for proof submission';
  END IF;

  IF v_mission.cleaner_id IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'Mission not found or not eligible for proof submission';
  END IF;

  IF lower(coalesce(v_mission.status::text, '')) <> 'in_progress' THEN
    RAISE EXCEPTION 'Mission not found or not eligible for proof submission';
  END IF;

  v_mission_loc := v_mission.location;
  IF v_mission_loc IS NULL AND v_mission.location_lat IS NOT NULL AND v_mission.location_lng IS NOT NULL THEN
    v_mission_loc := ST_SetSRID(
      ST_MakePoint(v_mission.location_lng, v_mission.location_lat),
      4326
    )::geography;
  END IF;

  IF v_mission_loc IS NULL THEN
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
    after_photo_urls = p_after_photo_urls[1:9],
    completion_lat = coalesce(p_completion_lat, p_worker_lat, m.completion_lat),
    completion_lng = coalesce(p_completion_lng, p_worker_lng, m.completion_lng),
    completion_distance_meters = coalesce(
      p_completion_distance_meters,
      round(v_distance_m)::integer,
      m.completion_distance_meters
    ),
    proof_video_url = CASE
      WHEN p_proof_video_url IS NULL OR length(trim(p_proof_video_url)) = 0
        THEN m.proof_video_url
      ELSE trim(p_proof_video_url)
    END,
    liveness_lat = coalesce(p_liveness_lat, p_worker_lat, m.liveness_lat),
    liveness_lng = coalesce(p_liveness_lng, p_worker_lng, m.liveness_lng),
    report_submitted_at = now(),
    status = 'review',
    rejection_reason = NULL,
    auto_approved = false,
    location = coalesce(m.location, v_mission_loc),
    proof_events = coalesce(m.proof_events, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'type', 'proof_submitted',
        'at', now(),
        'by', uid,
        'distance_m', round(v_distance_m)::integer
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
  'Worker-only: in_progress → review with proof. Hard PostGIS GPS gate (≤200m). No escrow/wallet changes.';

-- ---------------------------------------------------------------------------
-- 2) creator_reject_proof — creator-only; back to in_progress + clear proof
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.creator_reject_proof(
  p_mission_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
  uid uuid := auth.uid();
  v_reason text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;
  v_reason := left(v_reason, 1000);

  UPDATE public.missions m
  SET
    status = 'in_progress',
    after_photo_urls = NULL,
    proof_video_url = NULL,
    report_submitted_at = NULL,
    completion_lat = NULL,
    completion_lng = NULL,
    completion_distance_meters = NULL,
    liveness_lat = NULL,
    liveness_lng = NULL,
    rejection_reason = v_reason,
    auto_approved = false,
    retry_count = coalesce(m.retry_count, 0) + 1,
    proof_events = coalesce(m.proof_events, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'type', 'creator_reject',
        'at', now(),
        'by', uid,
        'reason', v_reason
      )
    )
  WHERE m.id = p_mission_id
    AND m.creator_id = uid
    AND lower(coalesce(m.status::text, '')) IN ('review', 'pending_approval');

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RAISE EXCEPTION 'Mission not found or not eligible for creator reject';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.creator_reject_proof(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.creator_reject_proof(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_reject_proof(uuid, text) TO service_role;

COMMENT ON FUNCTION public.creator_reject_proof(uuid, text) IS
  'Creator-only: review → in_progress; clears proof media; stores rejection_reason for the worker.';

-- ---------------------------------------------------------------------------
-- 3) process_abandoned_missions — worker idle 24h → open again
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.process_abandoned_missions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH abandoned AS (
    UPDATE public.missions m
    SET
      status = 'available',
      cleaner_id = NULL,
      started_at = NULL,
      after_photo_urls = NULL,
      proof_video_url = NULL,
      report_submitted_at = NULL,
      completion_lat = NULL,
      completion_lng = NULL,
      completion_distance_meters = NULL,
      liveness_lat = NULL,
      liveness_lng = NULL,
      rejection_reason = NULL,
      auto_approved = false,
      proof_events = coalesce(m.proof_events, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'type', 'abandoned_timeout',
          'at', now(),
          'previous_cleaner_id', m.cleaner_id
        )
      )
    WHERE lower(coalesce(m.status::text, '')) = 'in_progress'
      AND m.updated_at < (now() - interval '24 hours')
    RETURNING m.id
  )
  SELECT count(*)::integer INTO v_count FROM abandoned;

  RETURN coalesce(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.process_abandoned_missions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_abandoned_missions() TO service_role;

COMMENT ON FUNCTION public.process_abandoned_missions() IS
  'Service-role / pg_cron: in_progress idle >24h → available, clears cleaner_id (assigned_worker).';

-- ---------------------------------------------------------------------------
-- 4) process_stuck_reviews — review idle 3d → completed + auto_approved
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.process_stuck_reviews()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH stuck AS (
    UPDATE public.missions m
    SET
      status = 'completed',
      auto_approved = true,
      rejection_reason = NULL,
      proof_events = coalesce(m.proof_events, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'type', 'auto_approved',
          'at', now(),
          'reason', 'review_idle_3_days'
        )
      )
    WHERE lower(coalesce(m.status::text, '')) IN ('review', 'pending_approval')
      AND m.updated_at < (now() - interval '3 days')
    RETURNING m.id
  )
  SELECT count(*)::integer INTO v_count FROM stuck;

  RETURN coalesce(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.process_stuck_reviews() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_stuck_reviews() TO service_role;

COMMENT ON FUNCTION public.process_stuck_reviews() IS
  'Service-role / pg_cron: review idle >3 days → completed with auto_approved=true (P2P platform close).';

-- ---------------------------------------------------------------------------
-- 5) pg_cron — hourly abandon sweep, daily review auto-approve
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-abandoned-missions') THEN
    PERFORM cron.unschedule('process-abandoned-missions');
  END IF;

  PERFORM cron.schedule(
    'process-abandoned-missions',
    '35 * * * *',
    $cron$SELECT public.process_abandoned_missions();$cron$
  );

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-stuck-reviews') THEN
    PERFORM cron.unschedule('process-stuck-reviews');
  END IF;

  PERFORM cron.schedule(
    'process-stuck-reviews',
    '15 3 * * *',
    $cron$SELECT public.process_stuck_reviews();$cron$
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE
      'pg_cron not available or schedule failed (%). Call process_abandoned_missions() / process_stuck_reviews() via external cron / Edge.',
      SQLERRM;
END $$;
