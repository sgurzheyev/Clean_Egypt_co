-- ============================================================================
-- Wave D — P2-1 Garbage History 7d window + P2-1b archive/purge RPCs
-- ============================================================================
-- APPLY (remote CLI history is out of sync — do NOT rely on `supabase db push`
-- to replay older files). Paste this entire file into the Supabase SQL Editor
-- (or `psql` as a privileged role) AFTER
-- `20260912_wave_c_amount_target_profile_delete.sql` (Wave C).
-- Safe to re-run: ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE / keyed UPDATEs.
--
-- P2-1: underfunded expiry (raised > 0) stays `expired` and gets
--   history_public_until = now() + 7 days. Public map / Live Market may show
--   that pin until the window ends. $0 quiet-hide (P0-1) still writes `hidden`
--   with NO history window and NO city_notification_events.
--   When Gov Notice PDF is marked sent/generated, the window is bumped to
--   GREATEST(existing, now()+7d) so the 7 days count from notice delivery.
--
-- P2-1b: after history_public_until, process_garbage_history_archives() sets
--   status = archived (drops public display). Edge garbage-history-purge then
--   deletes R2 keys and calls mark_garbage_history_media_purged (idempotent).
--
-- P2-1c columns: city_notification_events.n8n_dispatched_at / n8n_last_error.
--   The n8n POST itself lives in city-notification-pipeline (env-gated).
--
-- Does not redo P0 / Wave A / Wave B / Wave C.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS history_public_until timestamptz,
  ADD COLUMN IF NOT EXISTS media_purged_at timestamptz;

COMMENT ON COLUMN public.missions.history_public_until IS
  'Wave D: public Garbage History end. Set at eco-ultimatum expiry (now()+7d); bumped to GREATEST(existing, now()+7d) when Gov Notice PDF is sent/generated. $0 hidden pins stay NULL.';

COMMENT ON COLUMN public.missions.media_purged_at IS
  'Wave D: when Edge garbage-history-purge cleared reports/mission-photos/proof/city-pdfs for this row. NULL = media still on R2.';

ALTER TABLE public.city_notification_events
  ADD COLUMN IF NOT EXISTS n8n_dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS n8n_last_error text;

COMMENT ON COLUMN public.city_notification_events.n8n_dispatched_at IS
  'Wave D: when city-notification-pipeline successfully POSTed the eco-ultimatum n8n webhook. NULL = not sent or webhook unset (fail-soft).';

COMMENT ON COLUMN public.city_notification_events.n8n_last_error IS
  'Wave D: last n8n webhook error (cleared on success). Unset webhook is not an error.';

CREATE INDEX IF NOT EXISTS idx_missions_garbage_history_public
  ON public.missions (history_public_until)
  WHERE lower(coalesce(status::text, '')) = 'expired'
    AND media_purged_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_missions_garbage_history_purge
  ON public.missions (id)
  WHERE media_purged_at IS NULL
    AND lower(coalesce(status::text, '')) IN ('expired', 'archived');

-- ---------------------------------------------------------------------------
-- Backfill existing eco-ultimatum rows (raised > 0, still expired)
-- 7d from Gov Notice processed_at/created_at, else crowdfunding_expires_at.
-- Already-elapsed windows stay elapsed so the first archive cron hides them.
-- ---------------------------------------------------------------------------
UPDATE public.missions m
SET history_public_until = COALESCE(
  (
    SELECT COALESCE(e.processed_at, e.created_at) + interval '7 days'
    FROM public.city_notification_events e
    WHERE e.mission_id = m.id
      AND e.event_type = 'crowdfunding_expired'
    ORDER BY e.created_at DESC
    LIMIT 1
  ),
  COALESCE(m.crowdfunding_expires_at, m.created_at, now()) + interval '7 days'
)
WHERE lower(coalesce(m.status::text, '')) = 'expired'
  AND coalesce(m.current_funding, 0) > 0
  AND m.history_public_until IS NULL;

-- ---------------------------------------------------------------------------
-- process_expired_crowdfunding_missions — P0 split + history window on expiry
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

    -- Quiet hide: nothing raised — never queue Gov Notice / city PDF / history.
    IF v_raised <= 0 THEN
      UPDATE public.missions
      SET
        status = 'hidden',
        crowdfunding_expires_at = COALESCE(crowdfunding_expires_at, v_expires),
        history_public_until = NULL
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
      crowdfunding_expires_at = COALESCE(crowdfunding_expires_at, v_expires),
      history_public_until = COALESCE(history_public_until, now() + interval '7 days')
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
        'expired_at', now(),
        'history_public_until', now() + interval '7 days'
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
  'Service-role / pg_cron: $0-raised reported/funding past expiry → status=hidden (no city_notification_events, no history window). 0 < raised < target funding → expired + history_public_until=now()+7d + crowdfunding_expired Gov Notice. FOR UPDATE SKIP LOCKED.';

