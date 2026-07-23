-- ============================================================================
-- RESET_TEST_DATA.sql — clean-slate wipe for end-to-end field testing
-- ============================================================================
-- PURPOSE
--   Wipe all missions and related operational data, then give every profile a
--   fresh token balance so you can re-run Phases 1–3 (create → fund/bid →
--   accept → proof → city notification) without leftover test pins.
--
-- HOW TO RUN
--   1. Open Supabase Dashboard → SQL Editor
--   2. Paste this entire script
--   3. Review the SAFETY notes below
--   4. Click Run
--
-- SAFETY
--   * DESTRUCTIVE for missions / bids / contributions / reviews linked to missions.
--   * Intended for DEV / STAGING / dedicated test projects only.
--   * Does NOT delete auth.users or profiles (accounts + KYC stay intact).
--   * Does NOT revoke subscriptions (subscription_expires_at unchanged).
--   * Change starting_tokens below if you want a different starting balance.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  starting_tokens integer := 50;
  r record;
BEGIN
  -- ---------------------------------------------------------------------------
  -- 1) Delete every table that FK-references public.missions (children first).
  --    Dynamically discovers FKs so we never miss a dependent table
  --    (mission_bids, contributions, city_notification_events, reviews, …).
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT DISTINCT conrelid::regclass AS child
    FROM pg_constraint
    WHERE confrelid = 'public.missions'::regclass
      AND contype = 'f'
      AND conrelid <> 'public.missions'::regclass
  LOOP
    EXECUTE format('DELETE FROM %s', r.child);
    RAISE NOTICE 'Cleared dependent table: %', r.child;
  END LOOP;

  DELETE FROM public.missions;
  RAISE NOTICE 'Cleared public.missions';

  -- Belt-and-suspenders if FK discovery missed a rename.
  IF to_regclass('public.city_notification_events') IS NOT NULL THEN
    DELETE FROM public.city_notification_events;
    RAISE NOTICE 'Cleared public.city_notification_events';
  END IF;

  IF to_regclass('public.notifications') IS NOT NULL THEN
    DELETE FROM public.notifications WHERE mission_id IS NOT NULL;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 2) Reset token balances for field testing (preserve KYC / subscriptions).
  -- ---------------------------------------------------------------------------
  UPDATE public.profiles
  SET token_balance = starting_tokens;

  RAISE NOTICE 'Set token_balance = % for all profiles', starting_tokens;
END $$;

-- Verify wipe
SELECT
  (SELECT count(*) FROM public.missions) AS missions_left,
  (SELECT count(*) FROM public.city_notification_events) AS city_events_left,
  (SELECT count(*) FROM public.profiles) AS profiles_kept,
  (SELECT min(token_balance) FROM public.profiles) AS min_tokens,
  (SELECT max(token_balance) FROM public.profiles) AS max_tokens;

COMMIT;

-- ============================================================================
-- After running: hard-refresh the app (or re-login) so the map drops cached pins.
-- ============================================================================
