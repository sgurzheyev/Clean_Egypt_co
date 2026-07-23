-- ============================================================================
-- Configure Phase 5 push webhook (run once in SQL Editor as postgres)
-- ============================================================================
-- 1) Deploy Edge Function:
--      supabase functions deploy send-push-notification --no-verify-jwt
--    (or verify_jwt=false in config if invoked only via service role / pg_net)
--
-- 2) Set Edge secrets:
--      supabase secrets set FCM_SERVER_KEY="...."
--      supabase secrets set PUSH_WEBHOOK_SECRET="optional-shared-secret"
--      # optional: APP_DEEP_LINK_BASE="https://cleanegypt.co"
--
-- 3) Fill private.app_config below (never commit real service-role keys).
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.app_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO private.app_config (key, value) VALUES
  (
    'send_push_notification_url',
    'https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-push-notification'
  ),
  (
    'send_push_notification_key',
    'YOUR_SUPABASE_SERVICE_ROLE_KEY'
  ),
  (
    'send_push_notification_webhook_secret',
    'optional-shared-secret'
  )
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();

-- Verify:
-- SELECT key, left(value, 24) AS value_prefix, updated_at FROM private.app_config
-- WHERE key LIKE 'send_push%';
