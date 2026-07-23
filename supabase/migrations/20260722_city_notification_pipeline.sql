-- ============================================================================
-- Phase 2: City notification PDF pipeline support
-- ============================================================================
-- • Extra columns for storage URL / processing metadata
-- • Storage bucket for generated PDFs
-- • Enqueue mission_completed when crowdfunding missions complete
-- • Trigger helper to POST new events to Edge Function city-notification-pipeline
--   (uses pg_net; URL/key from private.app_config — see 20260723 + manual configure script)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Event row metadata
-- ---------------------------------------------------------------------------
ALTER TABLE public.city_notification_events
  ADD COLUMN IF NOT EXISTS pdf_url text,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;

COMMENT ON COLUMN public.city_notification_events.pdf_url IS
  'Public or storage path URL of the generated municipal/success PDF.';
COMMENT ON COLUMN public.city_notification_events.processed_at IS
  'When city-notification-pipeline last finished processing this row.';
COMMENT ON COLUMN public.city_notification_events.last_error IS
  'Last pipeline error (cleared on success).';

CREATE INDEX IF NOT EXISTS idx_city_notification_pending
  ON public.city_notification_events (pdf_status, created_at)
  WHERE pdf_status IN ('pending', 'generated');

-- ---------------------------------------------------------------------------
-- 2) Storage bucket (public read for Telegram/email links; tighten later if needed)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'city-notifications',
  'city-notifications',
  true,
  10485760,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Service role uploads via Edge Function; allow public read of objects.
DROP POLICY IF EXISTS city_notifications_public_read ON storage.objects;
CREATE POLICY city_notifications_public_read
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'city-notifications');

-- ---------------------------------------------------------------------------
-- 3) Enqueue success reports when crowdfunding missions complete
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_crowdfunding_completion_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(NEW.crowdfunding_mode, false)
     AND lower(coalesce(NEW.status::text, '')) = 'completed'
     AND lower(coalesce(OLD.status::text, '')) IS DISTINCT FROM 'completed' THEN
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
        'completed_at', now()
      ),
      'pending'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_crowdfunding_completion_notification ON public.missions;
CREATE TRIGGER trg_enqueue_crowdfunding_completion_notification
  AFTER UPDATE OF status ON public.missions
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_crowdfunding_completion_notification();

COMMENT ON FUNCTION public.enqueue_crowdfunding_completion_notification() IS
  'When a crowdfunding mission becomes completed, queue a mission_completed city_notification_events row.';

-- ---------------------------------------------------------------------------
-- 4) Database webhook → Edge Function (pg_net)
-- ---------------------------------------------------------------------------
-- Config lives in private.app_config (see 20260723_city_notification_webhook_app_config.sql).
-- Do NOT use ALTER DATABASE / app.settings — managed Supabase denies those GUCs.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.app_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON TABLE private.app_config FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.app_config TO postgres, service_role;

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
      'city-notification-pipeline not configured (private.app_config); event % left pending',
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

DROP TRIGGER IF EXISTS trg_city_notification_call_pipeline ON public.city_notification_events;
CREATE TRIGGER trg_city_notification_call_pipeline
  AFTER INSERT ON public.city_notification_events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_city_notification_call_pipeline();

COMMENT ON FUNCTION public.trg_city_notification_call_pipeline() IS
  'AFTER INSERT on city_notification_events: POST to city-notification-pipeline via pg_net; config in private.app_config.';