-- ---------------------------------------------------------------------------
-- Bump public history window when Gov Notice PDF is delivered
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bump_garbage_history_public_until(p_mission_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_until timestamptz;
BEGIN
  IF p_mission_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.missions
  SET history_public_until = GREATEST(
        coalesce(history_public_until, now()),
        now() + interval '7 days'
      )
  WHERE id = p_mission_id
    AND lower(coalesce(status::text, '')) = 'expired'
    AND coalesce(current_funding, 0) > 0
    AND media_purged_at IS NULL
  RETURNING history_public_until INTO v_until;

  RETURN v_until;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_garbage_history_public_until(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_garbage_history_public_until(uuid) TO service_role;

COMMENT ON FUNCTION public.bump_garbage_history_public_until(uuid) IS
  'Service-role: GREATEST(history_public_until, now()+7d) on an expired funded eco-ultimatum pin. Called when Gov Notice pdf_status becomes sent/generated.';

CREATE OR REPLACE FUNCTION public.trg_city_notice_bump_history_window()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.event_type IS DISTINCT FROM 'crowdfunding_expired' THEN
    RETURN NEW;
  END IF;
  IF NEW.pdf_status NOT IN ('sent', 'generated') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.pdf_status IN ('sent', 'generated')
     AND NEW.pdf_status IS NOT DISTINCT FROM OLD.pdf_status THEN
    RETURN NEW;
  END IF;

  PERFORM public.bump_garbage_history_public_until(NEW.mission_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_city_notice_bump_history_window ON public.city_notification_events;
CREATE TRIGGER trg_city_notice_bump_history_window
  AFTER INSERT OR UPDATE OF pdf_status, processed_at
  ON public.city_notification_events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_city_notice_bump_history_window();

-- ---------------------------------------------------------------------------
-- Archive after the 7-day public window (hides map / Live Market)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_garbage_history_archives()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
  v_updated integer;
BEGIN
  FOR v_row IN
    SELECT m.id
    FROM public.missions m
    WHERE lower(coalesce(m.status::text, '')) = 'expired'
      AND coalesce(m.current_funding, 0) > 0
      AND m.history_public_until IS NOT NULL
      AND m.history_public_until < now()
    FOR UPDATE OF m SKIP LOCKED
  LOOP
    UPDATE public.missions
    SET status = 'archived'
    WHERE id = v_row.id
      AND lower(coalesce(status::text, '')) = 'expired'
      AND history_public_until IS NOT NULL
      AND history_public_until < now();

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated > 0 THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.process_garbage_history_archives() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_garbage_history_archives() TO service_role;

COMMENT ON FUNCTION public.process_garbage_history_archives() IS
  'Service-role / pg_cron: expired + raised>0 + history_public_until < now() → status=archived. Does not delete R2; Edge garbage-history-purge follows. FOR UPDATE SKIP LOCKED. $0 hidden pins are never archived here.';

-- ---------------------------------------------------------------------------
-- Claim / mark R2 purge (Edge garbage-history-purge)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_garbage_history_purge_batch(p_limit integer DEFAULT 20)
RETURNS TABLE (
  id uuid,
  photo_urls text[],
  after_photo_urls text[],
  proof_video_url text,
  video_proof_url text,
  creator_id uuid,
  history_public_until timestamptz,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := GREATEST(1, LEAST(coalesce(p_limit, 20), 50));
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.photo_urls,
    m.after_photo_urls,
    m.proof_video_url,
    m.video_proof_url,
    m.creator_id,
    m.history_public_until,
    m.status::text
  FROM public.missions m
  WHERE m.media_purged_at IS NULL
    AND lower(coalesce(m.status::text, '')) IN ('expired', 'archived')
    AND coalesce(m.current_funding, 0) > 0
    AND m.history_public_until IS NOT NULL
    AND m.history_public_until < now()
  ORDER BY m.history_public_until ASC
  LIMIT v_limit
  FOR UPDATE OF m SKIP LOCKED;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_garbage_history_purge_batch(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_garbage_history_purge_batch(integer) TO service_role;

COMMENT ON FUNCTION public.claim_garbage_history_purge_batch(integer) IS
  'Service-role: expired/archived funded pins past history_public_until with media_purged_at IS NULL. FOR UPDATE SKIP LOCKED. Edge deletes R2 then mark_garbage_history_media_purged.';

CREATE OR REPLACE FUNCTION public.mark_garbage_history_media_purged(p_mission_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_mission_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.missions
  SET
    photo_urls = ARRAY[]::text[],
    after_photo_urls = ARRAY[]::text[],
    proof_video_url = NULL,
    video_proof_url = NULL,
    media_purged_at = COALESCE(media_purged_at, now()),
    status = CASE
      WHEN lower(coalesce(status::text, '')) = 'expired' THEN 'archived'
      ELSE status
    END
  WHERE id = p_mission_id
    AND media_purged_at IS NULL
    AND lower(coalesce(status::text, '')) IN ('expired', 'archived')
    AND history_public_until IS NOT NULL
    AND history_public_until < now()
    AND coalesce(current_funding, 0) > 0;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_garbage_history_media_purged(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_garbage_history_media_purged(uuid) TO service_role;

COMMENT ON FUNCTION public.mark_garbage_history_media_purged(uuid) IS
  'Service-role: after R2 delete, clear public media columns, set media_purged_at, archive if still expired. Idempotent no-op when already purged or still inside the history window.';

-- ---------------------------------------------------------------------------
-- Optional pg_net poke so archive cron can wake the purge Edge
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoke_garbage_history_purge_edge()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
DECLARE
  edge_url text;
  edge_key text;
  webhook_secret text;
  headers jsonb;
  req_id bigint;
BEGIN
  SELECT c.value INTO edge_url
  FROM private.app_config c
  WHERE c.key = 'garbage_history_purge_url';

  SELECT c.value INTO edge_key
  FROM private.app_config c
  WHERE c.key = 'garbage_history_purge_key';

  SELECT c.value INTO webhook_secret
  FROM private.app_config c
  WHERE c.key = 'garbage_history_purge_secret';

  edge_url := nullif(btrim(coalesce(edge_url, '')), '');
  edge_key := nullif(btrim(coalesce(edge_key, '')), '');
  webhook_secret := nullif(btrim(coalesce(webhook_secret, '')), '');

  IF edge_url IS NULL OR edge_key IS NULL THEN
    RAISE NOTICE 'garbage-history-purge not configured (private.app_config); SQL archive still ran';
    RETURN;
  END IF;

  IF position('YOUR_SUPABASE_SERVICE_ROLE_KEY' in edge_key) > 0
     OR position('PROJECT_REF' in edge_url) > 0 THEN
    RAISE NOTICE 'garbage-history-purge still using placeholders in private.app_config';
    RETURN;
  END IF;

  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || edge_key,
    'apikey', edge_key
  );

  IF webhook_secret IS NOT NULL THEN
    headers := headers || jsonb_build_object('x-webhook-secret', webhook_secret);
  END IF;

  SELECT net.http_post(
    url := edge_url,
    headers := headers,
    body := jsonb_build_object('source', 'process_garbage_history_archives'),
    timeout_milliseconds := 10000
  ) INTO req_id;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'private.app_config missing; skip purge Edge invoke';
  WHEN OTHERS THEN
    RAISE NOTICE 'garbage-history-purge invoke failed: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_garbage_history_purge_edge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_garbage_history_purge_edge() TO service_role;

COMMENT ON FUNCTION public.invoke_garbage_history_purge_edge() IS
  'Optional pg_net POST to Edge garbage-history-purge. Fail-soft if private.app_config keys are unset. See supabase/manual/configure_garbage_history_purge.sql.';

CREATE OR REPLACE FUNCTION public.process_garbage_history_archives_and_purge()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  v_count := public.process_garbage_history_archives();
  PERFORM public.invoke_garbage_history_purge_edge();
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.process_garbage_history_archives_and_purge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_garbage_history_archives_and_purge() TO service_role;

-- Hourly archive after the expiry sweep (:20). Fail-soft without pg_cron.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'archive-garbage-history') THEN
    PERFORM cron.unschedule('archive-garbage-history');
  END IF;

  PERFORM cron.schedule(
    'archive-garbage-history',
    '25 * * * *',
    $cron$SELECT public.process_garbage_history_archives_and_purge();$cron$
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available or archive schedule failed (%). Call process_garbage_history_archives_and_purge() via external cron / Edge.',
      SQLERRM;
END $$;
