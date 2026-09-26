-- ============================================================================
-- Admin P0 hardening (2026-09-26 audit, verified against live DB before apply)
-- ----------------------------------------------------------------------------
-- P0-1 force_cancel_mission(uuid): had NO admin check and was executable by
--      PUBLIC, anon and authenticated (live proacl). Anyone with the anon key
--      could cancel any open mission. -> admin guard + ACL lock.
--      Refund logic (legacy frozen_balance -> wallet_balance) is kept as-is;
--      see note 04_Roadmap_Tasks/Admin_P0_Hardening.md.
-- P0-2 admin_financial_metrics(): no admin check, EXECUTE open to
--      PUBLIC/anon/authenticated (platform money totals readable by anyone). -> plpgsql wrapper with admin guard + ACL lock.
-- P0-3 missions.ai_verdict / ai_confidence_score: column UPDATE granted to
--      authenticated (Wave F) + missions_update_participants policy -> a
--      creator/worker could forge the AI verdict on their own mission.
--      -> revoke column UPDATE, BEFORE UPDATE trigger guard, and
--      admin_set_ai_verdict() RPC for the Admin console.
-- P0-4 admin_factory_reset(): wipes missions/bids/contributions/reviews/
--      transactions on prod behind a single window.confirm.
--      EXECUTE was also open to PUBLIC/anon (admin check inside still held).
--      -> server-side refusal unless private.app_config
--         allow_factory_reset = 'true' (absent by default = refuse).
--
-- Idempotent. No data is deleted or modified by this file.
-- Apply: supabase db query --linked -f supabase/migrations/20260926_admin_p0_hardening.sql
-- History: supabase migration repair --status applied 20260926
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- P0-1 force_cancel_mission — same signature/return type, admin guard added
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.force_cancel_mission(p_mission_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $fn$
declare
  v_creator_id uuid;
  v_status text;
  v_amount numeric;
  v_wallet numeric;
  v_frozen numeric;
begin
  -- Admin P0: platform admin (or service_role) only.
  if not (
    coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or public.is_platform_admin(auth.uid())
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Body below is unchanged from the live definition (2026-09-26).
  -- Lock mission row
  select creator_id,
         status,
         coalesce(current_funding, amount_target)::numeric
    into v_creator_id, v_status, v_amount
  from public.missions
  where id = p_mission_id
  for update;

  if v_creator_id is null then
    raise exception 'Mission not found';
  end if;

  if v_status in ('completed', 'cancelled') then
    raise exception 'Mission cannot be cancelled from status %', v_status;
  end if;

  if v_amount is null then
    v_amount := 0;
  end if;

  -- Lock creator profile row
  select coalesce(wallet_balance, 0),
         coalesce(frozen_balance, 0)
    into v_wallet, v_frozen
  from public.profiles
  where id = v_creator_id
  for update;

  -- Move funds: frozen -> wallet (legacy escrow model; see note)
  if v_amount > 0 then
    if v_frozen < v_amount then
      raise exception 'Insufficient frozen balance for refund';
    end if;

    update public.profiles
      set frozen_balance = coalesce(frozen_balance, 0) - v_amount,
          wallet_balance = coalesce(wallet_balance, 0) + v_amount
    where id = v_creator_id;

    insert into public.transactions (user_id, mission_id, amount, type, gateway, created_at)
    values (v_creator_id, p_mission_id, v_amount, 'refund', 'internal', now());
  end if;

  -- Update mission status
  update public.missions
    set status = 'cancelled'
  where id = p_mission_id;
end;
$fn$;

REVOKE ALL ON FUNCTION public.force_cancel_mission(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.force_cancel_mission(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.force_cancel_mission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.force_cancel_mission(uuid) TO service_role;

COMMENT ON FUNCTION public.force_cancel_mission(uuid) IS
  'Admin P0 (2026-09-26): platform-admin only. Cancels a mission; legacy frozen->wallet refund kept.';

-- ---------------------------------------------------------------------------
-- P0-2 admin_financial_metrics — same return columns, admin guard added
-- ---------------------------------------------------------------------------
-- NOTE: live still has the 2026-03 return shape (pending_payouts /
-- pending_withdrawals); 20260721_cleanup_legacy_finance_rpcs.sql was never
-- applied. Keep the LIVE shape (CREATE OR REPLACE cannot change it) and only
-- add the guard. Shape drift is tracked in the Admin_P0_Hardening note.
CREATE OR REPLACE FUNCTION public.admin_financial_metrics()
RETURNS TABLE (
  total_donated numeric,
  pending_payouts numeric,
  pending_withdrawals numeric,
  supervisor_bounties_total numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $fn$
BEGIN
  IF NOT (
    coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    OR public.is_platform_admin(auth.uid())
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    coalesce((
      SELECT sum(t.amount)
      FROM public.transactions t
      WHERE t.type IN ('donation', 'deposit', 'wallet_topup', 'mission_reward')
    ), 0)::numeric AS total_donated,
    coalesce((SELECT sum(coalesce(p.frozen_balance, 0)) FROM public.profiles p), 0)::numeric AS pending_payouts,
    coalesce((
      SELECT sum(t.amount)
      FROM public.transactions t
      WHERE t.type = 'withdrawal'
    ), 0)::numeric AS pending_withdrawals,
    coalesce((
      SELECT sum(t.amount)
      FROM public.transactions t
      WHERE t.type = 'supervisor_bounty'
    ), 0)::numeric AS supervisor_bounties_total;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_financial_metrics() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_financial_metrics() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_financial_metrics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_financial_metrics() TO service_role;

COMMENT ON FUNCTION public.admin_financial_metrics() IS
  'Admin P0 (2026-09-26): platform-admin only contribution-model metrics.';

-- ---------------------------------------------------------------------------
-- P0-3 ai_verdict / ai_confidence_score — admin/service only
-- ---------------------------------------------------------------------------
-- Wave F revoked table-level UPDATE, so column-level REVOKE is effective here.
REVOKE UPDATE (ai_verdict, ai_confidence_score) ON TABLE public.missions FROM PUBLIC;
REVOKE UPDATE (ai_verdict, ai_confidence_score) ON TABLE public.missions FROM anon;
REVOKE UPDATE (ai_verdict, ai_confidence_score) ON TABLE public.missions FROM authenticated;

-- Defense in depth: even if a future grant re-opens the columns, only
-- service_role / owner (SECURITY DEFINER RPC) contexts can change ai_*.
CREATE OR REPLACE FUNCTION public.protect_mission_ai_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     OR current_user IN ('postgres', 'supabase_admin')
     OR pg_catalog.pg_has_role(current_user, 'postgres', 'member')
  THEN
    RETURN NEW;
  END IF;

  IF NEW.ai_verdict IS DISTINCT FROM OLD.ai_verdict
     OR NEW.ai_confidence_score IS DISTINCT FROM OLD.ai_confidence_score
  THEN
    RAISE EXCEPTION 'ai_verdict / ai_confidence_score are admin-only. Use admin_set_ai_verdict().'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_protect_mission_ai_columns ON public.missions;
CREATE TRIGGER trg_protect_mission_ai_columns
  BEFORE UPDATE ON public.missions
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_mission_ai_columns();

COMMENT ON FUNCTION public.protect_mission_ai_columns() IS
  'Admin P0 (2026-09-26): blocks client writes to missions.ai_verdict / ai_confidence_score.';

CREATE OR REPLACE FUNCTION public.admin_set_ai_verdict(
  p_mission_id uuid,
  p_verdict text,
  p_confidence numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT (
    coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    OR public.is_platform_admin(auth.uid())
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_mission_id IS NULL THEN
    RAISE EXCEPTION 'Mission id required';
  END IF;

  UPDATE public.missions
     SET ai_verdict = nullif(btrim(p_verdict), ''),
         ai_confidence_score = CASE WHEN p_confidence IS NULL THEN NULL ELSE round(p_confidence)::integer END
   WHERE id = p_mission_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_set_ai_verdict(uuid, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_ai_verdict(uuid, text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_ai_verdict(uuid, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_ai_verdict(uuid, text, numeric) TO service_role;

COMMENT ON FUNCTION public.admin_set_ai_verdict(uuid, text, numeric) IS
  'Admin P0 (2026-09-26): platform-admin only write of missions.ai_verdict / ai_confidence_score.';

-- ---------------------------------------------------------------------------
-- P0-4 admin_factory_reset — refuse unless private.app_config flag is on
-- ---------------------------------------------------------------------------
-- private.app_config already exists (20260722/20260723: city-notification +
-- push webhook config; value NOT NULL). Same shape/grants as those files.
-- This file does NOT insert allow_factory_reset -> absent = refuse.
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.app_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON TABLE private.app_config FROM PUBLIC;
REVOKE ALL ON TABLE private.app_config FROM anon;
REVOKE ALL ON TABLE private.app_config FROM authenticated;
GRANT USAGE ON SCHEMA private TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.app_config TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.admin_factory_reset()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_platform_admin(v_uid) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  -- Admin P0: refuse unless this environment explicitly opted in.
  IF coalesce((SELECT c.value FROM private.app_config c WHERE c.key = 'allow_factory_reset'), '') <> 'true' THEN
    RAISE EXCEPTION 'factory reset is disabled on this environment (private.app_config allow_factory_reset is not ''true'')'
      USING ERRCODE = '42501';
  END IF;

  -- Body below is unchanged from the live definition (2026-09-26).
  -- 1. Dependent tables first
  IF to_regclass('public.mission_chats') IS NOT NULL THEN DELETE FROM public.mission_chats; END IF;
  IF to_regclass('public.mission_bids') IS NOT NULL THEN DELETE FROM public.mission_bids; END IF;
  IF to_regclass('public.contributions') IS NOT NULL THEN DELETE FROM public.contributions; END IF;
  IF to_regclass('public.notifications') IS NOT NULL THEN DELETE FROM public.notifications; END IF;
  IF to_regclass('public.reviews') IS NOT NULL THEN DELETE FROM public.reviews; END IF;
  IF to_regclass('public.city_notification_events') IS NOT NULL THEN DELETE FROM public.city_notification_events; END IF;
  IF to_regclass('public.transactions') IS NOT NULL THEN DELETE FROM public.transactions; END IF;

  -- 2. Missions last
  IF to_regclass('public.missions') IS NOT NULL THEN DELETE FROM public.missions; END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_factory_reset() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_factory_reset() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_factory_reset() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_factory_reset() TO service_role;

COMMENT ON FUNCTION public.admin_factory_reset() IS
  'Platform-admin only AND private.app_config allow_factory_reset=''true''. Deletes all missions/bids/transactions/etc. Keeps profiles. Refuses on prod by default.';

-- ---------------------------------------------------------------------------
-- Post-flight assertions — fail loudly (whole file rolls back)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fn text;
  v_oid oid;
  v_def text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.force_cancel_mission(uuid)',
    'public.admin_financial_metrics()',
    'public.admin_factory_reset()',
    'public.admin_set_ai_verdict(uuid,text,numeric)'
  ]
  LOOP
    v_oid := to_regprocedure(v_fn);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Post-flight failed: % missing', v_fn;
    END IF;

    v_def := pg_get_functiondef(v_oid);
    IF position('is_platform_admin' IN v_def) = 0 THEN
      RAISE EXCEPTION 'Post-flight failed: % has no is_platform_admin guard', v_fn;
    END IF;

    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
      RAISE EXCEPTION 'Post-flight failed: % is not SECURITY DEFINER', v_fn;
    END IF;

    IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Post-flight failed: anon can EXECUTE %', v_fn;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'Post-flight failed: PUBLIC can EXECUTE %', v_fn;
    END IF;

    IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Post-flight failed: authenticated lost EXECUTE on % (admin UI needs it)', v_fn;
    END IF;
  END LOOP;

  IF position('allow_factory_reset' IN pg_get_functiondef('public.admin_factory_reset()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'Post-flight failed: admin_factory_reset has no allow_factory_reset gate';
  END IF;

  IF has_column_privilege('authenticated', 'public.missions', 'ai_verdict', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.missions', 'ai_confidence_score', 'UPDATE')
     OR has_column_privilege('anon', 'public.missions', 'ai_verdict', 'UPDATE')
     OR has_column_privilege('anon', 'public.missions', 'ai_confidence_score', 'UPDATE')
  THEN
    RAISE EXCEPTION 'Post-flight failed: client roles can still UPDATE missions.ai_*';
  END IF;

  -- Participant flows must keep working (Wave F safe columns).
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'missions' AND column_name = 'photo_urls')
     AND NOT has_column_privilege('authenticated', 'public.missions', 'photo_urls', 'UPDATE') THEN
    RAISE EXCEPTION 'Post-flight failed: authenticated lost UPDATE on missions.photo_urls';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'missions' AND column_name = 'description')
     AND NOT has_column_privilege('authenticated', 'public.missions', 'description', 'UPDATE') THEN
    RAISE EXCEPTION 'Post-flight failed: authenticated lost UPDATE on missions.description';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgrelid = 'public.missions'::regclass
                   AND tgname = 'trg_protect_mission_ai_columns' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Post-flight failed: trg_protect_mission_ai_columns missing';
  END IF;

  IF has_table_privilege('authenticated', 'private.app_config', 'SELECT')
     OR has_table_privilege('anon', 'private.app_config', 'SELECT')
     OR has_table_privilege('authenticated', 'private.app_config', 'INSERT')
     OR has_table_privilege('anon', 'private.app_config', 'INSERT') THEN
    RAISE EXCEPTION 'Post-flight failed: private.app_config reachable by client roles';
  END IF;
END $$;

COMMIT;
