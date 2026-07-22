-- ============================================================================
-- Stabilization: crowdfunding concurrency, expiry race, GPS audit, stuck timers
-- ============================================================================
-- Fixes from core-logic audit (no new product features):
-- 1) apply_stripe_contribution: funding-only, expiry gate, reject overfunding
-- 2) process_expired_crowdfunding_missions: FOR UPDATE + conditional UPDATE
-- 3) submit_mission_proof: always persist server ST_Distance (ignore client meters)
-- 4) process_stuck_reviews: idle clock keyed off report_submitted_at
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Cap concurrent remainder contributions / stop post-target credits
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_stripe_contribution(
  p_mission_id uuid,
  p_contributor_id uuid,
  p_amount_usd integer,
  p_stripe_checkout_session_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mission record;
  v_amount integer;
  v_new_funding integer;
  v_target integer;
  v_remaining integer;
  v_opened boolean := false;
  v_existing uuid;
BEGIN
  IF p_stripe_checkout_session_id IS NULL OR length(trim(p_stripe_checkout_session_id)) = 0 THEN
    RAISE EXCEPTION 'Missing Stripe session id';
  END IF;

  -- Idempotency: same Stripe session never double-credits.
  SELECT id INTO v_existing
  FROM public.contributions
  WHERE stripe_checkout_session_id = p_stripe_checkout_session_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    SELECT *
    INTO v_mission
    FROM public.missions
    WHERE id = p_mission_id;

    RETURN jsonb_build_object(
      'mission_id', p_mission_id,
      'amount_usd', p_amount_usd,
      'current_funding', coalesce(v_mission.current_funding, 0),
      'target_budget', coalesce(v_mission.expected_price, 0),
      'opened_for_bidding', lower(coalesce(v_mission.status::text, '')) = 'available',
      'idempotent', true
    );
  END IF;

  v_amount := floor(coalesce(p_amount_usd, 0));
  IF v_amount < 1 THEN
    RAISE EXCEPTION 'Contribution must be at least 1 USD';
  END IF;

  SELECT *
  INTO v_mission
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  IF NOT coalesce(v_mission.crowdfunding_mode, false) THEN
    RAISE EXCEPTION 'This mission is direct-payment only';
  END IF;

  IF NOT public.is_garbage_removal_service(v_mission.service_type) THEN
    RAISE EXCEPTION 'Crowdfunding contributions are only for Garbage Removal';
  END IF;

  -- Only open funding campaigns accept new money (not already-available).
  IF lower(coalesce(v_mission.status::text, '')) <> 'funding' THEN
    RAISE EXCEPTION 'Mission is not accepting contributions';
  END IF;

  IF v_mission.crowdfunding_expires_at IS NOT NULL
     AND v_mission.crowdfunding_expires_at < now() THEN
    RAISE EXCEPTION 'Crowdfunding window has expired';
  END IF;

  v_target := coalesce(v_mission.expected_price, 0);
  IF v_target < 1 THEN
    RAISE EXCEPTION 'Campaign target budget is invalid';
  END IF;

  v_remaining := greatest(0, v_target - coalesce(v_mission.current_funding, 0));
  IF v_remaining < 1 THEN
    RAISE EXCEPTION 'Campaign already funded';
  END IF;

  -- Reject oversubscription so Stripe ops can refund; do not silently credit excess.
  IF v_amount > v_remaining THEN
    RAISE EXCEPTION 'Contribution exceeds remaining budget (% USD left)', v_remaining;
  END IF;

  INSERT INTO public.contributions (
    mission_id,
    contributor_id,
    amount_usd,
    stripe_checkout_session_id
  )
  VALUES (
    p_mission_id,
    p_contributor_id,
    v_amount,
    p_stripe_checkout_session_id
  );

  v_new_funding := coalesce(v_mission.current_funding, 0) + v_amount;

  IF v_new_funding >= v_target THEN
    UPDATE public.missions
    SET
      current_funding = v_new_funding,
      status = 'available'
    WHERE id = p_mission_id;
    v_opened := true;
  ELSE
    UPDATE public.missions
    SET current_funding = v_new_funding
    WHERE id = p_mission_id;
  END IF;

  RETURN jsonb_build_object(
    'mission_id', p_mission_id,
    'amount_usd', v_amount,
    'current_funding', v_new_funding,
    'target_budget', v_target,
    'opened_for_bidding', v_opened,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_stripe_contribution(uuid, uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_stripe_contribution(uuid, uuid, integer, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Expiry sweep must not clobber a mission that funded under the SELECT
-- ---------------------------------------------------------------------------
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
  v_updated integer;
BEGIN
  FOR v_row IN
    SELECT m.*
    FROM public.missions m
    WHERE coalesce(m.crowdfunding_mode, false) = true
      AND lower(coalesce(m.status::text, '')) = 'funding'
      AND (
        coalesce(m.expected_price, 0) < 1
        OR coalesce(m.current_funding, 0) < coalesce(m.expected_price, 0)
      )
      AND COALESCE(
            m.crowdfunding_expires_at,
            m.created_at + interval '7 days',
            now() - interval '1 second'
          ) < now()
    FOR UPDATE OF m SKIP LOCKED
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
    WHERE id = v_row.id
      AND lower(coalesce(status::text, '')) = 'funding'
      AND (
        coalesce(expected_price, 0) < 1
        OR coalesce(current_funding, 0) < coalesce(expected_price, 0)
      );

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      CONTINUE; -- funded or moved under lock
    END IF;

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

-- ---------------------------------------------------------------------------
-- 3) Proof GPS distance: server ST_Distance only (client meters ignored)
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
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_mission record;
  v_mission_loc geography;
  v_worker_lat double precision;
  v_worker_lng double precision;
  v_distance_m double precision;
  n integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_after_photo_urls IS NULL OR cardinality(p_after_photo_urls) < 1 THEN
    RAISE EXCEPTION 'At least one proof photo is required';
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

  -- p_completion_distance_meters is accepted for API compat but NEVER stored.
  UPDATE public.missions m
  SET
    after_photo_urls = p_after_photo_urls[1:9],
    completion_lat = coalesce(p_completion_lat, p_worker_lat, m.completion_lat),
    completion_lng = coalesce(p_completion_lng, p_worker_lng, m.completion_lng),
    completion_distance_meters = round(v_distance_m)::integer,
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

-- ---------------------------------------------------------------------------
-- 4) Stuck reviews: do not reset idle clock on unrelated updated_at touches
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
      proof_events = coalesce(m.proof_events, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'type', 'auto_approved_timeout',
          'at', now()
        )
      )
    WHERE lower(coalesce(m.status::text, '')) IN ('review', 'pending_approval')
      AND coalesce(m.report_submitted_at, m.updated_at) < (now() - interval '3 days')
    RETURNING m.id
  )
  SELECT count(*)::integer INTO v_count FROM stuck;

  RETURN coalesce(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.process_stuck_reviews() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_stuck_reviews() TO service_role;

COMMENT ON FUNCTION public.process_stuck_reviews() IS
  'Service-role / pg_cron: review idle >3d since report_submitted_at → completed + auto_approved.';
