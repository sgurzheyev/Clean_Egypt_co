-- ============================================================================
-- Phase 5: Device push tokens + webhook → send-push-notification Edge Function
-- ============================================================================
-- • public.user_push_tokens — FCM / Web Push device registrations
-- • RLS: users manage only their own tokens
-- • AFTER INSERT on public.notifications → pg_net call to Edge (optional until
--   private.app_config is filled — see supabase/manual/configure_push_webhook.sql)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text NOT NULL DEFAULT 'web'
    CHECK (lower(platform) IN ('web', 'android', 'ios')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_push_tokens_token_key UNIQUE (token)
);

COMMENT ON TABLE public.user_push_tokens IS
  'Phase 5: FCM / Web Push device tokens per user. Fed by client registration; consumed by send-push-notification Edge Function.';

CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user
  ON public.user_push_tokens (user_id, last_used_at DESC);

ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_push_tokens_select_own ON public.user_push_tokens;
CREATE POLICY user_push_tokens_select_own
  ON public.user_push_tokens
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_push_tokens_insert_own ON public.user_push_tokens;
CREATE POLICY user_push_tokens_insert_own
  ON public.user_push_tokens
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_push_tokens_update_own ON public.user_push_tokens;
CREATE POLICY user_push_tokens_update_own
  ON public.user_push_tokens
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_push_tokens_delete_own ON public.user_push_tokens;
CREATE POLICY user_push_tokens_delete_own
  ON public.user_push_tokens
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_push_tokens TO authenticated;
GRANT ALL ON public.user_push_tokens TO service_role;

-- Upsert helper (authenticated): refresh last_used_at when the same token re-registers.
CREATE OR REPLACE FUNCTION public.upsert_user_push_token(
  p_token text,
  p_platform text DEFAULT 'web'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_platform text;
  v_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_token IS NULL OR length(trim(p_token)) < 8 THEN
    RAISE EXCEPTION 'Invalid push token';
  END IF;

  v_platform := lower(trim(coalesce(nullif(p_platform, ''), 'web')));
  IF v_platform NOT IN ('web', 'android', 'ios') THEN
    v_platform := 'web';
  END IF;

  INSERT INTO public.user_push_tokens (user_id, token, platform, last_used_at)
  VALUES (uid, trim(p_token), v_platform, now())
  ON CONFLICT (token) DO UPDATE
  SET
    user_id = uid,
    platform = EXCLUDED.platform,
    last_used_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_user_push_token(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_user_push_token(text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.upsert_user_push_token(text, text) IS
  'Register or refresh the caller''s FCM/Web Push device token.';

-- ---------------------------------------------------------------------------
-- Optional pg_net bridge: notifications INSERT → Edge Function
-- ---------------------------------------------------------------------------
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

INSERT INTO private.app_config (key, value)
VALUES (
  'send_push_notification_url',
  'https://pnhdwlcxmcathgkigcys.supabase.co/functions/v1/send-push-notification'
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();

CREATE OR REPLACE FUNCTION public.trg_notifications_send_push()
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
  SELECT c.value INTO edge_url
  FROM private.app_config c
  WHERE c.key = 'send_push_notification_url';

  SELECT c.value INTO edge_key
  FROM private.app_config c
  WHERE c.key = 'send_push_notification_key';

  SELECT c.value INTO webhook_secret
  FROM private.app_config c
  WHERE c.key = 'send_push_notification_webhook_secret';

  edge_url := nullif(btrim(coalesce(edge_url, '')), '');
  edge_key := nullif(btrim(coalesce(edge_key, '')), '');
  webhook_secret := nullif(btrim(coalesce(webhook_secret, '')), '');

  IF edge_url IS NULL OR edge_key IS NULL THEN
    RAISE NOTICE
      'send-push-notification not configured (private.app_config keys send_push_notification_url / send_push_notification_key); notification % skipped for push',
      NEW.id;
    RETURN NEW;
  END IF;

  IF position('YOUR_SUPABASE_SERVICE_ROLE_KEY' in edge_key) > 0 THEN
    RAISE NOTICE 'send-push-notification key placeholder — skipping push for %', NEW.id;
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
    'notification_id', NEW.id,
    'user_id', NEW.user_id,
    'type', NEW.type,
    'title', coalesce(NEW.title, NEW.type),
    'message', coalesce(NEW.message, NEW.title, NEW.type),
    'mission_id', NEW.mission_id,
    'actor_id', NEW.actor_id,
    'created_at', NEW.created_at
  );

  BEGIN
    SELECT net.http_post(
      url := edge_url,
      headers := headers,
      body := body,
      timeout_milliseconds := 5000
    ) INTO req_id;
  EXCEPTION
    WHEN undefined_function THEN
      RAISE NOTICE 'pg_net.net.http_post unavailable — configure Database Webhook in Dashboard for notifications INSERT';
    WHEN OTHERS THEN
      RAISE NOTICE 'send-push-notification http_post failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_send_push ON public.notifications;
CREATE TRIGGER trg_notifications_send_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notifications_send_push();

COMMENT ON FUNCTION public.trg_notifications_send_push() IS
  'Best-effort: POST new in-app notification to send-push-notification Edge Function via pg_net.';
