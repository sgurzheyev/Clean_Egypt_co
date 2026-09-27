-- ============================================================================
-- Token donations on free garbage pins and crowdfunding missions
-- ----------------------------------------------------------------------------
-- Apply after 20260927140000 (do NOT db push, do NOT edit the vortex files):
--   supabase db query --linked -f supabase/migrations/20260927150000_token_donations.sql
-- Idempotent.
--
-- Escrow choice:
--   profiles.token_balance is the spendable token wallet.
--   missions.amount_target is a burned listing bid (rank), not a payout.
--   profiles.frozen_balance is the legacy fiat wallet hold. Live completion
--   RPCs explicitly do not move it.
--   missions.current_funding is USD from Stripe. Mixing tokens into it would
--   look like dollars raised and would skip the quiet hide.
--   Donated tokens therefore sit in token_donations (status=held) and
--   missions.token_donation_pool. Completion credits the assigned cleaner's
--   token_balance. Hide / expire / archive / cancel refunds each held row
--   to its donor. No mission row is created here.
--
-- Own pin: the creator cannot donate. Same rule as Stripe on a free report.
--
-- Audit: private.write_admin_audit is for admin RPCs (not granted to
-- authenticated). A user donation is not an admin action. token_donations
-- is the trail (donor, mission, tokens, status, created_at, settled_at).
--
-- Admin hard-delete: a BEFORE DELETE trigger refunds held rows, then
-- ON DELETE CASCADE removes the ledger with the mission. Balances return
-- to the donors. The row trail does not survive the delete.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.token_donation_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  max_tokens_per_donation integer NOT NULL DEFAULT 100,
  max_donations_per_hour integer NOT NULL DEFAULT 10,
  max_tokens_per_day integer NOT NULL DEFAULT 300,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.token_donation_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.token_donation_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.token_donation_config FROM PUBLIC;
REVOKE ALL ON TABLE public.token_donation_config FROM anon;
REVOKE ALL ON TABLE public.token_donation_config FROM authenticated;

