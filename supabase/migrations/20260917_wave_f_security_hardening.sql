-- ============================================================================
-- Wave F — Security Hardening (SEC-1 & SEC-2) [v3 - Allowlist Table, Zero Enum Conflict]
-- ----------------------------------------------------------------------------
-- SEC-1: Admin escalation via editable telegram_username.
--   - Removes all checks for lower(telegram_username) = 'sergiogurgini'.
--   - Introduces private platform_admins allowlist table.
--   - Founder account (sgurzheyev@gmail.com / tg_6618910143) is registered.
--   - Zero mutations to profiles.role enum, eliminating enum mismatch errors.
--
-- SEC-2: Mission lifecycle & economy forgery via direct PostgREST UPDATE.
--   - Revoke broad table UPDATE on public.missions from authenticated/anon/PUBLIC.
--   - Grant UPDATE only on safe UI columns (description, photo_urls, started_at,
--     video_proof_url, proof_video_url, ai_confidence_score, ai_verdict).
--   - BEFORE UPDATE trigger trg_protect_mission_lifecycle_columns blocks direct
--     client mutations of status, cleaner_id, creator_id, current_funding,
--     expected_price, amount_target, crowdfunding_mode, crowdfunding_expires_at, etc.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) SEC-1: Platform admins allowlist table + rewrite is_platform_admin()
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.platform_admins FROM PUBLIC;
REVOKE ALL ON TABLE public.platform_admins FROM anon;
REVOKE ALL ON TABLE public.platform_admins FROM authenticated;
GRANT ALL ON TABLE public.platform_admins TO service_role;

-- Automatically register founder account from auth.users
INSERT INTO public.platform_admins (user_id)
SELECT id FROM auth.users
WHERE email = 'sgurzheyev@gmail.com'
   OR email ILIKE '%tg_6618910143%'
ON CONFLICT (user_id) DO NOTHING;

-- Rewrite is_platform_admin:
-- 1. service_role JWT
-- 2. platform_admins table
-- 3. auth.users founder email
-- 4. profiles.role::text = 'admin' (safe text cast)
-- NO telegram_username check!
CREATE OR REPLACE FUNCTION public.is_platform_admin(p_uid uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF p_uid IS NULL THEN
    RETURN false;
  END IF;

  -- 1. service_role JWT is always admin
  IF coalesce((auth.jwt() ->> 'role'), '') = 'service_role' THEN
    RETURN true;
  END IF;

  -- 2. Check platform_admins allowlist table
  IF EXISTS (
    SELECT 1
    FROM public.platform_admins a
    WHERE a.user_id = p_uid
  ) THEN
    RETURN true;
  END IF;

  -- 3. Check verified founder identity in auth.users
  IF EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE u.id = p_uid
      AND (
        u.email = 'sgurzheyev@gmail.com'
        OR u.email ILIKE '%tg_6618910143%'
      )
  ) THEN
    RETURN true;
  END IF;

  -- 4. Check role::text = 'admin' if populated
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_uid
      AND lower(coalesce(p.role::text, '')) = 'admin'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.is_platform_admin(uuid) IS
  'Wave F (SEC-1): Verified via platform_admins table, auth.users email, or role=admin. telegram_username check is removed.';

-- ---------------------------------------------------------------------------
-- 2) SEC-2: Missions column-level lock & BEFORE UPDATE freeze trigger
-- ---------------------------------------------------------------------------

-- Revoke full-row UPDATE from API clients
REVOKE UPDATE ON TABLE public.missions FROM PUBLIC;
REVOKE UPDATE ON TABLE public.missions FROM anon;
REVOKE UPDATE ON TABLE public.missions FROM authenticated;

-- Grant UPDATE ONLY on safe columns required for UI/operational flows:
-- - before-photos upload: photo_urls, started_at
-- - creator edits: description, video_proof_url, proof_video_url
-- - admin ai verdict: ai_confidence_score, ai_verdict
DO $$
DECLARE
  v_safe text[] := ARRAY[
    'description',
    'photo_urls',
    'started_at',
    'video_proof_url',
    'proof_video_url',
    'ai_confidence_score',
    'ai_verdict',
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
        AND table_name = 'missions'
        AND column_name = v_col
    ) THEN
      v_grant_cols := array_append(v_grant_cols, format('%I', v_col));
    END IF;
  END LOOP;

  IF coalesce(array_length(v_grant_cols, 1), 0) > 0 THEN
    EXECUTE format(
      'GRANT UPDATE (%s) ON TABLE public.missions TO authenticated',
      array_to_string(v_grant_cols, ', ')
    );
  END IF;
END $$;

-- Defense-in-depth trigger: blocks mutation of critical lifecycle/economy fields
-- unless the caller is service_role or a SECURITY DEFINER RPC (running as postgres/supabase_admin).
CREATE OR REPLACE FUNCTION public.protect_mission_lifecycle_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  n jsonb := to_jsonb(NEW);
  o jsonb := to_jsonb(OLD);
BEGIN
  -- Allow service_role and table-owner / superuser contexts (SECURITY DEFINER RPCs)
  IF coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     OR current_user IN ('postgres', 'supabase_admin')
     OR pg_catalog.pg_has_role(current_user, 'postgres', 'member')
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (n->>'status') IS DISTINCT FROM (o->>'status')
       OR (n->>'cleaner_id') IS DISTINCT FROM (o->>'cleaner_id')
       OR (n->>'creator_id') IS DISTINCT FROM (o->>'creator_id')
       OR (n->>'current_funding') IS DISTINCT FROM (o->>'current_funding')
       OR (n->>'expected_price') IS DISTINCT FROM (o->>'expected_price')
       OR (n->>'amount_target') IS DISTINCT FROM (o->>'amount_target')
       OR (n->>'target_funding') IS DISTINCT FROM (o->>'target_funding')
       OR (n->>'crowdfunding_mode') IS DISTINCT FROM (o->>'crowdfunding_mode')
       OR (n->>'crowdfunding_expires_at') IS DISTINCT FROM (o->>'crowdfunding_expires_at')
       OR (n->>'accepted_bid_id') IS DISTINCT FROM (o->>'accepted_bid_id')
       OR (n->>'is_report') IS DISTINCT FROM (o->>'is_report')
    THEN
      RAISE EXCEPTION
        'Direct modification of protected mission lifecycle and economy fields is forbidden. Use designated RPCs.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_mission_lifecycle_columns ON public.missions;
CREATE TRIGGER trg_protect_mission_lifecycle_columns
  BEFORE UPDATE ON public.missions
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_mission_lifecycle_columns();

COMMENT ON FUNCTION public.protect_mission_lifecycle_columns() IS
  'Wave F (SEC-2): Blocks direct client updates of status/cleaner/funds/target/pricing on missions. DEFINER RPCs bypass.';

COMMIT;
