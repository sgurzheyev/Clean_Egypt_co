-- ============================================================================
-- CRITICAL security hardening (2026-07-27 production audit)
-- ----------------------------------------------------------------------------
-- Findings addressed (live DB + codebase):
--   1. mission_bids: RLS was OFF with anon TRUNCATE/DELETE/UPDATE grants
--   2. profiles: users could UPDATE own token_balance / wallet / role / is_banned
--      (economy mint + self-promotion to is_platform_admin via role='admin')
--      NOTE: table-level UPDATE voids column-level REVOKE — we REVOKE UPDATE on the
--      table, then GRANT UPDATE only on safe UI columns + BEFORE UPDATE trigger.
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

-- CRITICAL: table-level UPDATE on profiles makes column-level REVOKE ineffective.
-- Revoke all UPDATE, then re-grant ONLY safe UI-editable columns.
REVOKE UPDATE ON TABLE public.profiles FROM PUBLIC;
REVOKE UPDATE ON TABLE public.profiles FROM anon;
REVOKE UPDATE ON TABLE public.profiles FROM authenticated;

DO $$
DECLARE
  v_safe text[] := ARRAY[
    'full_name',
    'avatar_url',
    'telegram_username',
    'contact_email',
    'phone_number',
    'contact_phone',
    'username',
    'bio',
    'country',
    'city',
    'notification_preferences',
    'preferred_language',
    'language',
    'display_name',
    'updated_at'
  ];
  v_col text;
  v_grant_cols text[] := ARRAY[]::text[];
BEGIN
  FOREACH v_col IN ARRAY v_safe
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'profiles'
        AND column_name = v_col
    ) THEN
      v_grant_cols := array_append(v_grant_cols, format('%I', v_col));
    END IF;
  END LOOP;

  IF coalesce(array_length(v_grant_cols, 1), 0) > 0 THEN
    EXECUTE format(
      'GRANT UPDATE (%s) ON TABLE public.profiles TO authenticated',
      array_to_string(v_grant_cols, ', ')
    );
  END IF;
END $$;

-- Defense-in-depth: even if grants drift, authenticated sessions cannot mutate economy/privilege fields.
-- SECURITY DEFINER RPCs run as the function owner (postgres / supabase_admin) and are allowed through.
CREATE OR REPLACE FUNCTION public.protect_profile_economy_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  n jsonb := to_jsonb(NEW);
  o jsonb := to_jsonb(OLD);
BEGIN
  -- Allow service_role JWT and table-owner / superuser contexts (DEFINER RPCs).
  IF coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     OR current_user IN ('postgres', 'supabase_admin')
     OR pg_catalog.pg_has_role(current_user, 'postgres', 'member')
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (n->>'token_balance') IS DISTINCT FROM (o->>'token_balance')
       OR (n->>'wallet_balance') IS DISTINCT FROM (o->>'wallet_balance')
       OR (n->>'frozen_balance') IS DISTINCT FROM (o->>'frozen_balance')
       OR (n->>'role') IS DISTINCT FROM (o->>'role')
       OR (n->>'is_banned') IS DISTINCT FROM (o->>'is_banned')
       OR (n->>'is_verified') IS DISTINCT FROM (o->>'is_verified')
       OR (n->>'verification_status') IS DISTINCT FROM (o->>'verification_status')
       OR (n->>'subscription_expires_at') IS DISTINCT FROM (o->>'subscription_expires_at')
       OR (n->>'rating') IS DISTINCT FROM (o->>'rating')
       OR (n->>'review_count') IS DISTINCT FROM (o->>'review_count')
    THEN
      RAISE EXCEPTION
        'Direct modification of protected profile fields is forbidden. Use secure RPCs.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_economy_columns ON public.profiles;
CREATE TRIGGER trg_protect_profile_economy_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_economy_columns();

COMMENT ON FUNCTION public.protect_profile_economy_columns() IS
  'Blocks authenticated clients from changing token/wallet/role/ban/verify fields; DEFINER RPCs still allowed.';

-- CRITICAL: table-level SELECT voids column-level REVOKE (same footgun as UPDATE).
-- Revoke all SELECT, then re-grant ONLY safe public-facing columns.
REVOKE SELECT ON TABLE public.profiles FROM PUBLIC;
REVOKE SELECT ON TABLE public.profiles FROM anon;
REVOKE SELECT ON TABLE public.profiles FROM authenticated;

DO $$
DECLARE
  v_safe text[] := ARRAY[
    'id',
    'full_name',
    'avatar_url',
    'bio',
    'username',
    'display_name',
    'role',
    'is_verified',
    'verification_status',
    'country',
    'city',
    'rating',
    'review_count',
    'is_supervisor',
    'created_at',
    'updated_at',
    'member_since'
  ];
  v_col text;
  v_grant_cols text[] := ARRAY[]::text[];
