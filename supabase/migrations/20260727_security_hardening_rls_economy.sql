-- ============================================================================
-- CRITICAL security hardening (2026-07-27 production audit)
-- ----------------------------------------------------------------------------
-- Findings addressed (live DB + codebase):
--   1. mission_bids: RLS was OFF with anon TRUNCATE/DELETE/UPDATE grants
--   2. profiles: users could UPDATE own token_balance / wallet / role / is_banned
--      (economy mint + self-promotion to is_platform_admin via role='admin')
--   3. phone_number SELECT revoke had drifted — re-assert Hungry-Games lock
--   4. credit_tokens_* / apply_stripe_contribution EXECUTE leaked to anon/auth
--   5. notifications INSERT policy WITH CHECK (true) — spam vector
--   6. Broad TRUNCATE grants on sensitive tables for API roles
--   7. contributions SELECT open to all authenticated
--   8. Legacy place_mission_bid overloads
--
-- Also adds admin SECURITY DEFINER RPCs so AdminDashboard no longer needs
-- direct cross-user UPDATE/SELECT of locked finance columns.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) mission_bids — enable RLS, revoke dangerous grants, participant SELECT
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.mission_bids ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mission_bids FROM PUBLIC;
REVOKE ALL ON TABLE public.mission_bids FROM anon;
REVOKE ALL ON TABLE public.mission_bids FROM authenticated;
GRANT SELECT ON TABLE public.mission_bids TO authenticated;
GRANT ALL ON TABLE public.mission_bids TO service_role;

DROP POLICY IF EXISTS mission_bids_select_participants ON public.mission_bids;
DROP POLICY IF EXISTS "Allow users to read mission bids" ON public.mission_bids;
DROP POLICY IF EXISTS mission_bids_select_all ON public.mission_bids;
DROP POLICY IF EXISTS mission_bids_insert_own ON public.mission_bids;
DROP POLICY IF EXISTS mission_bids_update_own ON public.mission_bids;
DROP POLICY IF EXISTS mission_bids_delete_own ON public.mission_bids;

-- No INSERT/UPDATE/DELETE policies for clients — writes go through SECURITY DEFINER
-- place_mission_bid / accept_mission_bid (table owner bypasses RLS).
CREATE POLICY mission_bids_select_participants
  ON public.mission_bids
  FOR SELECT
  TO authenticated
  USING (
    cleaner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.missions m
      WHERE m.id = mission_id
        AND (
          m.creator_id = auth.uid()
          OR m.cleaner_id = auth.uid()
          OR public.is_platform_admin(auth.uid())
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 2) profiles — freeze economy / privilege columns; re-lock phone + email + GPS
-- ---------------------------------------------------------------------------
-- Drop duplicate permissive UPDATE policies if present (Dashboard-era drift).
DROP POLICY IF EXISTS "Allow users to update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile." ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Re-assert a single own-row UPDATE policy (column privileges enforce the lock).
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Economy / privilege columns: clients must not write these directly.
REVOKE UPDATE (
  token_balance,
  wallet_balance,
  frozen_balance,
  role,
  is_verified,
  verification_status,
  is_banned
) ON TABLE public.profiles FROM PUBLIC;

REVOKE UPDATE (
  token_balance,
  wallet_balance,
  frozen_balance,
  role,
  is_verified,
  verification_status,
  is_banned
) ON TABLE public.profiles FROM anon;

REVOKE UPDATE (
  token_balance,
  wallet_balance,
  frozen_balance,
  role,
  is_verified,
  verification_status,
  is_banned
) ON TABLE public.profiles FROM authenticated;

-- Hungry-Games phone lock (+ email / GPS scrape lock).
-- token_balance stays SELECT-able so the owner wallet UI keeps working;
-- UPDATE is blocked above so balances cannot be minted client-side.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'phone_number'
  ) THEN
    EXECUTE 'REVOKE SELECT (phone_number) ON TABLE public.profiles FROM PUBLIC';
    EXECUTE 'REVOKE SELECT (phone_number) ON TABLE public.profiles FROM anon';
    EXECUTE 'REVOKE SELECT (phone_number) ON TABLE public.profiles FROM authenticated';
    EXECUTE 'GRANT SELECT (phone_number) ON TABLE public.profiles TO service_role';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'contact_email'
  ) THEN
    EXECUTE 'REVOKE SELECT (contact_email) ON TABLE public.profiles FROM PUBLIC';
    EXECUTE 'REVOKE SELECT (contact_email) ON TABLE public.profiles FROM anon';
    EXECUTE 'REVOKE SELECT (contact_email) ON TABLE public.profiles FROM authenticated';
    EXECUTE 'GRANT SELECT (contact_email) ON TABLE public.profiles TO service_role';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'first_gps_track'
  ) THEN
    EXECUTE 'REVOKE SELECT (first_gps_track) ON TABLE public.profiles FROM PUBLIC';
    EXECUTE 'REVOKE SELECT (first_gps_track) ON TABLE public.profiles FROM anon';
    EXECUTE 'REVOKE SELECT (first_gps_track) ON TABLE public.profiles FROM authenticated';
    EXECUTE 'GRANT SELECT (first_gps_track) ON TABLE public.profiles TO service_role';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'wallet_balance'
  ) THEN
    EXECUTE 'REVOKE SELECT (wallet_balance) ON TABLE public.profiles FROM PUBLIC';
    EXECUTE 'REVOKE SELECT (wallet_balance) ON TABLE public.profiles FROM anon';
    EXECUTE 'REVOKE SELECT (wallet_balance) ON TABLE public.profiles FROM authenticated';
    EXECUTE 'GRANT SELECT (wallet_balance) ON TABLE public.profiles TO service_role';
  END IF;
