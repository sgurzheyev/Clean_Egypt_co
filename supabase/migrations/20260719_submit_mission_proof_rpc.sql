-- ============================================================================
-- submit_mission_proof — single secure path for in_progress → review
-- ----------------------------------------------------------------------------
-- Workers submit after photos (and optional GPS / liveness video). No wallet or
-- escrow mutations. Replaces ad-hoc client UPDATE of missions.status.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.submit_mission_proof(
  p_mission_id uuid,
  p_after_photo_urls text[],
  p_completion_lat double precision DEFAULT NULL,
  p_completion_lng double precision DEFAULT NULL,
  p_completion_distance_meters integer DEFAULT NULL,
  p_proof_video_url text DEFAULT NULL,
  p_liveness_lat double precision DEFAULT NULL,
  p_liveness_lng double precision DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_after_photo_urls IS NULL OR coalesce(array_length(p_after_photo_urls, 1), 0) < 1 THEN
    RAISE EXCEPTION 'After photos are required';
  END IF;

  UPDATE public.missions m
  SET
    after_photo_urls = p_after_photo_urls[1:9],
    completion_lat = coalesce(p_completion_lat, m.completion_lat),
    completion_lng = coalesce(p_completion_lng, m.completion_lng),
    completion_distance_meters = coalesce(p_completion_distance_meters, m.completion_distance_meters),
    proof_video_url = CASE
      WHEN p_proof_video_url IS NULL OR length(trim(p_proof_video_url)) = 0
        THEN m.proof_video_url
      ELSE trim(p_proof_video_url)
    END,
    liveness_lat = coalesce(p_liveness_lat, m.liveness_lat),
    liveness_lng = coalesce(p_liveness_lng, m.liveness_lng),
    report_submitted_at = now(),
    status = 'review',
    rejection_reason = NULL
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
  uuid, text[], double precision, double precision, integer, text, double precision, double precision
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_mission_proof(
  uuid, text[], double precision, double precision, integer, text, double precision, double precision
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_mission_proof(
  uuid, text[], double precision, double precision, integer, text, double precision, double precision
) TO service_role;

COMMENT ON FUNCTION public.submit_mission_proof(
  uuid, text[], double precision, double precision, integer, text, double precision, double precision
) IS
  'Worker-only: in_progress → review with proof media. No escrow/wallet changes.';
