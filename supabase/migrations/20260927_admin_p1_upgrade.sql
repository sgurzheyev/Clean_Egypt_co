-- ============================================================================
-- Admin P1 upgrade (audit log, soft-hide, server search)
-- ----------------------------------------------------------------------------
-- Apply AFTER supabase/migrations/20260926_admin_p0_hardening.sql.
-- Version is 20260927 on purpose: 20260926 is already the repaired history
-- row for the P0 file. Do NOT `supabase db push`.
--
-- 1. public.admin_audit_log — platform admins can SELECT; clients cannot write.
--    Inserts go through private.write_admin_audit (not exposed to the API).
-- 2. missions.hidden_at / hidden_by — soft-hide. Public SELECT excludes them.
--    admin_delete_mission stays a hard delete (audited) but the panel does not
--    call it. force_cancel_mission refund body is unchanged.
-- 3. admin_financial_metrics is NOT replaced (live still returns
--    pending_payouts / pending_withdrawals). Pulse counts are a new RPC.
--
-- Idempotent. One transaction. No row data is deleted.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Soft-hide columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_by uuid;

COMMENT ON COLUMN public.missions.hidden_at IS
  'Admin P1: non-null means soft-hidden. Public SELECT excludes the row. Null = visible.';
COMMENT ON COLUMN public.missions.hidden_by IS
  'Admin P1: auth.uid() of the platform admin who last hid the mission.';

CREATE INDEX IF NOT EXISTS missions_hidden_at_not_null_idx
  ON public.missions (hidden_at DESC)
  WHERE hidden_at IS NOT NULL;

-- Clients must not flip the flag. Table-level UPDATE is already revoked (Wave F);
-- column REVOKE is defense in depth for a future broad grant.
REVOKE UPDATE (hidden_at, hidden_by) ON TABLE public.missions FROM PUBLIC;
REVOKE UPDATE (hidden_at, hidden_by) ON TABLE public.missions FROM anon;
REVOKE UPDATE (hidden_at, hidden_by) ON TABLE public.missions FROM authenticated;