END $$;

-- Own contact email (mirrors get_own_phone_number).
CREATE OR REPLACE FUNCTION public.get_own_contact_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT nullif(btrim(coalesce(p.contact_email, '')), '')
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_own_contact_email() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_own_contact_email() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Admin finance RPCs (replace direct AdminDashboard profile UPDATE/SELECT)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_profiles_finance(p_limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid,
  full_name text,
  telegram_username text,
  contact_email text,
  wallet_balance numeric,
  avatar_url text,
  is_verified boolean,
  is_banned boolean,
  first_gps_track jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.telegram_username,
    p.contact_email,
    p.wallet_balance,
    p.avatar_url,
    coalesce(p.is_verified, false),
    coalesce(p.is_banned, false),
    CASE
      WHEN p.first_gps_track IS NULL THEN NULL
      ELSE p.first_gps_track::jsonb
    END
  FROM public.profiles p
  ORDER BY coalesce(p.wallet_balance, 0) DESC
  LIMIT greatest(1, least(coalesce(p_limit, 50), 200));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_profiles_finance(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_profiles_finance(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_wallet_balance(p_user_id uuid, p_balance numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF p_user_id IS NULL OR p_balance IS NULL OR p_balance < 0 THEN
    RAISE EXCEPTION 'Invalid balance';
  END IF;

  UPDATE public.profiles
  SET wallet_balance = p_balance
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_profile_banned(p_user_id uuid, p_banned boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid user';
  END IF;

  UPDATE public.profiles
  SET is_banned = coalesce(p_banned, false)
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_profile_verified(p_user_id uuid, p_verified boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid user';
  END IF;

  UPDATE public.profiles
  SET is_verified = coalesce(p_verified, false)
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_wallet_balance(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_profile_banned(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_profile_verified(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_wallet_balance(uuid, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_banned(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_verified(uuid, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Money / token mint RPCs — service_role only
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'credit_tokens_service_role',
        'credit_tokens_from_payment_service_role',
        'apply_stripe_contribution',
        'contribute_to_mission'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- Drop dangerous legacy place_mission_bid overloads (keep jsonb package variant).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'place_mission_bid'
      AND pg_get_function_identity_arguments(p.oid) NOT IN ('uuid, integer, jsonb')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', r.sig);
  END LOOP;
END $$;

-- Canonical bid RPC: authenticated only (not anon).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'place_mission_bid'
      AND pg_get_function_identity_arguments(p.oid) = 'uuid, integer, jsonb'
  ) THEN
    REVOKE ALL ON FUNCTION public.place_mission_bid(uuid, integer, jsonb) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.place_mission_bid(uuid, integer, jsonb) FROM anon;
    GRANT EXECUTE ON FUNCTION public.place_mission_bid(uuid, integer, jsonb)
      TO authenticated, service_role;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'accept_mission_bid'
      AND pg_get_function_identity_arguments(p.oid) = 'uuid, text'
  ) THEN
    REVOKE ALL ON FUNCTION public.accept_mission_bid(uuid, text) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.accept_mission_bid(uuid, text) FROM anon;
    GRANT EXECUTE ON FUNCTION public.accept_mission_bid(uuid, text)
      TO authenticated, service_role;
  ELSIF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'accept_mission_bid'
      AND pg_get_function_identity_arguments(p.oid) = 'uuid'
  ) THEN
    REVOKE ALL ON FUNCTION public.accept_mission_bid(uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.accept_mission_bid(uuid) FROM anon;
    GRANT EXECUTE ON FUNCTION public.accept_mission_bid(uuid)
      TO authenticated, service_role;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5) notifications — kill open INSERT; inserts via SECURITY DEFINER only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS notifications_insert_system ON public.notifications;
DROP POLICY IF EXISTS notifications_insert_all ON public.notifications;

REVOKE INSERT, TRUNCATE, DELETE ON TABLE public.notifications FROM anon;
REVOKE INSERT, TRUNCATE ON TABLE public.notifications FROM authenticated;
-- authenticated may UPDATE/DELETE own rows via existing policies; keep SELECT/UPDATE/DELETE as needed
GRANT SELECT, UPDATE, DELETE ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;

-- ---------------------------------------------------------------------------
-- 6) contributions — narrow SELECT (own / mission creator / admin)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS contributions_select_authenticated ON public.contributions;
DROP POLICY IF EXISTS contributions_select_all ON public.contributions;

CREATE POLICY contributions_select_scoped
  ON public.contributions
  FOR SELECT
  TO authenticated
  USING (
    contributor_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.missions m
      WHERE m.id = mission_id
        AND (m.creator_id = auth.uid() OR public.is_platform_admin(auth.uid()))
    )
  );

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.contributions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.contributions FROM authenticated;
GRANT SELECT ON TABLE public.contributions TO authenticated;
GRANT ALL ON TABLE public.contributions TO service_role;

-- ---------------------------------------------------------------------------
-- 7) Revoke TRUNCATE (bypasses RLS) on sensitive tables for API roles
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles',
    'missions',
    'mission_bids',
    'mission_chats',
    'contributions',
    'reviews',
    'notifications',
    'user_push_tokens',
    'contractor_stores',
    'store_supplies',
    'location_catalog'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE TRUNCATE ON TABLE public.%I FROM PUBLIC', t);
      EXECUTE format('REVOKE TRUNCATE ON TABLE public.%I FROM anon', t);
      EXECUTE format('REVOKE TRUNCATE ON TABLE public.%I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 8) Post-flight assertions
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_rls boolean;
  v_can_update_tokens boolean;
  v_can_select_phone boolean;
BEGIN
  SELECT c.relrowsecurity INTO v_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'mission_bids';

  IF coalesce(v_rls, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Post-flight failed: mission_bids RLS is not enabled';
  END IF;

  SELECT has_column_privilege('authenticated', 'public.profiles', 'token_balance', 'UPDATE')
  INTO v_can_update_tokens;
  IF coalesce(v_can_update_tokens, true) THEN
    RAISE EXCEPTION 'Post-flight failed: authenticated can still UPDATE profiles.token_balance';
  END IF;

  SELECT has_column_privilege('authenticated', 'public.profiles', 'phone_number', 'SELECT')
  INTO v_can_select_phone;
  IF coalesce(v_can_select_phone, true) THEN
    RAISE EXCEPTION 'Post-flight failed: authenticated can still SELECT profiles.phone_number';
  END IF;
END $$;

COMMENT ON FUNCTION public.admin_list_profiles_finance(integer) IS
  'Admin-only profile finance list — replaces open SELECT of wallet/email/GPS.';
COMMENT ON FUNCTION public.admin_set_wallet_balance(uuid, numeric) IS
  'Admin-only wallet set — clients cannot UPDATE profiles.wallet_balance directly.';
