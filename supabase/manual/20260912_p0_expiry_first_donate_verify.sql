-- ============================================================================
-- Manual verify: P0 split expiry + first-donate wake
-- ============================================================================
-- Apply first: paste supabase/migrations/20260912_split_expiry_and_first_donate_wake.sql
-- into the Supabase SQL Editor (CLI migration history is out of sync).
-- Order + history repair: docs/LIFECYCLE_FIX_APPLY_RUNBOOK.md ·
-- 04_Roadmap_Tasks/Ops_Migration_History_Repair.md. Do not db push.
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
    'process_expired_crowdfunding_missions',
    'create_garbage_zone_report',
    'convert_report_to_mission'
  )
ORDER BY 1, 2;

-- apply_stripe_contribution must be service_role only (4-arg overload must be gone).
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  r.rolname,
  has_function_privilege(r.oid, p.oid, 'EXECUTE') AS can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN pg_roles r
WHERE n.nspname = 'public'
  AND p.proname = 'apply_stripe_contribution'
  AND r.rolname IN ('anon', 'authenticated', 'service_role', 'postgres')
ORDER BY 2, 3;

-- 2) Civic hide clock backfill
SELECT
  count(*) FILTER (
    WHERE lower(coalesce(status::text, '')) = 'reported'
      AND coalesce(is_report, false)
      AND coalesce(current_funding, 0) = 0
      AND crowdfunding_expires_at IS NULL
  ) AS reported_missing_hide_clock,
  count(*) FILTER (
    WHERE lower(coalesce(status::text, '')) = 'reported'
      AND crowdfunding_expires_at IS NOT NULL
  ) AS reported_with_clock
FROM public.missions;

-- ============================================================================
-- Fixture rehearsal (STAGING ONLY — uncomment as a block)
-- ============================================================================
-- Requires a real creator/contributor UUID pair and service_role.
--
-- -- A) $0 funding past expiry → hidden, ZERO city_notification_events
-- -- B) Partial raise past expiry → expired + crowdfunding_expired
-- -- C) reported pin + apply_stripe_contribution(..., p_target_usd := 20)
-- --    → funding (or available if amount >= target), current_funding credited,
-- --    crowdfunding_expires_at >= now()+30d, no prior convert required
--
-- -- Example (do not run on prod):
-- -- INSERT INTO missions (creator_id, status, is_report, crowdfunding_mode,
-- --   service_type, category, expected_price, current_funding, location_lat,
-- --   location_lng, description, crowdfunding_expires_at)
-- -- VALUES
-- --   ('<creator>', 'funding', false, true, 'beach_street_cleanup', 'public',
-- --    40, 0, 27.25, 33.81, 'P0-1 $0 hide', now() - interval '1 hour'),
-- --   ('<creator>', 'funding', false, true, 'beach_street_cleanup', 'public',
-- --    40, 10, 27.25, 33.81, 'P0-1 partial Gov', now() - interval '1 hour'),
-- --   ('<creator>', 'reported', true, false, 'beach_street_cleanup', 'public',
-- --    0, 0, 27.25, 33.81, 'P0-2 wake', now() + interval '6 days')
-- -- RETURNING id, status, current_funding;
-- --
-- -- SELECT public.process_expired_crowdfunding_missions();
-- -- SELECT id, status FROM missions WHERE description LIKE 'P0-1%';
-- -- SELECT event_type, payload->>'raised'
-- -- FROM city_notification_events
-- -- WHERE mission_id IN (SELECT id FROM missions WHERE description LIKE 'P0-1%');
-- -- -- Expect: $0 row hidden + 0 events; $10 row expired + 1 crowdfunding_expired.
-- --
-- -- SELECT public.apply_stripe_contribution(
-- --   '<reported-id>', '<contributor>', 5, 'cs_test_p0_wake_1', 20);
-- -- -- Expect: status=funding, expected_price=20, current_funding=5,
-- -- --         crowdfunding_mode=true, is_report=false, expires ~ now()+30d
-- --
-- -- SELECT public.apply_stripe_contribution(
-- --   '<reported-id>', '<contributor>', 5, 'cs_test_p0_wake_1', 20);
-- -- -- Expect: idempotent=true, funding unchanged

-- 3) After a real sweep, $0 rows must not have Gov events
SELECT
  m.id,
  m.status,
  m.current_funding,
  m.expected_price,
  e.id AS city_event_id,
  e.event_type
FROM public.missions m
LEFT JOIN public.city_notification_events e
  ON e.mission_id = m.id
 AND e.event_type = 'crowdfunding_expired'
WHERE lower(coalesce(m.status::text, '')) = 'hidden'
  AND coalesce(m.current_funding, 0) = 0
  AND e.id IS NOT NULL;
-- Expect 0 rows for campaigns hidden by this sweep.
