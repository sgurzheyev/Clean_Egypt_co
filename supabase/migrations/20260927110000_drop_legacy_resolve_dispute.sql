-- 20260927110000_drop_legacy_resolve_dispute.sql
--
-- Close the security hole left by the legacy 3-arg overload:
--   public.resolve_mission_dispute(p_mission_id uuid, p_verdict boolean, p_supervisor_comment text)
--
-- That overload was SECURITY DEFINER, had no auth or admin check, and was
-- executable by PUBLIC / anon / authenticated. It credited profiles.balance_egp,
-- debited profiles.frozen_balance, inserted city_eco_fund_logs and flipped mission
-- status, so anyone with the anon key could move money.
--
-- Nothing uses it (checked 2026-09-27):
--   * app code: the only caller (src/components/AdminDashboard.tsx) passes the
--     5-arg named params (p_decision, p_supervisor_verified, p_supervisor_user_id),
--     so PostgREST resolves it to the new overload. No caller passes p_verdict to
--     this RPC (the p_verdict hit is admin_set_ai_verdict).
--   * api/ and supabase/functions/: no references.
--   * DB: no other function body, trigger, view, cron job or pg_depend row refers to it.
--
-- The 5-arg admin-checked, audited overload
--   public.resolve_mission_dispute(uuid, text, text, boolean, uuid)
-- is NOT touched.
--
-- Idempotent: DROP ... IF EXISTS, then a post-check that raises if the state is wrong.

BEGIN;

DROP FUNCTION IF EXISTS public.resolve_mission_dispute(uuid, boolean, text);

DO $check$
DECLARE
  v_new oid := to_regprocedure('public.resolve_mission_dispute(uuid,text,text,boolean,uuid)');
  v_bad text;
BEGIN
  IF to_regprocedure('public.resolve_mission_dispute(uuid,boolean,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: legacy resolve_mission_dispute(uuid,boolean,text) still exists';
  END IF;

  IF v_new IS NULL THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: 5-arg resolve_mission_dispute(uuid,text,text,boolean,uuid) is missing';
  END IF;

  IF has_function_privilege('anon', v_new, 'EXECUTE') THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: anon can EXECUTE the 5-arg resolve_mission_dispute';
  END IF;

  -- No overload other than the 5-arg one may remain.
  SELECT string_agg(p.oid::regprocedure::text, ', ')
    INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'resolve_mission_dispute'
    AND p.oid <> v_new;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: unexpected resolve_mission_dispute overload(s) remain: %', v_bad;
  END IF;

  RAISE NOTICE 'OK: legacy resolve_mission_dispute(uuid,boolean,text) dropped; 5-arg overload present, anon denied';
END
$check$;

NOTIFY pgrst, 'reload schema';

COMMIT;