-- ---------------------------------------------------------------------------
-- Audit log (readable by platform admins only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_audit_log IS
  'Admin P1: append-only log of admin RPCs. before_state / after_state are the before/after JSON. SELECT is platform-admin only.';

CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx
  ON public.admin_audit_log (created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_audit_log FROM PUBLIC;
REVOKE ALL ON TABLE public.admin_audit_log FROM anon;
REVOKE ALL ON TABLE public.admin_audit_log FROM authenticated;
GRANT SELECT ON TABLE public.admin_audit_log TO authenticated;
GRANT ALL ON TABLE public.admin_audit_log TO service_role;

DROP POLICY IF EXISTS admin_audit_log_select_platform_admin ON public.admin_audit_log;
CREATE POLICY admin_audit_log_select_platform_admin
  ON public.admin_audit_log
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- Writer lives in private so the Data API cannot forge rows.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO postgres, service_role;

CREATE OR REPLACE FUNCTION private.write_admin_audit(
  p_action text,
  p_target_type text,
  p_target_id text,
  p_before jsonb,
  p_after jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, before_state, after_state)
  VALUES (
    auth.uid(),
    left(coalesce(p_action, 'unknown'), 80),
    left(coalesce(p_target_type, 'unknown'), 40),
    nullif(left(coalesce(p_target_id, ''), 80), ''),
    p_before,
    p_after
  );
END;
$fn$;

REVOKE ALL ON FUNCTION private.write_admin_audit(text, text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.write_admin_audit(text, text, text, jsonb, jsonb) FROM anon;
REVOKE ALL ON FUNCTION private.write_admin_audit(text, text, text, jsonb, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION private.write_admin_audit(text, text, text, jsonb, jsonb) TO postgres, service_role;

COMMENT ON FUNCTION private.write_admin_audit(text, text, text, jsonb, jsonb) IS
  'Admin P1: only SECURITY DEFINER admin RPCs (running as owner) may insert audit rows.';

-- ---------------------------------------------------------------------------
-- Lifecycle trigger: also freeze hidden_at / hidden_by (Wave F body + these)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_mission_lifecycle_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  n jsonb := to_jsonb(NEW);
  o jsonb := to_jsonb(OLD);
BEGIN
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
       OR (n->>'hidden_at') IS DISTINCT FROM (o->>'hidden_at')
       OR (n->>'hidden_by') IS DISTINCT FROM (o->>'hidden_by')
    THEN
      RAISE EXCEPTION
        'Direct modification of protected mission lifecycle and economy fields is forbidden. Use designated RPCs.';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_protect_mission_lifecycle_columns ON public.missions;
CREATE TRIGGER trg_protect_mission_lifecycle_columns
  BEFORE UPDATE ON public.missions
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_mission_lifecycle_columns();

COMMENT ON FUNCTION public.protect_mission_lifecycle_columns() IS
  'Wave F (SEC-2) + Admin P1: blocks direct client updates of status/cleaner/funds and hidden_at/hidden_by. DEFINER RPCs bypass.';

-- ---------------------------------------------------------------------------
-- Public reads skip hidden missions. Platform admins still see them.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow users to read all missions" ON public.missions;
DROP POLICY IF EXISTS missions_select_all ON public.missions;
CREATE POLICY missions_select_all
  ON public.missions
  FOR SELECT
  TO anon, authenticated
  USING (
    hidden_at IS NULL
    OR public.is_platform_admin(auth.uid())
  );

COMMENT ON POLICY missions_select_all ON public.missions IS
  'Admin P1: hidden missions are visible only to platform admins. Map, feed, and profile queries use this policy.';

-- ---------------------------------------------------------------------------
-- Soft-hide / unhide
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_mission_hidden(
  p_mission_id uuid,
  p_hidden boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_status text;
  v_hidden timestamptz;
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

  SELECT m.status::text, m.hidden_at
    INTO v_status, v_hidden
  FROM public.missions m
  WHERE m.id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  UPDATE public.missions
     SET hidden_at = CASE WHEN coalesce(p_hidden, false) THEN now() ELSE NULL END,
         hidden_by = CASE WHEN coalesce(p_hidden, false) THEN auth.uid() ELSE NULL END
   WHERE id = p_mission_id;

  PERFORM private.write_admin_audit(
    CASE WHEN coalesce(p_hidden, false) THEN 'hide_mission' ELSE 'unhide_mission' END,
    'mission',
    p_mission_id::text,
    jsonb_build_object('status', v_status, 'hidden_at', v_hidden),
    jsonb_build_object('status', v_status, 'hidden', coalesce(p_hidden, false))
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_set_mission_hidden(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_mission_hidden(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_mission_hidden(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_mission_hidden(uuid, boolean) TO service_role;

COMMENT ON FUNCTION public.admin_set_mission_hidden(uuid, boolean) IS
  'Admin P1: soft-hide or unhide a mission. Does not delete child rows.';

-- Ghost pins: pending_payment older than 24h. Soft-hide, do not DELETE.
CREATE OR REPLACE FUNCTION public.admin_hide_stale_ghost_pins()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cutoff timestamptz := now() - interval '24 hours';
  v_count integer := 0;
BEGIN
  IF NOT (
    coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    OR public.is_platform_admin(auth.uid())
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH updated AS (
    UPDATE public.missions
       SET hidden_at = now(),
           hidden_by = auth.uid()
     WHERE hidden_at IS NULL
       AND lower(coalesce(status::text, '')) = 'pending_payment'
       AND created_at < v_cutoff
    RETURNING id
  )
  SELECT count(*)::integer INTO v_count FROM updated;

  PERFORM private.write_admin_audit(
    'hide_stale_ghost_pins',
    'mission',
    NULL,
    jsonb_build_object('cutoff', v_cutoff, 'status', 'pending_payment'),
    jsonb_build_object('hidden_count', v_count)
  );

  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_hide_stale_ghost_pins() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_hide_stale_ghost_pins() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_hide_stale_ghost_pins() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_hide_stale_ghost_pins() TO service_role;

COMMENT ON FUNCTION public.admin_hide_stale_ghost_pins() IS
  'Admin P1: soft-hide pending_payment missions older than 24 hours.';

-- ---------------------------------------------------------------------------
-- Server-side mission search (every status; stuck queue excludes completed)
-- Returns { rows, total } so an empty page still reports the count.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_search_missions(
  p_query text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_hidden text DEFAULT 'all',
  p_queue text DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 100000));
  v_q text := btrim(coalesce(p_query, ''));
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_hidden text := lower(btrim(coalesce(p_hidden, 'all')));
  v_queue text := lower(btrim(coalesce(p_queue, '')));
  v_result jsonb;
BEGIN
  IF NOT (
    coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    OR public.is_platform_admin(auth.uid())
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_q <> '' THEN
    v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  END IF;

  WITH filtered AS (
    SELECT
      m.id,
      m.status::text AS status,
      m.creator_id,
      m.cleaner_id,
      m.category::text AS category,
      m.amount_target,
      m.description,
      m.created_at,
      m.photo_urls,
      m.after_photo_urls,
      m.ai_confidence_score,
      m.ai_verdict,
      m.hidden_at
    FROM public.missions m
    WHERE (
        v_q = ''
        OR m.id::text ILIKE '%' || v_q || '%' ESCAPE '\'
        OR coalesce(m.status::text, '') ILIKE '%' || v_q || '%' ESCAPE '\'
        OR coalesce(m.description, '') ILIKE '%' || v_q || '%' ESCAPE '\'
        OR coalesce(m.category::text, '') ILIKE '%' || v_q || '%' ESCAPE '\'
        OR coalesce(m.creator_id::text, '') ILIKE '%' || v_q || '%' ESCAPE '\'
        OR coalesce(m.cleaner_id::text, '') ILIKE '%' || v_q || '%' ESCAPE '\'
      )
      AND (
        v_status = ''
        OR lower(coalesce(m.status::text, '')) = v_status
      )
      AND (
        (v_hidden = 'hidden' AND m.hidden_at IS NOT NULL)
        OR (v_hidden = 'visible' AND m.hidden_at IS NULL)
        OR v_hidden NOT IN ('hidden', 'visible')
      )
      AND (
        v_queue NOT IN ('stuck', 'disputes')
        OR m.hidden_at IS NULL
      )
      -- Stuck = waiting on a person, or proof photos while still in_progress.
      -- Terminal rows (completed / finished / approved / cancelled / expired / failed)
      -- are never stuck, even when they have after photos.
      AND (
        v_queue <> 'stuck'
        OR (
          lower(coalesce(m.status::text, '')) NOT IN (
            'completed', 'finished', 'approved', 'cancelled', 'expired', 'failed'
          )
          AND (
            lower(coalesce(m.status::text, '')) IN (
              'review',
              'pending_approval',
              'awaiting_approval',
              'pending_verification',
              'disputed',
              'dispute'
            )
            OR (
              lower(coalesce(m.status::text, '')) = 'in_progress'
              AND coalesce(cardinality(m.after_photo_urls), 0) > 0
            )
          )
        )
      )
      AND (
        v_queue <> 'disputes'
        OR lower(coalesce(m.status::text, '')) IN (
          'disputed',
          'dispute',
          'pending_verification',
          'review',
          'pending_approval',
          'awaiting_approval'
        )
      )
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtered),
    'rows', coalesce((
      SELECT jsonb_agg(to_jsonb(page_rows) ORDER BY page_rows.created_at DESC NULLS LAST, page_rows.id DESC)
      FROM (
        SELECT *
        FROM filtered
        ORDER BY created_at DESC NULLS LAST, id DESC
        LIMIT v_limit OFFSET v_offset
      ) page_rows
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_search_missions(text, text, text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_missions(text, text, text, text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_search_missions(text, text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_missions(text, text, text, text, integer, integer) TO service_role;

COMMENT ON FUNCTION public.admin_search_missions(text, text, text, text, integer, integer) IS
  'Admin P1: paginated mission search. Blank p_status = every status. p_queue=stuck excludes completed and other terminal statuses.';

-- ---------------------------------------------------------------------------
-- Server-side profile search
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_search_profiles(
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 100000));
  v_q text := btrim(coalesce(p_query, ''));
  v_result jsonb;
BEGIN
  IF NOT (
    coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    OR public.is_platform_admin(auth.uid())
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_q <> '' THEN
    v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  END IF;

  WITH filtered AS (
    SELECT
      p.id,
      p.full_name,
      p.telegram_username,
      p.contact_email,
      nullif(btrim(coalesce(p.phone_number, '')), '') AS phone_number,
      p.wallet_balance,
      coalesce(p.token_balance, 0)::integer AS token_balance,
      p.subscription_expires_at,
      coalesce(
        p.verification_status,
        CASE WHEN coalesce(p.is_verified, false) THEN 'verified' ELSE 'unverified' END
      ) AS verification_status,
      p.avatar_url,
      coalesce(p.is_verified, false) AS is_verified,
      coalesce(p.is_banned, false) AS is_banned,
      CASE
        WHEN p.first_gps_track IS NULL THEN NULL
        ELSE p.first_gps_track::jsonb
      END AS first_gps_track,
      s.id AS store_id,
      s.store_name,
      coalesce(s.is_published, false) AS store_published
    FROM public.profiles p
    LEFT JOIN LATERAL (
      SELECT cs.id, cs.store_name, cs.is_published
      FROM public.contractor_stores cs
      WHERE cs.owner_id = p.id
      ORDER BY cs.is_published DESC, cs.updated_at DESC NULLS LAST
      LIMIT 1
    ) s ON true
    WHERE v_q = ''
       OR p.id::text ILIKE '%' || v_q || '%' ESCAPE '\'
       OR coalesce(p.full_name, '') ILIKE '%' || v_q || '%' ESCAPE '\'
       OR coalesce(p.contact_email, '') ILIKE '%' || v_q || '%' ESCAPE '\'
       OR coalesce(p.telegram_username, '') ILIKE '%' || v_q || '%' ESCAPE '\'
       OR coalesce(p.phone_number, '') ILIKE '%' || v_q || '%' ESCAPE '\'
       OR coalesce(s.store_name, '') ILIKE '%' || v_q || '%' ESCAPE '\'
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtered),
    'rows', coalesce((
      SELECT jsonb_agg(to_jsonb(page_rows) ORDER BY page_rows.full_name NULLS LAST, page_rows.id)
      FROM (
        SELECT *
        FROM filtered
        ORDER BY full_name NULLS LAST, id
        LIMIT v_limit OFFSET v_offset
      ) page_rows
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_search_profiles(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_profiles(text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_search_profiles(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_profiles(text, integer, integer) TO service_role;

COMMENT ON FUNCTION public.admin_search_profiles(text, integer, integer) IS
  'Admin P1: paginated profile directory search (name, email, phone, telegram, id).';

-- Pulse cards. Does not replace admin_financial_metrics (live return shape stays).
CREATE OR REPLACE FUNCTION public.admin_marketplace_counts()
RETURNS TABLE (
  active_missions bigint,
  completed_missions bigint
)
LANGUAGE plpgsql
STABLE
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

  RETURN QUERY
  SELECT
    (
      SELECT count(*)::bigint
      FROM public.missions m
      WHERE m.hidden_at IS NULL
        AND lower(coalesce(m.status::text, '')) IN (
          'open', 'available', 'pending', 'funding', 'in_progress',
          'review', 'pending_approval', 'awaiting_approval',
          'pending_verification', 'disputed', 'dispute'
        )
    ) AS active_missions,
    (
      SELECT count(*)::bigint
      FROM public.missions m
      WHERE m.hidden_at IS NULL
        AND lower(coalesce(m.status::text, '')) IN ('completed', 'finished', 'approved')
    ) AS completed_missions;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_marketplace_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_marketplace_counts() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_marketplace_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_marketplace_counts() TO service_role;

COMMENT ON FUNCTION public.admin_marketplace_counts() IS
  'Admin P1: visible active/completed mission counts. Independent of admin_financial_metrics.';

-- ---------------------------------------------------------------------------
-- Audit hooks on existing admin mutations.
-- force_cancel_mission: refund block is the P0 body, unchanged.
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

  -- Admin P1: audit only. Refund logic above is unchanged.
  PERFORM private.write_admin_audit(
    'force_cancel_mission',
    'mission',
    p_mission_id::text,
    jsonb_build_object('status', v_status, 'creator_id', v_creator_id, 'amount', v_amount),
    jsonb_build_object('status', 'cancelled')
  );
end;
$fn$;

REVOKE ALL ON FUNCTION public.force_cancel_mission(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.force_cancel_mission(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.force_cancel_mission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.force_cancel_mission(uuid) TO service_role;

COMMENT ON FUNCTION public.force_cancel_mission(uuid) IS
  'Admin P0/P1: platform-admin only. Legacy frozen->wallet refund kept. Writes admin_audit_log.';

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
DECLARE
  v_old_verdict text;
  v_old_score integer;
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

  SELECT ai_verdict, ai_confidence_score
    INTO v_old_verdict, v_old_score
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  UPDATE public.missions
     SET ai_verdict = nullif(btrim(p_verdict), ''),
         ai_confidence_score = CASE WHEN p_confidence IS NULL THEN NULL ELSE round(p_confidence)::integer END
   WHERE id = p_mission_id;

  PERFORM private.write_admin_audit(
    'admin_set_ai_verdict',
    'mission',
    p_mission_id::text,
    jsonb_build_object('ai_verdict', v_old_verdict, 'ai_confidence_score', v_old_score),
    jsonb_build_object(
      'ai_verdict', nullif(btrim(p_verdict), ''),
      'ai_confidence_score', CASE WHEN p_confidence IS NULL THEN NULL ELSE round(p_confidence)::integer END
    )
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_set_ai_verdict(uuid, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_ai_verdict(uuid, text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_ai_verdict(uuid, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_ai_verdict(uuid, text, numeric) TO service_role;

COMMENT ON FUNCTION public.admin_set_ai_verdict(uuid, text, numeric) IS
  'Admin P0/P1: platform-admin only write of missions.ai_verdict / ai_confidence_score. Audited.';

CREATE OR REPLACE FUNCTION public.admin_factory_reset()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_missions bigint := 0;
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

  SELECT count(*) INTO v_missions FROM public.missions;

  -- Log before the wipe. admin_audit_log is intentionally not in the delete list.
  PERFORM private.write_admin_audit(
    'admin_factory_reset',
    'platform',
    NULL,
    jsonb_build_object('missions', v_missions),
    jsonb_build_object('wiped', true)
  );

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
  'Platform-admin only AND private.app_config allow_factory_reset=''true''. Does not delete admin_audit_log. Refuses on prod by default.';

CREATE OR REPLACE FUNCTION public.admin_grant_tokens(p_user_id uuid, p_tokens integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_prev integer;
  v_next integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF p_user_id IS NULL OR p_tokens IS NULL OR p_tokens = 0 OR abs(p_tokens) > 100000 THEN
    RAISE EXCEPTION 'Invalid token amount';
  END IF;

  SELECT coalesce(token_balance, 0)
    INTO v_prev
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  UPDATE public.profiles
  SET token_balance = greatest(0, coalesce(token_balance, 0) + p_tokens)
  WHERE id = p_user_id
  RETURNING token_balance INTO v_next;

  PERFORM private.write_admin_audit(
    'admin_grant_tokens',
    'profile',
    p_user_id::text,
    jsonb_build_object('token_balance', v_prev),
    jsonb_build_object('token_balance', v_next, 'delta', p_tokens)
  );

  RETURN v_next;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_set_token_balance(p_user_id uuid, p_balance integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_prev integer;
  v_next integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF p_user_id IS NULL OR p_balance IS NULL OR p_balance < 0 OR p_balance > 1000000 THEN
    RAISE EXCEPTION 'Invalid token balance';
  END IF;

  SELECT coalesce(token_balance, 0)
    INTO v_prev
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  UPDATE public.profiles
  SET token_balance = p_balance
  WHERE id = p_user_id
  RETURNING token_balance INTO v_next;

  PERFORM private.write_admin_audit(
    'admin_set_token_balance',
    'profile',
    p_user_id::text,
    jsonb_build_object('token_balance', v_prev),
    jsonb_build_object('token_balance', v_next)
  );

  RETURN v_next;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_grant_tokens(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_grant_tokens(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.admin_set_token_balance(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_token_balance(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_tokens(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_token_balance(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_wallet_balance(p_user_id uuid, p_balance numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_prev numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF p_user_id IS NULL OR p_balance IS NULL OR p_balance < 0 THEN
    RAISE EXCEPTION 'Invalid balance';
  END IF;

  SELECT wallet_balance INTO v_prev
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  UPDATE public.profiles
  SET wallet_balance = p_balance
  WHERE id = p_user_id;

  PERFORM private.write_admin_audit(
    'admin_set_wallet_balance',
    'profile',
    p_user_id::text,
    jsonb_build_object('wallet_balance', v_prev),
    jsonb_build_object('wallet_balance', p_balance)
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_set_profile_banned(p_user_id uuid, p_banned boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_prev boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid user';
  END IF;

  SELECT coalesce(is_banned, false) INTO v_prev
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  UPDATE public.profiles
  SET is_banned = coalesce(p_banned, false)
  WHERE id = p_user_id;

  PERFORM private.write_admin_audit(
    'admin_set_profile_banned',
    'profile',
    p_user_id::text,
    jsonb_build_object('is_banned', v_prev),
    jsonb_build_object('is_banned', coalesce(p_banned, false))
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_set_profile_verified(p_user_id uuid, p_verified boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_prev boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid user';
  END IF;

  SELECT coalesce(is_verified, false) INTO v_prev
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  UPDATE public.profiles
  SET is_verified = coalesce(p_verified, false)
  WHERE id = p_user_id;

  PERFORM private.write_admin_audit(
    'admin_set_profile_verified',
    'profile',
    p_user_id::text,
    jsonb_build_object('is_verified', v_prev),
    jsonb_build_object('is_verified', coalesce(p_verified, false))
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_set_wallet_balance(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_wallet_balance(uuid, numeric) FROM anon;
REVOKE ALL ON FUNCTION public.admin_set_profile_banned(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_profile_banned(uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.admin_set_profile_verified(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_profile_verified(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_wallet_balance(uuid, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_banned(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_verified(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.moderate_kyc_verification(
  p_user_id uuid,
  p_decision text,
  p_rejection_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_decision text := lower(trim(coalesce(p_decision, '')));
  v_current_status text;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_platform_admin(v_uid) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User id is required';
  END IF;

  IF v_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Decision must be approve or reject';
  END IF;

  SELECT lower(coalesce(verification_status, ''))
  INTO v_current_status
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF v_current_status <> 'pending' THEN
    RAISE EXCEPTION 'User is not pending KYC review (status=%)', v_current_status;
  END IF;

  IF v_decision = 'approve' THEN
    UPDATE public.profiles
    SET
      verification_status = 'verified',
      verification_rejection_reason = NULL
    WHERE id = p_user_id;
    v_reason := NULL;
  ELSE
    v_reason := CASE
      WHEN p_rejection_reason IS NULL OR length(trim(p_rejection_reason)) = 0
        THEN NULL
      ELSE left(trim(p_rejection_reason), 500)
    END;
    UPDATE public.profiles
    SET
      verification_status = 'rejected',
      verification_rejection_reason = v_reason
    WHERE id = p_user_id;
  END IF;

  PERFORM private.write_admin_audit(
    'moderate_kyc_verification',
    'profile',
    p_user_id::text,
    jsonb_build_object('verification_status', v_current_status),
    jsonb_build_object(
      'verification_status', CASE WHEN v_decision = 'approve' THEN 'verified' ELSE 'rejected' END,
      'decision', v_decision,
      'rejection_reason', v_reason
    )
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.moderate_kyc_verification(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.moderate_kyc_verification(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.moderate_kyc_verification(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.moderate_kyc_verification(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.moderate_kyc_verification(uuid, text, text) IS
  'Admin-only: approve (verified) or reject pending KYC. Syncs is_verified via trigger. Audited.';

CREATE OR REPLACE FUNCTION public.resolve_mission_dispute(
  p_mission_id uuid,
  p_decision text,
  p_supervisor_comment text,
  p_supervisor_verified boolean DEFAULT false,
  p_supervisor_user_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_mission record;
  v_retry_count integer;
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_before jsonb;
  v_after_status text;
  v_after_cleaner uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Admin (is_platform_admin) or supervisor flag
  SELECT
    public.is_platform_admin(v_uid)
    OR coalesce(
      (SELECT p.is_supervisor FROM public.profiles p WHERE p.id = v_uid),
      false
    )
  INTO v_is_admin;

  IF NOT coalesce(v_is_admin, false) THEN
    RAISE EXCEPTION 'Moderator access required';
  END IF;

  SELECT * INTO v_mission
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  IF lower(coalesce(v_mission.status::text, '')) = 'completed'
     OR lower(coalesce(v_mission.status::text, '')) = 'finished' THEN
    RAISE EXCEPTION 'Mission already closed';
  END IF;

  v_before := jsonb_build_object(
    'status', v_mission.status,
    'cleaner_id', v_mission.cleaner_id,
    'is_disputed', v_mission.is_disputed
  );

  IF lower(coalesce(p_decision, '')) = 'approve' THEN
    -- P2P: content moderation only — mark completed. No wallet / frozen_balance moves.
    UPDATE public.missions
    SET
      status = 'completed',
      rejection_reason = NULL,
      is_disputed = false
    WHERE id = p_mission_id;

  ELSIF lower(coalesce(p_decision, '')) = 'reject' THEN
    UPDATE public.missions
    SET retry_count = coalesce(retry_count, 0) + 1
    WHERE id = p_mission_id
    RETURNING retry_count INTO v_retry_count;

    IF coalesce(v_retry_count, 0) < 3 THEN
      UPDATE public.missions
      SET
        status = 'in_progress',
        after_photo_urls = NULL,
        proof_video_url = NULL,
        report_submitted_at = NULL,
        rejection_reason = nullif(trim(coalesce(p_supervisor_comment, '')), ''),
        is_disputed = false
      WHERE id = p_mission_id;
    ELSE
      -- Too many retries: reopen for bidding (no refunds — P2P / tokens retained)
      UPDATE public.missions
      SET
        status = 'available',
        cleaner_id = NULL,
        after_photo_urls = NULL,
        proof_video_url = NULL,
        report_submitted_at = NULL,
        rejection_reason = nullif(trim(coalesce(p_supervisor_comment, '')), ''),
        retry_count = 0,
        is_disputed = false,
        started_at = NULL
      WHERE id = p_mission_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid decision: %', p_decision;
  END IF;

  SELECT status::text, cleaner_id
    INTO v_after_status, v_after_cleaner
  FROM public.missions
  WHERE id = p_mission_id;

  PERFORM private.write_admin_audit(
    'resolve_mission_dispute',
    'mission',
    p_mission_id::text,
    v_before,
    jsonb_build_object(
      'status', v_after_status,
      'cleaner_id', v_after_cleaner,
      'decision', lower(coalesce(p_decision, ''))
    )
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.resolve_mission_dispute(uuid, text, text, boolean, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_mission_dispute(uuid, text, text, boolean, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_mission_dispute(uuid, text, text, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_mission_dispute(uuid, text, text, boolean, uuid) TO service_role;

COMMENT ON FUNCTION public.resolve_mission_dispute(uuid, text, text, boolean, uuid) IS
  'Moderator content decision only. No escrow debit/credit. Approve → completed; reject → retry or reopen. Audited.';

-- Hard delete stays available for operators. The panel calls admin_set_mission_hidden instead.
CREATE OR REPLACE FUNCTION public.admin_delete_mission(p_mission_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_platform_admin(v_uid) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  IF p_mission_id IS NULL THEN
    RAISE EXCEPTION 'Mission id required';
  END IF;

  SELECT status::text INTO v_status
  FROM public.missions
  WHERE id = p_mission_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  PERFORM private.write_admin_audit(
    'admin_delete_mission',
    'mission',
    p_mission_id::text,
    jsonb_build_object('status', v_status),
    jsonb_build_object('deleted', true)
  );

  -- Explicit deletes so missing ON DELETE CASCADE / RLS never blocks admin moderation.
  IF to_regclass('public.mission_chats') IS NOT NULL THEN
    DELETE FROM public.mission_chats WHERE mission_id = p_mission_id;
  END IF;

  IF to_regclass('public.mission_bids') IS NOT NULL THEN
    DELETE FROM public.mission_bids WHERE mission_id = p_mission_id;
  END IF;

  IF to_regclass('public.contributions') IS NOT NULL THEN
    DELETE FROM public.contributions WHERE mission_id = p_mission_id;
  END IF;

  IF to_regclass('public.notifications') IS NOT NULL THEN
    DELETE FROM public.notifications WHERE mission_id = p_mission_id;
  END IF;

  IF to_regclass('public.reviews') IS NOT NULL THEN
    DELETE FROM public.reviews WHERE mission_id = p_mission_id;
  END IF;

  IF to_regclass('public.city_notification_events') IS NOT NULL THEN
    DELETE FROM public.city_notification_events WHERE mission_id = p_mission_id;
  END IF;

  -- Ledger rows may reference missions with ON DELETE SET NULL or RESTRICT.
  IF to_regclass('public.transactions') IS NOT NULL THEN
    BEGIN
      UPDATE public.transactions
      SET mission_id = NULL
      WHERE mission_id = p_mission_id;
    EXCEPTION
      WHEN undefined_column THEN
        NULL;
      WHEN OTHERS THEN
        BEGIN
          DELETE FROM public.transactions WHERE mission_id = p_mission_id;
        EXCEPTION
          WHEN OTHERS THEN
            RAISE NOTICE 'admin_delete_mission: transactions cleanup skipped: %', SQLERRM;
        END;
    END;
  END IF;

  DELETE FROM public.missions WHERE id = p_mission_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_delete_mission(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_mission(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_mission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_mission(uuid) TO service_role;

COMMENT ON FUNCTION public.admin_delete_mission(uuid) IS
  'Platform-admin hard delete. The Admin panel uses admin_set_mission_hidden instead. Audited before delete.';

-- ---------------------------------------------------------------------------
-- Post-flight assertions — fail loudly (whole file rolls back)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fn text;
  v_oid oid;
  v_def text;
  v_qual text;
  v_select_policies integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'missions' AND column_name = 'hidden_at'
  ) THEN
    RAISE EXCEPTION 'Post-flight failed: missions.hidden_at missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'missions' AND column_name = 'hidden_by'
  ) THEN
    RAISE EXCEPTION 'Post-flight failed: missions.hidden_by missing';
  END IF;

  IF has_column_privilege('authenticated', 'public.missions', 'hidden_at', 'UPDATE')
     OR has_column_privilege('anon', 'public.missions', 'hidden_at', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.missions', 'hidden_by', 'UPDATE')
     OR has_column_privilege('anon', 'public.missions', 'hidden_by', 'UPDATE')
  THEN
    RAISE EXCEPTION 'Post-flight failed: client roles can UPDATE missions.hidden_at / hidden_by';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'admin_audit_log' AND c.relkind = 'r'
  ) THEN
    RAISE EXCEPTION 'Post-flight failed: admin_audit_log missing';
  END IF;

  IF NOT (
    SELECT c.relrowsecurity AND c.relforcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'admin_audit_log'
  ) THEN
    RAISE EXCEPTION 'Post-flight failed: admin_audit_log RLS is not enabled and forced';
  END IF;

  IF has_table_privilege('anon', 'public.admin_audit_log', 'SELECT')
     OR has_table_privilege('anon', 'public.admin_audit_log', 'INSERT')
     OR has_table_privilege('authenticated', 'public.admin_audit_log', 'INSERT')
     OR has_table_privilege('authenticated', 'public.admin_audit_log', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.admin_audit_log', 'DELETE')
  THEN
    RAISE EXCEPTION 'Post-flight failed: client roles can write or anon can read admin_audit_log';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.admin_audit_log', 'SELECT') THEN
    RAISE EXCEPTION 'Post-flight failed: authenticated lost SELECT on admin_audit_log';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'admin_audit_log'
      AND policyname = 'admin_audit_log_select_platform_admin'
      AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'Post-flight failed: admin audit SELECT policy missing';
  END IF;

  IF to_regprocedure('private.write_admin_audit(text,text,text,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Post-flight failed: private.write_admin_audit missing';
  END IF;

  IF has_function_privilege('anon', 'private.write_admin_audit(text,text,text,jsonb,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.write_admin_audit(text,text,text,jsonb,jsonb)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'Post-flight failed: client roles can EXECUTE private.write_admin_audit';
  END IF;

  SELECT count(*) INTO v_select_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'missions' AND cmd = 'SELECT';

  IF v_select_policies <> 1 THEN
    RAISE EXCEPTION 'Post-flight failed: missions has % SELECT policies (expected 1)', v_select_policies;
  END IF;

  SELECT qual INTO v_qual
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'missions' AND policyname = 'missions_select_all';

  IF v_qual IS NULL OR position('hidden_at' IN v_qual) = 0 THEN
    RAISE EXCEPTION 'Post-flight failed: missions_select_all does not mention hidden_at';
  END IF;

  IF position('hidden_at' IN pg_get_functiondef('public.protect_mission_lifecycle_columns()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'Post-flight failed: lifecycle trigger does not protect hidden_at';
  END IF;

  -- Participant photo updates must still be allowed (Wave F).
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'missions' AND column_name = 'photo_urls'
  ) AND NOT has_column_privilege('authenticated', 'public.missions', 'photo_urls', 'UPDATE') THEN
    RAISE EXCEPTION 'Post-flight failed: authenticated lost UPDATE on missions.photo_urls';
  END IF;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_set_mission_hidden(uuid,boolean)',
    'public.admin_hide_stale_ghost_pins()',
    'public.admin_search_missions(text,text,text,text,integer,integer)',
    'public.admin_search_profiles(text,integer,integer)',
    'public.admin_marketplace_counts()',
    'public.force_cancel_mission(uuid)',
    'public.admin_set_ai_verdict(uuid,text,numeric)',
    'public.admin_factory_reset()',
    'public.admin_grant_tokens(uuid,integer)',
    'public.admin_set_profile_banned(uuid,boolean)',
    'public.admin_set_profile_verified(uuid,boolean)',
    'public.moderate_kyc_verification(uuid,text,text)',
    'public.resolve_mission_dispute(uuid,text,text,boolean,uuid)',
    'public.admin_delete_mission(uuid)'
  ]
  LOOP
    v_oid := to_regprocedure(v_fn);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Post-flight failed: % missing', v_fn;
    END IF;

    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
      RAISE EXCEPTION 'Post-flight failed: % is not SECURITY DEFINER', v_fn;
    END IF;

    v_def := pg_get_functiondef(v_oid);
    IF position('is_platform_admin' IN v_def) = 0 THEN
      RAISE EXCEPTION 'Post-flight failed: % has no is_platform_admin guard', v_fn;
    END IF;

    IF position('write_admin_audit' IN v_def) = 0
       AND v_fn NOT IN (
         'public.admin_search_missions(text,text,text,text,integer,integer)',
         'public.admin_search_profiles(text,integer,integer)',
         'public.admin_marketplace_counts()'
       )
    THEN
      RAISE EXCEPTION 'Post-flight failed: % does not write the audit log', v_fn;
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
      RAISE EXCEPTION 'Post-flight failed: authenticated lost EXECUTE on %', v_fn;
    END IF;
  END LOOP;

  v_def := pg_get_functiondef('public.admin_search_missions(text,text,text,text,integer,integer)'::regprocedure);
  IF position('''completed''' IN v_def) = 0
     OR position('in_progress' IN v_def) = 0
     OR position('NOT IN' IN v_def) = 0
  THEN
    RAISE EXCEPTION 'Post-flight failed: stuck queue does not exclude completed';
  END IF;

  v_def := pg_get_functiondef('public.force_cancel_mission(uuid)'::regprocedure);
  IF position('frozen_balance' IN v_def) = 0 OR position('Insufficient frozen balance' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Post-flight failed: force_cancel_mission refund logic changed';
  END IF;

  IF position('allow_factory_reset' IN pg_get_functiondef('public.admin_factory_reset()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'Post-flight failed: admin_factory_reset lost the allow_factory_reset gate';
  END IF;

  IF position('admin_audit_log' IN pg_get_functiondef('public.admin_factory_reset()'::regprocedure)) > 0
     AND position('DELETE FROM public.admin_audit_log' IN pg_get_functiondef('public.admin_factory_reset()'::regprocedure)) > 0
  THEN
    RAISE EXCEPTION 'Post-flight failed: factory reset deletes the audit log';
  END IF;

  -- Live financial RPC shape must survive this file (do not depend on the unapplied 20260721 columns).
  IF to_regprocedure('public.admin_financial_metrics()') IS NOT NULL THEN
    v_def := pg_get_functiondef('public.admin_financial_metrics()'::regprocedure);
    IF position('pending_payouts' IN v_def) = 0 OR position('pending_withdrawals' IN v_def) = 0 THEN
      RAISE EXCEPTION 'Post-flight failed: admin_financial_metrics lost the live return columns';
    END IF;
    IF position('is_platform_admin' IN v_def) = 0 THEN
      RAISE EXCEPTION 'Post-flight failed: admin_financial_metrics lost its admin guard';
    END IF;
  END IF;
END $$;

COMMIT;
