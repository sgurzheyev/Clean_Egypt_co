-- ============================================================================
-- Manual verify: Wave D (P2-1 history window, P2-1b purge RPCs, P2-1c n8n cols)
-- ============================================================================
-- Apply first (SQL Editor, in order):
--   1) supabase/migrations/20260912_split_expiry_and_first_donate_wake.sql
--   2) supabase/migrations/20260912_overfund_refund_and_creator_convert.sql
--   3) supabase/migrations/20260912_wave_b_failed_recovery_abandon_confirm.sql
--   4) supabase/migrations/20260912_wave_c_amount_target_profile_delete.sql
--   5) supabase/migrations/20260912_wave_d_garbage_history_window.sql
-- CLI migration history is out of sync — do not rely on `supabase db push`.
-- Then run this file as a read-mostly checklist. Destructive fixture blocks
-- are commented out — uncomment only on a staging project.
-- ============================================================================

-- 1) New columns exist
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'missions'
       AND column_name IN ('history_public_until', 'media_purged_at')) AS mission_history_cols,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'city_notification_events'
       AND column_name IN ('n8n_dispatched_at', 'n8n_last_error')) AS n8n_cols;
-- Expect: mission_history_cols = 2, n8n_cols = 2

-- 2) Function identities
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'process_expired_crowdfunding_missions',
    'process_garbage_history_archives',
    'process_garbage_history_archives_and_purge',
    'claim_garbage_history_purge_batch',
    'mark_garbage_history_media_purged',
    'bump_garbage_history_public_until',
    'invoke_garbage_history_purge_edge',
    'apply_stripe_contribution',
    'process_proof_vote',
    'process_abandoned_missions',
    'creator_delete_mission'
  )
ORDER BY 1, 2;

-- 3) Grants — new RPCs are service_role only
SELECT
  p.proname,
  r.rolname,
  has_function_privilege(r.oid, p.oid, 'EXECUTE') AS can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN pg_roles r
WHERE n.nspname = 'public'
  AND p.proname IN (
    'process_garbage_history_archives',
    'claim_garbage_history_purge_batch',
    'mark_garbage_history_media_purged',
    'bump_garbage_history_public_until',
    'process_expired_crowdfunding_missions'
  )
  AND r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY 1, 2;
-- Expect: service_role = true; anon = false; authenticated = false

-- 4) Expiry source still splits $0 hide vs funded history
SELECT
  pg_get_functiondef(p.oid) ILIKE '%status = ''hidden''%' AS still_quiet_hides_zero,
  pg_get_functiondef(p.oid) ILIKE '%history_public_until = COALESCE(history_public_until, now() + interval ''7 days'')%'
    AS sets_history_window_on_expiry,
  pg_get_functiondef(p.oid) ILIKE '%history_public_until = NULL%' AS clears_window_on_zero_hide,
  position('city_notification_events' in pg_get_functiondef(p.oid)) > 0 AS still_queues_gov_notice
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'process_expired_crowdfunding_missions';
-- Expect all true

-- 5) P0 / Wave A / Wave B / Wave C must not have been clobbered
SELECT
  pg_get_function_identity_arguments(p.oid) AS apply_args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'apply_stripe_contribution';
-- Expect: p_mission_id uuid, p_contributor_id uuid, p_amount_usd integer,
--         p_stripe_checkout_session_id text, p_target_usd integer DEFAULT NULL

SELECT
  (
    SELECT pg_get_functiondef(a.oid) ILIKE '%crowdfunding_mode, false) = false%'
    FROM pg_proc a
    JOIN pg_namespace an ON an.oid = a.pronamespace
    WHERE an.nspname = 'public' AND a.proname = 'process_abandoned_missions'
      AND pg_get_function_identity_arguments(a.oid) = ''
  ) AS abandon_excludes_crowd,
  (
    SELECT position($$ELSE 'failed'$$ in pg_get_functiondef(p.oid)) = 0
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'process_proof_vote'
  ) AS proof_vote_no_failed,
  (
    SELECT pg_get_functiondef(p.oid) ILIKE '%amount_target = 1%'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'convert_report_to_mission'
      AND pg_get_function_identity_arguments(p.oid)
        = 'p_mission_id uuid, p_expected_price integer, p_crowdfunding_mode boolean'
  ) AS convert_sets_rank_one;

-- 6) History trigger on city_notification_events
SELECT tg.tgname
FROM pg_trigger tg
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'city_notification_events'
  AND NOT tg.tgisinternal
  AND tg.tgname IN (
    'trg_city_notice_bump_history_window',
    'trg_city_notification_call_pipeline'
  )
ORDER BY 1;
-- Expect both names

-- 7) Live $0 hidden pins must not have a public history window
SELECT count(*) AS hidden_with_history_window
FROM public.missions
WHERE lower(coalesce(status::text, '')) = 'hidden'
  AND history_public_until IS NOT NULL
  AND coalesce(current_funding, 0) <= 0;
-- Expect 0

-- 8) Expired funded pins should have a window after apply/backfill
SELECT count(*) AS expired_funded_missing_window
FROM public.missions
WHERE lower(coalesce(status::text, '')) = 'expired'
  AND coalesce(current_funding, 0) > 0
  AND history_public_until IS NULL;
-- Expect 0 after Wave D apply

-- ============================================================================
-- Fixture rehearsal (STAGING ONLY — uncomment as a block)
-- ============================================================================
-- Needs service_role. Do not run on production pins you care about.
--
-- -- A) $0 hide still quiet
-- -- UPDATE missions SET status='funding', crowdfunding_mode=true,
-- --   current_funding=0, expected_price=50,
-- --   crowdfunding_expires_at = now() - interval '1 hour'
-- -- WHERE id = '<zero-id>';
-- -- SELECT public.process_expired_crowdfunding_missions();
-- -- Expect: status=hidden, history_public_until IS NULL, 0 new city events
--
-- -- B) Partial raise → expired + 7d window + Gov Notice
-- -- UPDATE missions SET status='funding', crowdfunding_mode=true,
-- --   current_funding=10, expected_price=50,
-- --   crowdfunding_expires_at = now() - interval '1 hour',
-- --   history_public_until = NULL
-- -- WHERE id = '<partial-id>';
-- -- SELECT public.process_expired_crowdfunding_missions();
-- -- SELECT status, history_public_until, current_funding
-- -- FROM missions WHERE id = '<partial-id>';
-- -- Expect: expired, history_public_until ≈ now()+7d, one crowdfunding_expired
--
-- -- C) Bump on PDF sent
-- -- UPDATE city_notification_events SET pdf_status='sent', processed_at=now()
-- -- WHERE mission_id = '<partial-id>' AND event_type='crowdfunding_expired';
-- -- SELECT history_public_until FROM missions WHERE id = '<partial-id>';
-- -- Expect: window >= now()+7d (may extend if PDF sent later than expiry)
--
-- -- D) Archive after window
-- -- UPDATE missions SET history_public_until = now() - interval '1 minute'
-- -- WHERE id = '<partial-id>';
-- -- SELECT public.process_garbage_history_archives();
-- -- Expect: status=archived
--
-- -- E) Purge mark (after Edge would delete R2)
-- -- SELECT public.mark_garbage_history_media_purged('<partial-id>');
-- -- Expect: true first time, photo_urls={}, media_purged_at set
-- -- SELECT public.mark_garbage_history_media_purged('<partial-id>');
-- -- Expect: false (idempotent)
--
-- -- F) $0 / hidden must never appear in claim batch
-- -- SELECT * FROM public.claim_garbage_history_purge_batch(20);
-- -- Expect: no row with current_funding = 0 (function already filters raised>0)
