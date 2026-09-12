-- ============================================================================
-- Configure garbage-history-purge Edge + optional n8n app_config keys
-- Paste into Supabase SQL Editor AFTER Wave D migration.
-- Replace YOUR_SUPABASE_SERVICE_ROLE_KEY only. Never commit real secrets.
-- ============================================================================
-- Reads/writes: private.app_config
-- SQL cron process_garbage_history_archives_and_purge() → pg_net → Edge
--   garbage-history-purge (R2 delete). Fail-soft if these keys are unset:
--   pins still archive (leave the public feed) even without the Edge poke.
--
-- n8n is NOT invoked from SQL. city-notification-pipeline reads:
--   1) Edge secrets N8N_ECO_ULTIMATUM_WEBHOOK_URL + N8N_ECO_ULTIMATUM_SECRET
--   2) else these private.app_config keys (optional fallback)
-- Unset webhook = skip (fail-soft). That is the intended "stub-with-config".
-- ============================================================================

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

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 1) Purge Edge URL + service role key
-- ---------------------------------------------------------------------------
INSERT INTO private.app_config (key, value) VALUES
  (
    'garbage_history_purge_url',
    'https://pnhdwlcxmcathgkigcys.supabase.co/functions/v1/garbage-history-purge'
  ),
  (
    'garbage_history_purge_key',
    'YOUR_SUPABASE_SERVICE_ROLE_KEY'
  )
  -- Optional: only if Edge Function has GARBAGE_HISTORY_PURGE_SECRET set
  -- , ('garbage_history_purge_secret', 'your-random-webhook-secret')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();

-- ---------------------------------------------------------------------------
-- 2) Optional n8n fallback (prefer Edge secrets; leave commented to stay gated)
-- ---------------------------------------------------------------------------
-- INSERT INTO private.app_config (key, value) VALUES
--   ('n8n_eco_ultimatum_webhook_url', 'https://your-n8n.example/webhook/eco-ultimatum'),
--   ('n8n_eco_ultimatum_secret', 'your-n8n-shared-secret')
-- ON CONFLICT (key) DO UPDATE
-- SET value = EXCLUDED.value,
--     updated_at = now();

-- ---------------------------------------------------------------------------
-- 3) Preview (secrets truncated)
-- ---------------------------------------------------------------------------
SELECT key,
       CASE
         WHEN key LIKE '%_key' OR key LIKE '%_secret' THEN left(value, 8) || '…'
         ELSE value
       END AS value_preview,
       updated_at
FROM private.app_config
WHERE key LIKE 'garbage_history%'
   OR key LIKE 'n8n_eco_ultimatum%'
ORDER BY key;
