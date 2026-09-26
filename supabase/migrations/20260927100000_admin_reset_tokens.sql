-- ============================================================================
-- Admin: reset every profile's token balance (field-test helper)
-- ----------------------------------------------------------------------------
-- Apply AFTER 20260927_admin_p1_upgrade.sql (needs private.write_admin_audit).
-- Apply with `supabase db query --linked -f`, then
-- `supabase migration repair --linked --status applied 20260927100000`.
-- Do NOT `supabase db push`.
--
-- public.admin_reset_all_tokens(p_tokens integer DEFAULT 100) RETURNS integer
--   * platform admin or service_role only, else 'forbidden' (42501)
--   * sets profiles.token_balance = p_tokens for every profile
--   * tokens only: wallet_balance / frozen_balance / money columns untouched
--   * writes ONE admin_audit_log row (profile count, old total/min/max, new value)
--   * returns the number of profiles whose balance changed
-- Idempotent. One transaction.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_reset_all_tokens(p_tokens integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $fn$
DECLARE
  v_tokens integer := p_tokens;
  v_profiles integer := 0;
  v_old_total bigint := 0;
  v_old_min integer;
  v_old_max integer;
  v_changed integer := 0;
BEGIN
  IF NOT (
    coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    OR public.is_platform_admin(auth.uid())
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_tokens IS NULL OR v_tokens < 0 OR v_tokens > 1000000 THEN
    RAISE EXCEPTION 'Invalid token amount (0..1000000)';
  END IF;

  -- Lock every profile row so the before-snapshot matches what we overwrite.
  PERFORM 1 FROM public.profiles FOR UPDATE;

  SELECT count(*)::integer,
         coalesce(sum(coalesce(token_balance, 0)), 0)::bigint,
         min(coalesce(token_balance, 0)),
         max(coalesce(token_balance, 0))
    INTO v_profiles, v_old_total, v_old_min, v_old_max
  FROM public.profiles;

  UPDATE public.profiles
     SET token_balance = v_tokens
   WHERE token_balance IS DISTINCT FROM v_tokens;
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  PERFORM private.write_admin_audit(
    'admin_reset_all_tokens',
    'platform',
    NULL,
    jsonb_build_object(
      'profiles', v_profiles,
      'token_total', v_old_total,
      'token_min', v_old_min,
      'token_max', v_old_max
    ),
    jsonb_build_object(
      'token_balance', v_tokens,
      'token_total', v_tokens::bigint * v_profiles,
      'changed_profiles', v_changed
    )
  );

  RETURN v_changed;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_reset_all_tokens(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reset_all_tokens(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_all_tokens(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_all_tokens(integer) TO service_role;

COMMENT ON FUNCTION public.admin_reset_all_tokens(integer) IS
  'Admin: set token_balance = p_tokens (default 100) on every profile. Tokens only. Platform-admin/service_role. Audited.';

-- Post-flight
DO $$
DECLARE
  v_oid oid := to_regprocedure('public.admin_reset_all_tokens(integer)');
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Post-flight failed: admin_reset_all_tokens missing';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'Post-flight failed: admin_reset_all_tokens is not SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: anon can EXECUTE admin_reset_all_tokens';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Post-flight failed: PUBLIC can EXECUTE admin_reset_all_tokens';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: authenticated cannot EXECUTE admin_reset_all_tokens';
  END IF;
  IF position('write_admin_audit' IN pg_get_functiondef(v_oid)) = 0
     OR position('is_platform_admin' IN pg_get_functiondef(v_oid)) = 0 THEN
    RAISE EXCEPTION 'Post-flight failed: admin_reset_all_tokens lost its guard or audit call';
  END IF;
END $$;

COMMIT;
