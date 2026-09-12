-- ============================================================================
-- P0-1 + P0-2 — Split crowdfunding expiry + first Stripe dollar wakes a report
-- ============================================================================
-- APPLY (remote CLI history is out of sync — do NOT rely on `supabase db push`
-- to replay older files). Paste this entire file into the Supabase SQL Editor
-- (or `psql` as a privileged role) on the hosted project. Safe to re-run:
-- CREATE OR REPLACE / DROP IF EXISTS / IF NOT EXISTS only.
-- After live apply: mark CLI version 20260912 applied (one version for all
-- 20260912_* files). Do NOT db reset remote. See
-- 04_Roadmap_Tasks/Ops_Migration_History_Repair.md and
-- docs/LIFECYCLE_FIX_APPLY_RUNBOOK.md.
--
-- Canon (Garbage_History_Lifecycle.md):
--   • Free civic pin (status=reported, $0) lives 7 days then quietly HIDES.
--     No city_notification_events / Gov PDF / n8n.
--   • First successful Stripe contribution atomically turns reported → live
--     crowdfunding, freezes the USD target (>= $2), credits the dollar, +30d.
--   • funding + 0 < raised < target past expiry → eco-ultimatum (expired +
--     crowdfunding_expired event) — unchanged.
--   • funding + raised = 0 past expiry → quiet hide (no Gov Notice).
--
-- Unpaid convert_report_to_mission may still start a 7-day funding window at
-- $0. After this migration that window can only hide, never queue Gov Notice.
-- ============================================================================

-- Civic hide clock on free pins (was NULL — no sweep could see them).
UPDATE public.missions
SET crowdfunding_expires_at = COALESCE(created_at, now()) + interval '7 days'
WHERE lower(coalesce(status::text, '')) = 'reported'
  AND coalesce(is_report, false) = true
  AND coalesce(current_funding, 0) = 0
  AND crowdfunding_expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_missions_reported_quiet_hide
  ON public.missions (crowdfunding_expires_at)
  WHERE lower(coalesce(status::text, '')) = 'reported'
    AND coalesce(current_funding, 0) = 0;

