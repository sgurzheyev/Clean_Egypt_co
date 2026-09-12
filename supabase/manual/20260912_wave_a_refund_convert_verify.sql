-- ============================================================================
-- Manual verify: P0-3 overfund auto-refund + P1-4 creator-only convert
-- ============================================================================
-- Apply first (SQL Editor, in order):
--   1) supabase/migrations/20260912_split_expiry_and_first_donate_wake.sql
--   2) supabase/migrations/20260912_overfund_refund_and_creator_convert.sql
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
    'apply_stripe_contribution',
    'claim_contribution_reject_refund',
    'mark_contribution_reject_refund',
    'convert_report_to_mission'
  )
ORDER BY 1, 2;

-- apply + refund RPCs must be service_role only. convert stays authenticated.
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
    'apply_stripe_contribution',
    'claim_contribution_reject_refund',
    'mark_contribution_reject_refund',
    'convert_report_to_mission'
  )
  AND r.rolname IN ('anon', 'authenticated', 'service_role', 'postgres')
ORDER BY 1, 2, 3;
-- Expect:
--   apply / claim / mark: authenticated + anon = false; service_role = true
--   convert_report_to_mission: authenticated = true; anon = false

-- 2) P0 apply signature must still be the 5-arg wake form (do not regress P0-2)
SELECT
  pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'apply_stripe_contribution';
-- Expect exactly: p_mission_id uuid, p_contributor_id uuid, p_amount_usd integer,
--                 p_stripe_checkout_session_id text, p_target_usd integer DEFAULT NULL

-- 3) convert source must contain the creator gate
SELECT
  pg_get_functiondef(p.oid) ILIKE '%Only the report creator can convert this pin%'
    AS has_creator_gate
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'convert_report_to_mission'
  AND pg_get_function_identity_arguments(p.oid) = 'p_mission_id uuid, p_expected_price integer, p_crowdfunding_mode boolean';
-- Expect true

-- 4) Refund ledger exists + RLS on
SELECT
  c.relname,
  c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'stripe_contribution_refunds';
-- Expect 1 row, rls_enabled = true

-- 5) Ops view: pending / failed refunds (should trend to empty after Edge retries)
SELECT
  status,
  count(*) AS n,
  min(created_at) AS oldest,
  max(updated_at) AS newest
FROM public.stripe_contribution_refunds
GROUP BY 1
ORDER BY 1;

-- ============================================================================
-- Fixture rehearsal (STAGING ONLY — uncomment as a block)
-- ============================================================================
-- Requires two real user UUIDs (creator + neighbor) and service_role / SQL Editor.
--
-- -- P1-4: neighbor unpaid-convert must fail; creator still succeeds.
-- -- INSERT INTO missions (creator_id, status, is_report, crowdfunding_mode,
-- --   service_type, category, expected_price, current_funding, location_lat,
-- --   location_lng, description, crowdfunding_expires_at)
-- -- VALUES
-- --   ('<creator>', 'reported', true, false, 'beach_street_cleanup', 'public',
-- --    0, 0, 27.25, 33.81, 'P1-4 hijack', now() + interval '6 days')
-- -- RETURNING id;
-- --
-- -- SET LOCAL ROLE authenticated;  -- or impersonate neighbor via JWT
-- -- SELECT set_config('request.jwt.claim.sub', '<neighbor>', true);
-- -- SELECT public.convert_report_to_mission('<reported-id>', 20, true);
-- -- -- Expect: ERROR Only the report creator can convert this pin
-- --
-- -- SELECT set_config('request.jwt.claim.sub', '<creator>', true);
-- -- SELECT id, status, creator_id, expected_price
-- -- FROM public.convert_report_to_mission('<reported-id>', 20, true);
-- -- -- Expect: status=funding, expected_price=20, creator_id unchanged
-- --
-- -- P0-3 claim: over-budget reject must be refundable once; credited session skips.
-- -- SET LOCAL ROLE service_role;
-- -- SELECT public.apply_stripe_contribution(
-- --   '<funding-id>', '<neighbor>', 999, 'cs_test_overfund_1', NULL);
-- -- -- Expect: ERROR Contribution exceeds remaining budget
-- --
-- -- SELECT public.claim_contribution_reject_refund(
-- --   'cs_test_overfund_1', '<funding-id>', '<neighbor>', 999,
-- --   'Contribution exceeds remaining budget (N USD left)');
-- -- -- Expect: action=proceed, status=pending
-- --
-- -- SELECT public.claim_contribution_reject_refund(
-- --   'cs_test_overfund_1', '<funding-id>', '<neighbor>', 999,
-- --   'Contribution exceeds remaining budget (N USD left)');
-- -- -- Expect: action=proceed (still pending) or already_done after Edge marks it
-- --
-- -- -- After a real Stripe test race (two Checkouts for the last $N):
-- -- --   winner: contributions row + current_funding increased
-- -- --   loser: stripe_contribution_refunds.status IN ('refunded','already_refunded')
-- -- --          AND Stripe Dashboard shows a refund with
-- -- --          idempotency key cf-reject-refund:cs_...
-- -- -- Replay webhook/confirm on the loser session → no second refund.
-- --
-- -- -- P0-2 still works for the neighbor (do not convert first):
-- -- -- SELECT public.apply_stripe_contribution(
-- -- --   '<fresh-reported-id>', '<neighbor>', 5, 'cs_test_p0_wake_wave_a', 20);
-- -- -- Expect: funding, expected_price=20, current_funding=5, woke_from_report
