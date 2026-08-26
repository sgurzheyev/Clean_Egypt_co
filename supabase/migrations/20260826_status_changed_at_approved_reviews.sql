-- =============================================================================
-- 1) Isolate the 24h in_progress abandonment timer from missions.updated_at
-- 2) Treat crowdfunding status=approved as successful completion
--    (city PDF queue + peer reviews)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- status_changed_at — ticks only when missions.status changes
-- ---------------------------------------------------------------------------
ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;

COMMENT ON COLUMN public.missions.status_changed_at IS
  'Set when status changes. Abandonment of in_progress uses this, not updated_at (GPS / photo touches).';

UPDATE public.missions
SET status_changed_at = CASE
  WHEN lower(coalesce(status::text, '')) = 'in_progress'
    THEN coalesce(started_at, updated_at, created_at, now())
  ELSE coalesce(updated_at, created_at, now())
END
WHERE status_changed_at IS NULL;

ALTER TABLE public.missions
  ALTER COLUMN status_changed_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_missions_in_progress_status_changed_at
  ON public.missions (status_changed_at)
  WHERE lower(coalesce(status::text, '')) = 'in_progress';

-- Keep geography + updated_at behaviour; also stamp status_changed_at on status change only.
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
    NEW.status_changed_at := coalesce(NEW.status_changed_at, now());
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

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  ELSE
    NEW.status_changed_at := coalesce(OLD.status_changed_at, NEW.status_changed_at, now());
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Abandonment: 24h since entering in_progress, not since last row touch
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
          'previous_cleaner_id', m.cleaner_id,
          'in_progress_since', m.status_changed_at
        )
      )
    WHERE lower(coalesce(m.status::text, '')) = 'in_progress'
      AND coalesce(m.status_changed_at, m.started_at, m.updated_at) < (now() - interval '24 hours')
    RETURNING m.id
  )
  SELECT count(*)::integer INTO v_count FROM abandoned;

  RETURN coalesce(v_count, 0);
END;
$$;

COMMENT ON FUNCTION public.process_abandoned_missions() IS
  'Service-role / pg_cron: in_progress idle >24h since status_changed_at (enter in_progress), not updated_at.';

-- ---------------------------------------------------------------------------
-- Crowdfunding approved = successful completion → city PDF / reports
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_crowdfunding_completion_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new text := lower(coalesce(NEW.status::text, ''));
  v_old text := lower(coalesce(OLD.status::text, ''));
BEGIN
  IF coalesce(NEW.crowdfunding_mode, false)
     AND v_new IN ('completed', 'approved')
     AND v_old IS DISTINCT FROM v_new
     AND v_old NOT IN ('completed', 'approved')
     AND NOT EXISTS (
       SELECT 1
       FROM public.city_notification_events e
       WHERE e.mission_id = NEW.id
         AND e.event_type = 'mission_completed'
     ) THEN
    INSERT INTO public.city_notification_events (mission_id, event_type, payload, pdf_status)
    VALUES (
      NEW.id,
      'mission_completed',
      jsonb_build_object(
        'service_type', NEW.service_type,
        'location_lat', NEW.location_lat,
        'location_lng', NEW.location_lng,
        'target_budget', NEW.expected_price,
        'raised', coalesce(NEW.current_funding, 0),
        'description', NEW.description,
        'funding_expires_at', NEW.crowdfunding_expires_at,
        'completed_at', now(),
        'final_status', v_new
      ),
      'pending'
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_crowdfunding_completion_notification() IS
  'When a crowdfunding mission becomes completed or approved, queue a mission_completed city report.';

-- ---------------------------------------------------------------------------
-- Reviews allowed on crowd approved (same as P2P completed)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_review(
  p_mission_id uuid,
  p_reviewee_id uuid,
  p_rating integer,
  p_comment text DEFAULT NULL,
  p_cleaner_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_mission public.missions%ROWTYPE;
  v_comment text;
  v_id uuid;
  v_cleaner uuid;
  v_accepted_cleaner uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5';
  END IF;

  SELECT * INTO v_mission FROM public.missions WHERE id = p_mission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  v_cleaner := coalesce(p_cleaner_id, v_mission.cleaner_id);

  IF v_cleaner IS NULL THEN
    SELECT b.cleaner_id
    INTO v_accepted_cleaner
    FROM public.mission_bids b
    WHERE b.mission_id = p_mission_id
      AND lower(coalesce(b.status::text, '')) = 'accepted'
    ORDER BY b.created_at DESC NULLS LAST
    LIMIT 1;
    v_cleaner := v_accepted_cleaner;
  END IF;

  IF v_cleaner IS NULL
     AND p_reviewee_id IS NOT NULL
     AND p_reviewee_id IS DISTINCT FROM v_mission.creator_id THEN
    v_cleaner := p_reviewee_id;
  END IF;

  IF v_cleaner IS NULL THEN
    RAISE EXCEPTION 'Mission has no assigned cleaner';
  END IF;

  IF uid IS DISTINCT FROM v_mission.creator_id AND uid IS DISTINCT FROM v_cleaner THEN
    RAISE EXCEPTION 'Only mission participants can review';
  END IF;

  IF p_reviewee_id IS NULL OR p_reviewee_id = uid THEN
    RAISE EXCEPTION 'Invalid reviewee';
  END IF;

  IF p_reviewee_id IS DISTINCT FROM v_mission.creator_id
     AND p_reviewee_id IS DISTINCT FROM v_cleaner THEN
    RAISE EXCEPTION 'Reviewee is not part of this mission';
  END IF;

  IF lower(coalesce(v_mission.status::text, '')) NOT IN ('completed', 'finished', 'approved') THEN
    RAISE EXCEPTION 'Mission is not completed yet';
  END IF;

  v_comment := nullif(trim(coalesce(p_comment, '')), '');
  IF v_comment IS NOT NULL THEN
    v_comment := left(v_comment, 1000);
  END IF;

  INSERT INTO public.reviews (
    mission_id,
    reviewer_id,
    reviewee_id,
    cleaner_id,
    rating,
    comment
  )
  VALUES (
    p_mission_id,
    uid,
    p_reviewee_id,
    v_cleaner,
    p_rating,
    v_comment
  )
  ON CONFLICT (mission_id, reviewer_id)
  DO UPDATE SET
    rating = excluded.rating,
    comment = excluded.comment,
    reviewee_id = excluded.reviewee_id,
    cleaner_id = coalesce(excluded.cleaner_id, public.reviews.cleaner_id),
    created_at = now()
  RETURNING id INTO v_id;

  PERFORM public.create_notification(
    p_reviewee_id,
    'new_review',
    p_mission_id,
    uid,
    'New review',
    'You received a new review.'
  );

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.submit_review(uuid, uuid, integer, text, uuid) IS
  'Participant-gated peer review upsert. Allowed on completed, finished, and crowdfunding approved.';