BEGIN
  FOREACH v_col IN ARRAY v_safe
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'profiles'
        AND column_name = v_col
    ) THEN
      v_grant_cols := array_append(v_grant_cols, format('%I', v_col));
    END IF;
  END LOOP;

  IF coalesce(array_length(v_grant_cols, 1), 0) > 0 THEN
    EXECUTE format(
      'GRANT SELECT (%s) ON TABLE public.profiles TO anon, authenticated',
      array_to_string(v_grant_cols, ', ')
    );
  END IF;

  -- service_role retains full read for Edge Functions / admin tooling.
  GRANT SELECT ON TABLE public.profiles TO service_role;
END $$;

-- ---------------------------------------------------------------------------
-- Own private profile fields + Hungry-Games phone RPCs (SECURITY DEFINER)
-- ---------------------------------------------------------------------------
-- These bypass column locks and return PII only for auth.uid() or accepted contracts.

CREATE OR REPLACE FUNCTION public.get_own_phone_number()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT nullif(btrim(coalesce(p.phone_number, '')), '')
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$;

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

CREATE OR REPLACE FUNCTION public.get_own_private_profile()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_strip_nulls(
    jsonb_build_object(
      'token_balance', p.token_balance,
      'telegram_username', p.telegram_username,
      'contact_email', nullif(btrim(coalesce(p.contact_email, '')), ''),
      'phone_number', nullif(btrim(coalesce(p.phone_number, '')), ''),
      'subscription_expires_at', p.subscription_expires_at,
      'wallet_balance', p.wallet_balance
    )
  )
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$;

COMMENT ON FUNCTION public.get_own_phone_number() IS
  'SECURITY DEFINER — returns auth.uid() phone after column SELECT lock.';
COMMENT ON FUNCTION public.get_own_contact_email() IS
  'SECURITY DEFINER — returns auth.uid() contact_email after column SELECT lock.';
COMMENT ON FUNCTION public.get_own_private_profile() IS
  'SECURITY DEFINER — own token/telegram/email/phone/subscription; never other users.';

REVOKE ALL ON FUNCTION public.get_own_phone_number() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_own_contact_email() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_own_private_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_own_phone_number() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_own_contact_email() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_own_private_profile() TO authenticated, service_role;

-- Re-assert Hungry-Games / contact RPCs are SECURITY DEFINER + locked search_path.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, p.proname AS func_name, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'get_mission_client_phone',
        'get_mission_worker_phone',
        'get_client_phone_if_contracted',
        'admin_get_profile_phones',
        'get_own_phone_number',
        'get_own_contact_email',
        'get_own_private_profile'
      ])
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SECURITY DEFINER SET search_path = public',
      r.schema_name,
      r.func_name,
      r.args
    );
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC',
      r.schema_name,
      r.func_name,
      r.args
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated, service_role',
      r.schema_name,
      r.func_name,
      r.args
    );
  END LOOP;
END $$;

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

  -- Sanity: safe UI column must remain updatable for own-profile edits.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'full_name'
  ) AND NOT has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') THEN
    RAISE EXCEPTION 'Post-flight failed: authenticated lost UPDATE on profiles.full_name';
  END IF;

  SELECT has_column_privilege('authenticated', 'public.profiles', 'phone_number', 'SELECT')
  INTO v_can_select_phone;
  IF coalesce(v_can_select_phone, true) THEN
    RAISE EXCEPTION 'Post-flight failed: authenticated can still SELECT profiles.phone_number';
  END IF;

  IF NOT has_column_privilege('authenticated', 'public.profiles', 'full_name', 'SELECT') THEN
    RAISE EXCEPTION 'Post-flight failed: authenticated lost SELECT on profiles.full_name';
  END IF;

  IF NOT has_column_privilege('authenticated', 'public.profiles', 'avatar_url', 'SELECT') THEN
    RAISE EXCEPTION 'Post-flight failed: authenticated lost SELECT on profiles.avatar_url';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'token_balance'
  ) AND has_column_privilege('authenticated', 'public.profiles', 'token_balance', 'SELECT') THEN
    RAISE EXCEPTION 'Post-flight failed: authenticated can still SELECT profiles.token_balance';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'telegram_username'
  ) AND has_column_privilege('authenticated', 'public.profiles', 'telegram_username', 'SELECT') THEN
    RAISE EXCEPTION 'Post-flight failed: authenticated can still SELECT profiles.telegram_username';
  END IF;

  -- Contact RPCs must remain SECURITY DEFINER so they can read locked columns.
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_own_private_profile' AND NOT p.prosecdef
  ) THEN
    RAISE EXCEPTION 'Post-flight failed: get_own_private_profile is not SECURITY DEFINER';
  END IF;
END $$;

COMMENT ON FUNCTION public.admin_list_profiles_finance(integer) IS
  'Admin-only profile finance list — replaces open SELECT of wallet/email/GPS.';
COMMENT ON FUNCTION public.admin_set_wallet_balance(uuid, numeric) IS
  'Admin-only wallet set — clients cannot UPDATE profiles.wallet_balance directly.';
