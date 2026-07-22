-- ============================================================================
-- OPTIONAL: configure Database Webhook settings for city-notification-pipeline
-- Run in SQL Editor AFTER inserting events (replace PROJECT_REF + keys).
-- ============================================================================

-- Edge Function URL
ALTER DATABASE postgres SET app.settings.city_notification_pipeline_url =
  'https://PROJECT_REF.supabase.co/functions/v1/city-notification-pipeline';

-- Prefer service_role so the function can update rows + upload storage.
-- If CITY_NOTIFICATION_WEBHOOK_SECRET is set on the function, you may use anon
-- and pass the secret via app.settings.city_notification_webhook_secret instead.
ALTER DATABASE postgres SET app.settings.city_notification_pipeline_key =
  'YOUR_SUPABASE_SERVICE_ROLE_KEY';

-- Optional shared secret (must match Edge Function secret CITY_NOTIFICATION_WEBHOOK_SECRET)
-- ALTER DATABASE postgres SET app.settings.city_notification_webhook_secret =
--   'your-random-webhook-secret';

-- Reload settings for current session (new connections pick these up automatically):
SELECT pg_reload_conf();