CREATE TABLE IF NOT EXISTS public.token_donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id uuid NOT NULL REFERENCES public.profiles (id),
  mission_id uuid NOT NULL REFERENCES public.missions (id) ON DELETE CASCADE,
  tokens integer NOT NULL CHECK (tokens > 0),
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'paid_out', 'refunded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_token_donations_donor_recent
  ON public.token_donations (donor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_token_donations_mission_held
  ON public.token_donations (mission_id)
  WHERE status = 'held';

ALTER TABLE public.token_donations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.token_donations FROM PUBLIC;
REVOKE ALL ON TABLE public.token_donations FROM anon;
REVOKE ALL ON TABLE public.token_donations FROM authenticated;

DROP POLICY IF EXISTS token_donations_select_own ON public.token_donations;
CREATE POLICY token_donations_select_own
  ON public.token_donations
  FOR SELECT
  TO authenticated
  USING (donor_id = auth.uid() OR public.is_platform_admin(auth.uid()));

GRANT SELECT ON TABLE public.token_donations TO authenticated;

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS token_donation_pool integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.missions.token_donation_pool IS
  'Sum of token_donations still held for this pin. Not USD and not the listing bid.';

REVOKE UPDATE (token_donation_pool) ON TABLE public.missions FROM PUBLIC;
REVOKE UPDATE (token_donation_pool) ON TABLE public.missions FROM anon;
REVOKE UPDATE (token_donation_pool) ON TABLE public.missions FROM authenticated;

-- ---------------------------------------------------------------------------
-- Settle held rows. Owner-only. Callers: donate trigger, expiry, completion.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_held_token_donations(p_mission_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_row record;
  v_sum integer := 0;
BEGIN
  IF p_mission_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Mission first, then donation rows, then donor wallets.
  -- donate_tokens_to_pin locks mission then the donor wallet.
  PERFORM 1
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  FOR v_row IN
    SELECT d.id, d.donor_id, d.tokens
    FROM public.token_donations d
    WHERE d.mission_id = p_mission_id
      AND d.status = 'held'
    ORDER BY d.donor_id, d.created_at
    FOR UPDATE
  LOOP
    UPDATE public.profiles
       SET token_balance = coalesce(token_balance, 0) + v_row.tokens
     WHERE id = v_row.donor_id;

    UPDATE public.token_donations
       SET status = 'refunded',
           settled_at = now()
     WHERE id = v_row.id;

    v_sum := v_sum + v_row.tokens;
  END LOOP;

  IF v_sum > 0 THEN
    UPDATE public.missions
       SET token_donation_pool = 0
     WHERE id = p_mission_id;
  END IF;

  RETURN v_sum;
END;
$$;

CREATE OR REPLACE FUNCTION public.payout_held_token_donations(p_mission_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_cleaner uuid;
  v_sum integer := 0;
BEGIN
  IF p_mission_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT m.cleaner_id
    INTO v_cleaner
  FROM public.missions m
  WHERE m.id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  IF v_cleaner IS NULL THEN
    RETURN public.refund_held_token_donations(p_mission_id);
  END IF;

  PERFORM 1
  FROM public.token_donations d
  WHERE d.mission_id = p_mission_id
    AND d.status = 'held'
  FOR UPDATE;

  SELECT coalesce(sum(d.tokens), 0)::integer
    INTO v_sum
  FROM public.token_donations d
  WHERE d.mission_id = p_mission_id
    AND d.status = 'held';

  IF v_sum <= 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.profiles
     SET token_balance = coalesce(token_balance, 0) + v_sum
   WHERE id = v_cleaner;

  IF NOT FOUND THEN
    RETURN public.refund_held_token_donations(p_mission_id);
  END IF;

  UPDATE public.token_donations
     SET status = 'paid_out',
         settled_at = now()
   WHERE mission_id = p_mission_id
     AND status = 'held';

  UPDATE public.missions
     SET token_donation_pool = 0
   WHERE id = p_mission_id;

  RETURN v_sum;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_held_token_donations(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_held_token_donations(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.refund_held_token_donations(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.payout_held_token_donations(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payout_held_token_donations(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.payout_held_token_donations(uuid) FROM authenticated;

CREATE OR REPLACE FUNCTION public.trg_settle_token_donations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_new text := lower(coalesce(NEW.status::text, ''));
  v_old text := lower(coalesce(OLD.status::text, ''));
BEGIN
  IF v_new IS NOT DISTINCT FROM v_old THEN
    RETURN NEW;
  END IF;

  IF v_new = 'completed' THEN
    PERFORM public.payout_held_token_donations(NEW.id);
  ELSIF v_new IN ('hidden', 'expired', 'archived', 'cancelled')
        AND v_old NOT IN ('hidden', 'expired', 'archived', 'cancelled', 'completed') THEN
    PERFORM public.refund_held_token_donations(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_settle_token_donations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_settle_token_donations() FROM anon;
REVOKE ALL ON FUNCTION public.trg_settle_token_donations() FROM authenticated;

-- Hard delete (admin_delete_mission) never passes through status=hidden.
-- Credit donors before CASCADE drops the ledger. Do not UPDATE the mission
-- row from here; it is the row being deleted.
CREATE OR REPLACE FUNCTION public.trg_refund_token_donations_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_row record;
BEGIN
  FOR v_row IN
    SELECT d.id, d.donor_id, d.tokens
    FROM public.token_donations d
    WHERE d.mission_id = OLD.id
      AND d.status = 'held'
    ORDER BY d.donor_id, d.created_at
    FOR UPDATE
  LOOP
    UPDATE public.profiles
       SET token_balance = coalesce(token_balance, 0) + v_row.tokens
     WHERE id = v_row.donor_id;

    UPDATE public.token_donations
       SET status = 'refunded',
           settled_at = now()
     WHERE id = v_row.id;
  END LOOP;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_refund_token_donations_before_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_refund_token_donations_before_delete() FROM anon;
REVOKE ALL ON FUNCTION public.trg_refund_token_donations_before_delete() FROM authenticated;

DROP TRIGGER IF EXISTS trg_refund_token_donations_before_delete ON public.missions;
CREATE TRIGGER trg_refund_token_donations_before_delete
  BEFORE DELETE
  ON public.missions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_refund_token_donations_before_delete();

DROP TRIGGER IF EXISTS trg_settle_token_donations ON public.missions;
CREATE TRIGGER trg_settle_token_donations
  AFTER UPDATE OF status
  ON public.missions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_settle_token_donations();

-- ---------------------------------------------------------------------------
-- Donate
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.donate_tokens_to_pin(
  p_mission_id uuid,
  p_tokens integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mission record;
  v_cfg public.token_donation_config;
  v_amount integer;
  v_balance integer;
  v_status text;
  v_expires timestamptz;
  v_hour_count integer;
  v_day_sum integer;
  v_pool integer;
  v_new_expires timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_mission_id IS NULL THEN
    RAISE EXCEPTION 'token_donation_ineligible' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_cfg
  FROM public.token_donation_config
  WHERE id = 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'token_donation_ineligible' USING ERRCODE = 'P0001';
  END IF;

  v_amount := floor(coalesce(p_tokens, 0))::integer;
  IF v_amount < 1 OR v_amount > coalesce(v_cfg.max_tokens_per_donation, 100) THEN
    RAISE EXCEPTION 'token_donation_amount' USING ERRCODE = 'P0001';
  END IF;

  -- One donor at a time, then the pin, then the wallet row.
  PERFORM pg_advisory_xact_lock(hashtext('token-donate:' || v_uid::text));

  SELECT *
    INTO v_mission
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND OR v_mission.hidden_at IS NOT NULL THEN
    RAISE EXCEPTION 'token_donation_ineligible' USING ERRCODE = 'P0001';
  END IF;

  IF v_mission.creator_id IS NOT DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'token_donation_own_pin' USING ERRCODE = 'P0001';
  END IF;

  v_status := lower(coalesce(v_mission.status::text, ''));
  IF v_status IN ('hidden', 'archived', 'expired', 'completed', 'cancelled', 'pending_payment') THEN
    RAISE EXCEPTION 'token_donation_ineligible' USING ERRCODE = 'P0001';
  END IF;

  IF v_status NOT IN ('reported', 'funding', 'available', 'pending', 'open') THEN
    RAISE EXCEPTION 'token_donation_ineligible' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
    coalesce(v_mission.is_report, false)
    OR v_status = 'reported'
    OR coalesce(v_mission.crowdfunding_mode, false)
  ) THEN
    RAISE EXCEPTION 'token_donation_ineligible' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.is_garbage_removal_service(v_mission.service_type) THEN
    RAISE EXCEPTION 'token_donation_ineligible' USING ERRCODE = 'P0001';
  END IF;

  v_expires := coalesce(
    v_mission.crowdfunding_expires_at,
    v_mission.created_at + interval '7 days'
  );
  IF v_expires IS NOT NULL AND v_expires <= now() THEN
    RAISE EXCEPTION 'token_donation_ineligible' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::integer
    INTO v_hour_count
  FROM public.token_donations d
  WHERE d.donor_id = v_uid
    AND d.created_at >= now() - interval '1 hour';

  IF v_hour_count >= coalesce(v_cfg.max_donations_per_hour, 10) THEN
    RAISE EXCEPTION 'token_donation_rate_limit' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(sum(d.tokens), 0)::integer
    INTO v_day_sum
  FROM public.token_donations d
  WHERE d.donor_id = v_uid
    AND d.created_at >= now() - interval '1 day';

  IF v_day_sum + v_amount > coalesce(v_cfg.max_tokens_per_day, 300) THEN
    RAISE EXCEPTION 'token_donation_rate_limit' USING ERRCODE = 'P0001';
  END IF;

  SELECT token_balance
    INTO v_balance
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND OR coalesce(v_balance, 0) < v_amount THEN
    RAISE EXCEPTION 'insufficient_tokens' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.profiles
     SET token_balance = token_balance - v_amount
   WHERE id = v_uid;

  INSERT INTO public.token_donations (donor_id, mission_id, tokens, status)
  VALUES (v_uid, p_mission_id, v_amount, 'held');

  v_new_expires := GREATEST(
    coalesce(v_mission.crowdfunding_expires_at, now()),
    now() + interval '30 days'
  );

  UPDATE public.missions
     SET token_donation_pool = coalesce(token_donation_pool, 0) + v_amount,
         crowdfunding_expires_at = v_new_expires
   WHERE id = p_mission_id
  RETURNING token_donation_pool INTO v_pool;

  RETURN jsonb_build_object(
    'ok', true,
    'mission_id', p_mission_id,
    'tokens', v_amount,
    'pool', v_pool,
    'crowdfunding_expires_at', v_new_expires,
    'token_balance', coalesce(v_balance, 0) - v_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.donate_tokens_to_pin(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.donate_tokens_to_pin(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.donate_tokens_to_pin(uuid, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.donate_tokens_to_pin(uuid, integer) IS
  'Authenticated donor holds tokens on a live garbage report or crowdfunding pin. Not the creator. Extends crowdfunding_expires_at to at least now()+30 days. Does not create a mission or touch USD funding.';

CREATE OR REPLACE FUNCTION public.get_mission_token_donation_summary(p_mission_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, net, pg_temp
AS $$
  SELECT jsonb_build_object(
    'pool', coalesce(m.token_donation_pool, 0),
    'crowdfunding_expires_at', m.crowdfunding_expires_at
  )
  FROM public.missions m
  WHERE m.id = p_mission_id;
$$;

REVOKE ALL ON FUNCTION public.get_mission_token_donation_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mission_token_donation_summary(uuid)
  TO anon, authenticated, service_role;

-- Replace the expiry sweep so a hide refunds held tokens first.
-- The status trigger refunds again as a no-op, and also covers other hide paths.
CREATE OR REPLACE FUNCTION public.expire_stale_free_garbage_pins()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
  v_updated integer;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT coalesce(public.is_platform_admin(auth.uid()), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  FOR v_row IN
    SELECT m.id
    FROM public.missions m
    WHERE m.hidden_at IS NULL
      AND lower(coalesce(m.status::text, '')) = 'reported'
      AND coalesce(m.current_funding, 0) <= 0
      AND (
        coalesce(m.is_report, false)
        OR lower(coalesce(m.status::text, '')) = 'reported'
      )
      AND coalesce(m.crowdfunding_expires_at, m.created_at + interval '7 days') <= now()
    FOR UPDATE OF m SKIP LOCKED
  LOOP
    PERFORM public.refund_held_token_donations(v_row.id);

    UPDATE public.missions
       SET status = 'hidden',
           crowdfunding_expires_at = COALESCE(
             crowdfunding_expires_at,
             created_at + interval '7 days'
           )
     WHERE id = v_row.id
       AND lower(coalesce(status::text, '')) = 'reported'
       AND coalesce(current_funding, 0) <= 0;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated > 0 THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_free_garbage_pins() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_stale_free_garbage_pins() FROM anon;
GRANT EXECUTE ON FUNCTION public.expire_stale_free_garbage_pins() TO authenticated, service_role;

COMMENT ON FUNCTION public.expire_stale_free_garbage_pins() IS
  'Hide $0 free reports past the 7-day clock and refund held token donations. service_role, pg_cron, or a platform admin. Does not create missions or city notices.';

DO $pf$
BEGIN
  IF has_function_privilege('anon', 'public.donate_tokens_to_pin(uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: anon can execute donate_tokens_to_pin';
  END IF;
  IF has_function_privilege('anon', 'public.refund_held_token_donations(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: anon can execute refund_held_token_donations';
  END IF;
  IF has_function_privilege('anon', 'public.payout_held_token_donations(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: anon can execute payout_held_token_donations';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.donate_tokens_to_pin(uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: authenticated cannot execute donate_tokens_to_pin';
  END IF;
END
$pf$;
