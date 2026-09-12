-- ============================================================================
-- Manual verify: Wave C (P2-3 amount_target rank, P3-4 funded DELETE block)
-- ============================================================================
-- Apply first (SQL Editor, in order):
--   1) supabase/migrations/20260912_split_expiry_and_first_donate_wake.sql
--   2) supabase/migrations/20260912_overfund_refund_and_creator_convert.sql
--   3) supabase/migrations/20260912_wave_b_failed_recovery_abandon_confirm.sql
--   4) supabase/migrations/20260912_wave_c_amount_target_profile_delete.sql
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
    'convert_report_to_mission',
    'accept_mission_bid',
    'mission_has_retained_funds',
    'creator_delete_mission',
    'admin_delete_mission',
    'apply_stripe_contribution',
    'process_proof_vote',
    'process_abandoned_missions',
    'confirm_mission_work_done'
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
    'convert_report_to_mission',
    'accept_mission_bid',
    'mission_has_retained_funds',
    'creator_delete_mission',
    'admin_delete_mission'
  )
  AND r.rolname IN ('anon', 'authenticated', 'service_role', 'postgres')
ORDER BY 1, 2, 3;
-- Expect:
--   convert / accept / creator_delete / has_retained: authenticated = true; anon = false
--   admin_delete_mission: authenticated = true (function self-checks admin)

-- 3) P2-3 source: convert writes rank 1, not v_price, into amount_target
SELECT
  position('amount_target = v_price' in pg_get_functiondef(p.oid)) = 0
    AS convert_no_usd_clobber,
  pg_get_functiondef(p.oid) ILIKE '%amount_target = 1%' AS convert_sets_rank_one,
  pg_get_functiondef(p.oid) ILIKE '%Only the report creator can convert this pin%'
    AS has_creator_gate
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'convert_report_to_mission'
  AND pg_get_function_identity_arguments(p.oid) = 'p_mission_id uuid, p_expected_price integer, p_crowdfunding_mode boolean';
-- Expect all true

-- 4) P2-3 source: accept does not assign amount_target
SELECT
  position('amount_target' in pg_get_functiondef(p.oid)) = 0
    AS accept_does_not_touch_amount_target,
  pg_get_functiondef(p.oid) ILIKE '%expected_price = v_target%' AS still_writes_usd_budget
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'accept_mission_bid'
  AND pg_get_function_identity_arguments(p.oid) = 'p_bid_id uuid, p_package_id text';
-- Expect both true

-- 5) Backfill leftover: no live row where rank still equals USD budget (>= $2)
SELECT count(*) AS leftover_usd_rank_clobber
FROM public.missions
WHERE coalesce(expected_price, 0) >= 2
  AND amount_target IS NOT DISTINCT FROM expected_price;
-- Expect 0 after Wave C apply

SELECT count(*) AS leftover_legacy_fiat_in_amount_target
FROM public.missions
WHERE coalesce(expected_price, 0) = 0
  AND coalesce(amount_target, 0) >= 100;
-- Expect 0 after Wave C apply

-- 6) P3-4 DELETE policy
SELECT
  pol.polname,
  pol.polcmd,
  pg_get_expr(pol.polqual, pol.polrelid) AS using_expr
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'missions'
  AND pol.polcmd = 'd';
-- Expect missions_delete_creator_or_admin USING includes
--   mission_has_retained_funds  AND  is_platform_admin

-- 7) P0 / Wave A / Wave B must not have been clobbered
SELECT
  pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'apply_stripe_contribution';
-- Expect: p_mission_id uuid, p_contributor_id uuid, p_amount_usd integer,
--         p_stripe_checkout_session_id text, p_target_usd integer DEFAULT NULL

SELECT
  pg_get_functiondef(p.oid) ILIKE '%Never writes failed%'
    OR position($$ELSE 'failed'$$ in pg_get_functiondef(p.oid)) = 0
    AS proof_vote_no_failed,
  (
    SELECT pg_get_functiondef(a.oid) ILIKE '%crowdfunding_mode, false) = false%'
    FROM pg_proc a
    JOIN pg_namespace an ON an.oid = a.pronamespace
    WHERE an.nspname = 'public' AND a.proname = 'process_abandoned_missions'
      AND pg_get_function_identity_arguments(a.oid) = ''
  ) AS abandon_excludes_crowd
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'process_proof_vote';
-- Expect proof_vote_no_failed = true, abandon_excludes_crowd = true

-- ============================================================================
-- Fixture rehearsal (STAGING ONLY — uncomment as a block)
-- ============================================================================
-- Needs: reporter UUID, a reported pin, a $0 funding pin, a funded pin
--        (current_funding > 0), and a pending bid.
--
-- -- P2-3 convert
-- -- SET LOCAL ROLE authenticated;
-- -- SELECT set_config('request.jwt.claim.sub', '<reporter>', true);
-- -- SELECT amount_target, expected_price
-- -- FROM public.convert_report_to_mission('<reported-id>', 50, true);
-- -- Expect: amount_target = 1, expected_price = 50, status = funding
-- --
-- -- P2-3 accept (after placing a $40 bid on a 1-token pin)
-- -- SELECT set_config('request.jwt.claim.sub', '<creator>', true);
-- -- SELECT public.accept_mission_bid('<bid-id>', NULL);
-- -- SELECT amount_target, expected_price, cleaner_id, status
-- -- FROM public.missions WHERE id = '<mission-id>';
-- -- Expect: amount_target still 1 (or prior boost), expected_price = 40
-- --
-- -- P3-4 funded DELETE
-- -- SET LOCAL ROLE authenticated;
-- -- SELECT set_config('request.jwt.claim.sub', '<creator>', true);
-- -- SELECT public.creator_delete_mission('<funded-id>');
-- -- Expect: ERROR Cannot delete a mission that has received funds
-- -- DELETE FROM public.missions WHERE id = '<funded-id>';
-- -- Expect: 0 rows (RLS)
-- --
-- -- P3-4 $0 DELETE still works
-- -- SELECT public.creator_delete_mission('<zero-funding-id>');
-- -- Expect: row gone
-- --
-- -- Neighbor / cleaner calling creator_delete_mission → ERROR Only the mission creator…
-- -- Admin still uses admin_delete_mission on funded rows (must succeed).
