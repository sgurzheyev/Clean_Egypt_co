-- ============================================================================
-- Fix: city-notification webhook config without ALTER DATABASE / GUC
-- ============================================================================
-- Managed Supabase blocks:
--   ALTER DATABASE ... SET app.settings.*
-- This migration stores Edge URL + bearer in private.app_config and rewrites
-- trg_city_notification_call_pipeline() to read from that table via pg_net.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.app_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE private.app_config IS
  'Internal key/value config (Edge URLs, webhook secrets). Not exposed via PostgREST.';

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON TABLE private.app_config FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.app_config TO postgres, service_role;

-- Seed URL for this project (safe to overwrite later via UPSERT).
-- Service role key is NOT stored here — set it in SQL Editor via
-- supabase/manual/configure_city_notification_webhook.sql
INSERT INTO private.app_config (key, value)
VALUES (
  'city_notification_pipeline_url',
  'https://pnhdwlcxmcathgkigcys.supabase.co/functions/v1/city-notification-pipeline'
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();

CREATE OR REPLACE FUNCTION public.trg_city_notification_call_pipeline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
DECLARE
  edge_url text;
  edge_key text;
  webhook_secret text;
  headers jsonb;
  body jsonb;
  req_id bigint;
BEGIN
  IF NEW.pdf_status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT c.value INTO edge_url
  FROM private.app_config c
  WHERE c.key = 'city_notification_pipeline_url';

  SELECT c.value INTO edge_key
  FROM private.app_config c
  WHERE c.key = 'city_notification_pipeline_key';

  SELECT c.value INTO webhook_secret
  FROM private.app_config c
  WHERE c.key = 'city_notification_webhook_secret';

  edge_url := nullif(btrim(coalesce(edge_url, '')), '');
  edge_key := nullif(btrim(coalesce(edge_key, '')), '');
  webhook_secret := nullif(btrim(coalesce(webhook_secret, '')), '');

  IF edge_url IS NULL OR edge_key IS NULL THEN
    RAISE NOTICE
      'city-notification-pipeline not configured (private.app_config keys city_notification_pipeline_url / city_notification_pipeline_key); event % left pending',
      NEW.id;
    RETURN NEW;
  END IF;

  IF position('YOUR_SUPABASE_SERVICE_ROLE_KEY' in edge_key) > 0
     OR position('PROJECT_REF' in edge_url) > 0 THEN
    RAISE NOTICE
      'city-notification-pipeline still using placeholders in private.app_config; event % left pending',
      NEW.id;
    RETURN NEW;
  END IF;

  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || edge_key,
    'apikey', edge_key
  );

  IF webhook_secret IS NOT NULL THEN
    headers := headers || jsonb_build_object('x-webhook-secret', webhook_secret);
  END IF;

  body := jsonb_build_object(
    'type', 'INSERT',
    'table', 'city_notification_events',
    'schema', 'public',
    'record', to_jsonb(NEW),
    'event_id', NEW.id
  );

  SELECT net.http_post(
    url := edge_url,
    headers := headers,
    body := body,
    timeout_milliseconds := 10000
  ) INTO req_id;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'city-notification webhook invoke failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_city_notification_call_pipeline() IS
  'AFTER INSERT on city_notification_events: POST to city-notification-pipeline via pg_net; reads URL/key from private.app_config (no ALTER DATABASE).';

-- Ensure trigger still exists (idempotent).
DROP TRIGGER IF EXISTS trg_city_notification_call_pipeline ON public.city_notification_events;
CREATE TRIGGER trg_city_notification_call_pipeline
  AFTER INSERT ON public.city_notification_events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_city_notification_call_pipeline();