-- ---------------------------------------------------------------------------
-- create_garbage_zone_report — stamp 7-day civic hide clock
-- (same signature as 20260826_video_proof_url_and_starter_tokens.sql)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_garbage_zone_report(
  p_location_lat double precision,
  p_location_lng double precision,
  p_description text,
  p_photo_urls text[] DEFAULT ARRAY[]::text[],
  p_service_type text DEFAULT 'beach_street_cleanup',
  p_country text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_video_proof_url text DEFAULT NULL
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
  v_video text := nullif(btrim(coalesce(p_video_proof_url, '')), '');
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

  IF v_video IS NOT NULL AND char_length(v_video) > 500 THEN
    RAISE EXCEPTION 'Video proof URL too long';
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
    video_proof_url,
    country,
    city,
    crowdfunding_expires_at
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
    v_video,
    v_country,
    v_city,
    now() + interval '7 days'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_garbage_zone_report(
  double precision, double precision, text, text[], text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_garbage_zone_report(
  double precision, double precision, text, text[], text, text, text, text
) TO authenticated, service_role;

COMMENT ON FUNCTION public.create_garbage_zone_report(
  double precision, double precision, text, text[], text, text, text, text
) IS
  'Free civic pin: status=reported, $0, crowdfunding_expires_at=now()+7d (quiet hide clock — not a Gov Notice timer).';

-- ---------------------------------------------------------------------------
-- apply_stripe_contribution — optional p_target_usd wakes a reported pin
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.apply_stripe_contribution(uuid, uuid, integer, text);
DROP FUNCTION IF EXISTS public.apply_stripe_contribution(uuid, uuid, integer, text, integer);

CREATE FUNCTION public.apply_stripe_contribution(
  p_mission_id uuid,
  p_contributor_id uuid,
  p_amount_usd integer,
  p_stripe_checkout_session_id text,
  p_target_usd integer DEFAULT NULL
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
  v_started boolean := false;
  v_existing uuid;
  v_new_expires timestamptz;
  v_status text;
  v_is_report boolean;
  v_wake boolean := false;
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
      'started_work', lower(coalesce(v_mission.status::text, '')) = 'in_progress',
      'crowdfunding_expires_at', v_mission.crowdfunding_expires_at,
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

  v_status := lower(coalesce(v_mission.status::text, ''));
  v_is_report := coalesce(v_mission.is_report, false) OR v_status = 'reported';
  v_wake := v_is_report AND v_status = 'reported' AND NOT coalesce(v_mission.crowdfunding_mode, false);

  IF v_status IN ('hidden', 'archived', 'expired') THEN
    RAISE EXCEPTION 'Mission is not accepting contributions';
  END IF;

  IF NOT v_wake AND NOT coalesce(v_mission.crowdfunding_mode, false) THEN
    RAISE EXCEPTION 'This mission is direct-payment only';
  END IF;

  IF NOT public.is_garbage_removal_service(v_mission.service_type) THEN
    RAISE EXCEPTION 'Crowdfunding contributions are only for Garbage Removal';
  END IF;

  IF NOT v_wake AND v_status <> 'funding' THEN
    RAISE EXCEPTION 'Mission is not accepting contributions';
  END IF;

  -- Live campaigns reject a closed window. A still-public reported pin may be
  -- woken by the first paid session even if the civic 7d clock just elapsed
  -- (FOR UPDATE vs the hide sweep). Hidden rows already failed above.
  IF NOT v_wake
     AND v_mission.crowdfunding_expires_at IS NOT NULL
     AND v_mission.crowdfunding_expires_at < now() THEN
    RAISE EXCEPTION 'Crowdfunding window has expired';
  END IF;

  v_target := coalesce(v_mission.expected_price, 0);
  IF v_wake AND v_target < 2 THEN
    v_target := floor(coalesce(p_target_usd, 0));
  END IF;

  IF v_wake AND v_target < 2 THEN
    RAISE EXCEPTION 'Campaign target budget must be at least 2 USD';
  END IF;

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

  -- ANY successful contribution extends the funding window by +30 days from now
  -- (never shorten an already-longer deadline).
  v_new_expires := GREATEST(
    coalesce(v_mission.crowdfunding_expires_at, now()),
    now() + interval '30 days'
  );

  IF v_new_funding >= v_target THEN
    IF v_mission.cleaner_id IS NOT NULL THEN
      UPDATE public.missions
      SET
        is_report = false,
        crowdfunding_mode = true,
        current_funding = v_new_funding,
        expected_price = v_target,
        status = 'in_progress',
        started_at = coalesce(started_at, now()),
        crowdfunding_expires_at = v_new_expires
      WHERE id = p_mission_id;
      v_started := true;
    ELSE
      UPDATE public.missions
      SET
        is_report = false,
        crowdfunding_mode = true,
        current_funding = v_new_funding,
        expected_price = v_target,
        status = 'available',
        crowdfunding_expires_at = v_new_expires
      WHERE id = p_mission_id;
      v_opened := true;
    END IF;
  ELSE
    UPDATE public.missions
    SET
      is_report = false,
      crowdfunding_mode = true,
      current_funding = v_new_funding,
      expected_price = v_target,
      status = 'funding',
      crowdfunding_expires_at = v_new_expires
    WHERE id = p_mission_id;
  END IF;

  RETURN jsonb_build_object(
    'mission_id', p_mission_id,
    'amount_usd', v_amount,
    'current_funding', v_new_funding,
    'target_budget', v_target,
    'opened_for_bidding', v_opened,
    'started_work', v_started,
    'crowdfunding_expires_at', v_new_expires,
    'idempotent', false,
    'woke_from_report', v_wake
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_stripe_contribution(uuid, uuid, integer, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_stripe_contribution(uuid, uuid, integer, text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.apply_stripe_contribution(uuid, uuid, integer, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_stripe_contribution(uuid, uuid, integer, text, integer) TO service_role;

COMMENT ON FUNCTION public.apply_stripe_contribution(uuid, uuid, integer, text, integer) IS
  'Credits Stripe contribution (idempotent on session id). First paid dollar on a reported pin atomically converts to crowdfunding, freezes expected_price from draft or p_target_usd (>= $2), then GREATEST(expires, now()+30d). Target met → in_progress if cleaner locked, else available.';

-- ---------------------------------------------------------------------------
-- process_expired_crowdfunding_missions — $0 hide vs partial-raise Gov Notice
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
  v_raised integer;
  v_target integer;
BEGIN
  FOR v_row IN
    SELECT m.*
    FROM public.missions m
    WHERE COALESCE(
            m.crowdfunding_expires_at,
            m.created_at + interval '7 days',
            now() - interval '1 second'
          ) < now()
      AND (
        -- Aged free civic pins that never took a dollar.
        (
          lower(coalesce(m.status::text, '')) = 'reported'
          AND coalesce(m.current_funding, 0) = 0
        )
        OR
        -- Live campaigns past the window and still under target (incl. $0).
        (
          coalesce(m.crowdfunding_mode, false) = true
          AND lower(coalesce(m.status::text, '')) = 'funding'
          AND (
            coalesce(m.expected_price, 0) < 1
            OR coalesce(m.current_funding, 0) < coalesce(m.expected_price, 0)
          )
        )
      )
    FOR UPDATE OF m SKIP LOCKED
  LOOP
    v_expires := COALESCE(
      v_row.crowdfunding_expires_at,
      v_row.created_at + interval '7 days',
      now()
    );
    v_raised := coalesce(v_row.current_funding, 0);
    v_target := coalesce(v_row.expected_price, 0);

    -- Quiet hide: nothing raised — never queue Gov Notice / city PDF.
    IF v_raised <= 0 THEN
      UPDATE public.missions
      SET
        status = 'hidden',
        crowdfunding_expires_at = COALESCE(crowdfunding_expires_at, v_expires)
      WHERE id = v_row.id
        AND lower(coalesce(status::text, '')) IN ('reported', 'funding')
        AND coalesce(current_funding, 0) <= 0;

      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated > 0 THEN
        v_count := v_count + 1;
      END IF;
      CONTINUE;
    END IF;

    -- Eco-ultimatum: 0 < raised < target (or raised > 0 with an invalid target).
    IF v_target >= 1 AND v_raised >= v_target THEN
      CONTINUE; -- funded under the lock
    END IF;

    UPDATE public.missions
    SET
      status = 'expired',
      crowdfunding_expires_at = COALESCE(crowdfunding_expires_at, v_expires)
    WHERE id = v_row.id
      AND lower(coalesce(status::text, '')) = 'funding'
      AND coalesce(current_funding, 0) > 0
      AND (
        coalesce(expected_price, 0) < 1
        OR coalesce(current_funding, 0) < coalesce(expected_price, 0)
      );

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      CONTINUE;
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
        'raised', v_raised,
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
  'Service-role / pg_cron: $0-raised reported/funding past expiry → status=hidden (no city_notification_events). 0 < raised < target funding → expired + crowdfunding_expired Gov Notice. FOR UPDATE SKIP LOCKED.';

COMMENT ON COLUMN public.missions.crowdfunding_expires_at IS
  'Timer. Free civic pin: created_at/now + 7 days (quiet hide if still $0). Live campaign: +7d at convert/create; GREATEST(expires, now()+30d) after any successful Stripe contribution.';

COMMENT ON FUNCTION public.convert_report_to_mission(uuid, integer, boolean) IS
  'Optional unpaid convert. Crowd path still enters funding at $0 with a 7-day window; process_expired_crowdfunding_missions hides $0 campaigns without Gov Notice. Preferred on-ramp is first Stripe dollar via apply_stripe_contribution.';
