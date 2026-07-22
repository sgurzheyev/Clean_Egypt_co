-- ============================================================================
-- Phase 2: City notification PDF pipeline support
-- ============================================================================
-- • Extra columns for storage URL / processing metadata
-- • Storage bucket for generated PDFs
-- • Enqueue mission_completed when crowdfunding missions complete
-- • Trigger helper to POST new events to Edge Function city-notification-pipeline
--   (uses pg_net; set app settings OR replace URL/key placeholders below)
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
-- Requires extension pg_net (enabled on hosted Supabase by default in many projects).
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Store Edge URL + bearer in DB settings (set once per project):
--   ALTER DATABASE postgres SET app.settings.city_notification_pipeline_url
--     = 'https://<PROJECT_REF>.supabase.co/functions/v1/city-notification-pipeline';
--   ALTER DATABASE postgres SET app.settings.city_notification_pipeline_key
--     = '<SERVICE_ROLE_OR_WEBHOOK_SECRET>';
--
-- Or edit the fallbacks below before running in SQL Editor.

CREATE OR REPLACE FUNCTION public.trg_city_notification_call_pipeline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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

  edge_url := nullif(current_setting('app.settings.city_notification_pipeline_url', true), '');
  edge_key := nullif(current_setting('app.settings.city_notification_pipeline_key', true), '');
  webhook_secret := nullif(current_setting('app.settings.city_notification_webhook_secret', true), '');

  -- Fallback placeholders (replace PROJECT_REF / KEY if not using app.settings):
  IF edge_url IS NULL THEN
    edge_url := 'https://PROJECT_REF.supabase.co/functions/v1/city-notification-pipeline';
  END IF;
  IF edge_key IS NULL THEN
    edge_key := 'YOUR_SERVICE_ROLE_OR_ANON_KEY';
  END IF;

  -- Skip if still placeholders (avoid broken HTTP calls in fresh clones).
  IF position('PROJECT_REF' in edge_url) > 0 OR position('YOUR_SERVICE_ROLE' in edge_key) > 0 THEN
    RAISE NOTICE 'city-notification-pipeline webhook not configured (set app.settings.*); event % queued as pending', NEW.id;
    RETURN NEW;
  END IF;

  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || edge_key
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
  'AFTER INSERT on city_notification_events: POST to Edge Function city-notification-pipeline via pg_net.';
