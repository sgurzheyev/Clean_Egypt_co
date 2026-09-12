-- ============================================================================
-- Manual verify: Wave B (P1-1 failed recovery, P1-2 abandon exclude, P3-3 confirm)
-- ============================================================================
-- Apply first (SQL Editor, in order):
--   1) supabase/migrations/20260912_split_expiry_and_first_donate_wake.sql
--   2) supabase/migrations/20260912_overfund_refund_and_creator_convert.sql
--   3) supabase/migrations/20260912_wave_b_failed_recovery_abandon_confirm.sql
-- CLI migration history is out of sync — do not rely on `supabase db push`.
-- Then run this file as a read-mostly checklist. Destructive fixture blocks
-- are commented out — uncomment only on a staging project.
-- ============================================================================

-- 1) Function identities
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  pg_get_userbyid(p.proowner) AS owner
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'process_proof_vote',
    'process_abandoned_missions',
    'confirm_mission_work_done',
    'confirm_mission_direct_payment',
    'submit_mission_proof',
    'apply_stripe_contribution',
    'convert_report_to_mission'
  )
ORDER BY 1, 2;

-- 2) Grants
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  r.rolname,
  has_function_privilege(r.oid, p.oid, 'EXECUTE') AS can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN pg_roles r
WHERE n.nspname = 'public'
  AND p.proname IN (
    'process_proof_vote',
    'process_abandoned_missions',
    'confirm_mission_work_done',
    'confirm_mission_direct_payment'
  )
  AND r.rolname IN ('anon', 'authenticated', 'service_role', 'postgres')
ORDER BY 1, 2, 3;
-- Expect:
--   process_proof_vote / confirm_*: authenticated = true; anon = false
--   process_abandoned_missions: authenticated + anon = false; service_role = true

-- 3) P1-1 source: reject is recoverable; never writes status failed
SELECT
  pg_get_functiondef(p.oid) ILIKE '%Donor rejected proof — re-upload required%'
    AS has_retry_reason,
  pg_get_functiondef(p.oid) ILIKE '%Never writes failed%'
    OR position('ELSE ''failed''' in pg_get_functiondef(p.oid)) = 0
    AS no_failed_assignment
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'process_proof_vote'
  AND pg_get_function_identity_arguments(p.oid) = 'p_mission_id uuid, p_is_approved boolean';
-- Expect has_retry_reason = true
-- Expect the function body does not contain: v_new_status := … 'failed'

SELECT
  position($$v_new_status := CASE WHEN p_is_approved THEN 'approved' ELSE 'failed' END$$
    in pg_get_functiondef(p.oid)) = 0 AS old_first_no_wins_gone,
  pg_get_functiondef(p.oid) ILIKE '%in_progress%' AS has_in_progress_retry
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'process_proof_vote';
-- Expect old_first_no_wins_gone = true, has_in_progress_retry = true

-- 4) P1-2 source: crowdfunding excluded from abandon sweep
SELECT
  pg_get_functiondef(p.oid) ILIKE '%crowdfunding_mode, false) = false%'
    AS excludes_crowdfunding
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'process_abandoned_missions'
  AND pg_get_function_identity_arguments(p.oid) = '';
-- Expect true

-- 5) P3-3 confirm alias exists and wraps direct payment
SELECT
  pg_get_functiondef(p.oid) ILIKE '%confirm_mission_direct_payment%'
    AS wraps_direct_payment
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'confirm_mission_work_done'
  AND pg_get_function_identity_arguments(p.oid) = 'p_mission_id uuid';
-- Expect true

-- 6) No leftover crowd failed with an assigned cleaner (backfill)
SELECT count(*) AS leftover_failed_with_cleaner
FROM public.missions
WHERE coalesce(crowdfunding_mode, false) = true
  AND lower(coalesce(status::text, '')) = 'failed'
  AND cleaner_id IS NOT NULL;
-- Expect 0 after Wave B apply

-- 7) P0 / Wave A must not have been clobbered
SELECT
  pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'apply_stripe_contribution';
-- Expect: p_mission_id uuid, p_contributor_id uuid, p_amount_usd integer,
--         p_stripe_checkout_session_id text, p_target_usd integer DEFAULT NULL

SELECT
  pg_get_functiondef(p.oid) ILIKE '%Only the report creator can convert this pin%'
    AS has_creator_gate
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'convert_report_to_mission';
-- Expect true

-- ============================================================================
-- Fixture rehearsal (STAGING ONLY — uncomment as a block)
-- ============================================================================
-- Needs: creator, cleaner, donor UUIDs; a funded crowd mission in
-- awaiting_approval with a contributions row for the donor.
--
-- -- SET LOCAL ROLE authenticated;
-- -- SELECT set_config('request.jwt.claim.sub', '<donor>', true);
-- -- SELECT public.process_proof_vote('<awaiting-id>', false);
-- -- Expect: status=in_progress, cleaner_id unchanged, proof_video_url NULL,
-- --         rejection_reason set, no mission_proof_votes rows,
-- --         proof_events last type = donor_rejected
-- --
-- -- SELECT set_config('request.jwt.claim.sub', '<cleaner>', true);
-- -- -- submit_mission_proof(...) → awaiting_approval again
-- --
-- -- SELECT set_config('request.jwt.claim.sub', '<donor>', true);
-- -- SELECT public.process_proof_vote('<awaiting-id>', true);
-- -- Expect: status=approved
-- --
-- -- P1-2: a crowd in_progress older than 24h must survive the sweep.
-- -- UPDATE missions SET status_changed_at = now() - interval '2 days'
-- -- WHERE id = '<funded-crowd-in-progress>';
-- -- SET LOCAL ROLE service_role;
-- -- SELECT public.process_abandoned_missions();
-- -- Expect: that row still in_progress with the same cleaner_id
-- --
-- -- P2P control: an idle P2P in_progress >24h should still go available.
-- --
-- -- P3-3:
-- -- SELECT set_config('request.jwt.claim.sub', '<creator>', true);
-- -- SELECT public.confirm_mission_work_done('<p2p-review-id>');
-- -- Expect: status=completed
-- -- Neighbor / cleaner calling it → ERROR Only the mission creator…
-- -- Crowd awaiting_approval → ERROR Mission is not awaiting client review
