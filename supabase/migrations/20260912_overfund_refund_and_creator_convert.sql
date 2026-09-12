-- ============================================================================
-- P0-3 + P1-4 — Overfund race auto-refund + unpaid convert is creator-only
-- ============================================================================
-- APPLY (remote CLI history is out of sync — do NOT rely on `supabase db push`
-- to replay older files). Paste this entire file into the Supabase SQL Editor
-- (or `psql` as a privileged role) AFTER
-- `20260912_split_expiry_and_first_donate_wake.sql` (PR #3 / P0-1 + P0-2).
-- Safe to re-run: CREATE OR REPLACE / IF NOT EXISTS / DROP POLICY IF EXISTS.
-- CLI version is the shared prefix 20260912 — repair, do not push:
-- 04_Roadmap_Tasks/Ops_Migration_History_Repair.md · docs/LIFECYCLE_FIX_APPLY_RUNBOOK.md.
--
-- P0-3: two Checkouts can race for the last $N. apply_stripe_contribution
-- still rejects the loser (no silent clip). Confirm + webhook then claim a
-- refund row and Stripe.refunds.create with idempotency key
-- `cf-reject-refund:{session_id}`. Never refund a session that already has a
-- contributions row. Auth+capture was rejected: existing Checkout is
-- mode=payment; capture-after-apply can credit then fail to capture.
--
-- P1-4: convert_report_to_mission may only be called by the report creator.
-- Neighbors still wake the pin via first Stripe dollar (P0-2).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Ops table: one row per rejected paid Checkout Session
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stripe_contribution_refunds (
  stripe_checkout_session_id text PRIMARY KEY,
  mission_id uuid REFERENCES public.missions(id) ON DELETE SET NULL,
  contributor_id uuid,
  amount_usd integer NOT NULL DEFAULT 0,
  reject_reason text NOT NULL,
  stripe_payment_intent_id text,
  stripe_refund_id text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'refunded', 'already_refunded', 'failed')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_contribution_refunds
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text;
ALTER TABLE public.stripe_contribution_refunds
  ADD COLUMN IF NOT EXISTS mission_id uuid;
ALTER TABLE public.stripe_contribution_refunds
  ADD COLUMN IF NOT EXISTS contributor_id uuid;
ALTER TABLE public.stripe_contribution_refunds
  ADD COLUMN IF NOT EXISTS amount_usd integer;
ALTER TABLE public.stripe_contribution_refunds
  ADD COLUMN IF NOT EXISTS reject_reason text;
ALTER TABLE public.stripe_contribution_refunds
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;
ALTER TABLE public.stripe_contribution_refunds
  ADD COLUMN IF NOT EXISTS stripe_refund_id text;
ALTER TABLE public.stripe_contribution_refunds
  ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.stripe_contribution_refunds
  ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE public.stripe_contribution_refunds
  ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE public.stripe_contribution_refunds
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_stripe_contribution_refunds_status
  ON public.stripe_contribution_refunds (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stripe_contribution_refunds_mission
  ON public.stripe_contribution_refunds (mission_id)
  WHERE mission_id IS NOT NULL;

COMMENT ON TABLE public.stripe_contribution_refunds IS
  'P0-3: paid Checkout Sessions that apply_stripe_contribution rejected (over-budget / not accepting / expired / …). Edge confirm+webhook refund via Stripe; PK = session id so we never double-refund.';

ALTER TABLE public.stripe_contribution_refunds ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.stripe_contribution_refunds FROM PUBLIC;
REVOKE ALL ON TABLE public.stripe_contribution_refunds FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.stripe_contribution_refunds FROM authenticated;
GRANT SELECT ON TABLE public.stripe_contribution_refunds TO authenticated;
GRANT ALL ON TABLE public.stripe_contribution_refunds TO service_role;

DROP POLICY IF EXISTS stripe_contribution_refunds_select_scoped
  ON public.stripe_contribution_refunds;
CREATE POLICY stripe_contribution_refunds_select_scoped
  ON public.stripe_contribution_refunds
  FOR SELECT
  TO authenticated
  USING (
    contributor_id = auth.uid()
    OR public.is_platform_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.missions m
      WHERE m.id = mission_id
        AND (m.creator_id = auth.uid() OR public.is_platform_admin(auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------
-- claim_contribution_reject_refund — insert pending or return existing
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_contribution_reject_refund(
  p_stripe_checkout_session_id text,
  p_mission_id uuid,
  p_contributor_id uuid,
  p_amount_usd integer,
  p_reject_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sid text := trim(coalesce(p_stripe_checkout_session_id, ''));
  v_credited uuid;
  v_row public.stripe_contribution_refunds;
  v_action text;
BEGIN
  IF v_sid = '' THEN
    RAISE EXCEPTION 'Missing Stripe session id';
  END IF;

  -- Never refund a session that already credited the pot.
  SELECT id INTO v_credited
  FROM public.contributions
  WHERE stripe_checkout_session_id = v_sid
  LIMIT 1;

  IF v_credited IS NOT NULL THEN
    RETURN jsonb_build_object(
      'action', 'skip_credited',
      'credited', true,
      'contribution_id', v_credited
    );
  END IF;

  INSERT INTO public.stripe_contribution_refunds (
    stripe_checkout_session_id,
    mission_id,
    contributor_id,
    amount_usd,
    reject_reason,
    status
  )
  VALUES (
    v_sid,
    p_mission_id,
    p_contributor_id,
    greatest(0, floor(coalesce(p_amount_usd, 0))),
    left(coalesce(nullif(btrim(p_reject_reason), ''), 'business_reject'), 500),
    'pending'
  )
  ON CONFLICT (stripe_checkout_session_id) DO NOTHING;

  SELECT * INTO v_row
  FROM public.stripe_contribution_refunds
  WHERE stripe_checkout_session_id = v_sid;

  IF v_row.status IN ('refunded', 'already_refunded') THEN
    v_action := 'already_done';
  ELSIF v_row.status = 'failed' THEN
    v_action := 'retry';
  ELSE
    v_action := 'proceed';
  END IF;

  RETURN jsonb_build_object(
    'action', v_action,
    'status', v_row.status,
    'stripe_refund_id', v_row.stripe_refund_id,
    'stripe_payment_intent_id', v_row.stripe_payment_intent_id,
    'credited', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_contribution_reject_refund(text, uuid, uuid, integer, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_contribution_reject_refund(text, uuid, uuid, integer, text)
  FROM anon;
REVOKE ALL ON FUNCTION public.claim_contribution_reject_refund(text, uuid, uuid, integer, text)
  FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_contribution_reject_refund(text, uuid, uuid, integer, text)
  TO service_role;

COMMENT ON FUNCTION public.claim_contribution_reject_refund(text, uuid, uuid, integer, text) IS
  'Service-role: claim a refund slot for a paid-but-rejected Checkout Session. skip_credited if contributions already has the session. Idempotent on session id.';

-- ---------------------------------------------------------------------------
-- mark_contribution_reject_refund — persist Stripe outcome
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_contribution_reject_refund(
  p_stripe_checkout_session_id text,
  p_status text,
  p_stripe_refund_id text DEFAULT NULL,
  p_stripe_payment_intent_id text DEFAULT NULL,
  p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sid text := trim(coalesce(p_stripe_checkout_session_id, ''));
  v_status text := lower(trim(coalesce(p_status, '')));
  v_row public.stripe_contribution_refunds;
BEGIN
  IF v_sid = '' THEN
    RAISE EXCEPTION 'Missing Stripe session id';
  END IF;

  IF v_status NOT IN ('pending', 'refunded', 'already_refunded', 'failed') THEN
    RAISE EXCEPTION 'Invalid refund status';
  END IF;

  UPDATE public.stripe_contribution_refunds
  SET
    status = v_status,
    stripe_refund_id = COALESCE(
      nullif(btrim(coalesce(p_stripe_refund_id, '')), ''),
      stripe_refund_id
    ),
    stripe_payment_intent_id = COALESCE(
      nullif(btrim(coalesce(p_stripe_payment_intent_id, '')), ''),
      stripe_payment_intent_id
    ),
    error_message = CASE
      WHEN v_status = 'failed' THEN left(coalesce(p_error_message, ''), 500)
      ELSE NULL
    END,
    updated_at = now()
  WHERE stripe_checkout_session_id = v_sid
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refund claim row not found';
  END IF;

  RETURN jsonb_build_object(
    'status', v_row.status,
    'stripe_refund_id', v_row.stripe_refund_id,
    'stripe_payment_intent_id', v_row.stripe_payment_intent_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_contribution_reject_refund(text, text, text, text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_contribution_reject_refund(text, text, text, text, text)
  FROM anon;
REVOKE ALL ON FUNCTION public.mark_contribution_reject_refund(text, text, text, text, text)
  FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_contribution_reject_refund(text, text, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public.mark_contribution_reject_refund(text, text, text, text, text) IS
  'Service-role: record Stripe refund id / failure for a claimed reject-refund row.';

-- ---------------------------------------------------------------------------
-- P1-4 — unpaid convert is the reporter only
-- (body = 20260909_min_work_budget_2_usd.sql + creator_id gate)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convert_report_to_mission(
  p_mission_id uuid,
  p_expected_price integer,
  p_crowdfunding_mode boolean DEFAULT true
)
RETURNS public.missions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mission public.missions;
  v_price integer;
  v_crowd boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_mission
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  IF v_mission.creator_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Only the report creator can convert this pin';
  END IF;

  IF NOT coalesce(v_mission.is_report, false)
     OR lower(coalesce(v_mission.status::text, '')) <> 'reported' THEN
    RAISE EXCEPTION 'Only open report pins can be converted';
  END IF;

  v_price := floor(coalesce(p_expected_price, 0));
  IF v_price < 2 THEN
    RAISE EXCEPTION 'Target budget must be at least 2 USD';
  END IF;

  v_crowd := coalesce(p_crowdfunding_mode, true)
    AND public.is_garbage_removal_service(v_mission.service_type);

  IF v_crowd THEN
    UPDATE public.missions
    SET
      is_report = false,
      crowdfunding_mode = true,
      status = 'funding',
      expected_price = v_price,
      amount_target = v_price,
      current_funding = coalesce(current_funding, 0),
      crowdfunding_expires_at = now() + interval '7 days'
    WHERE id = p_mission_id
    RETURNING * INTO v_mission;
  ELSE
    UPDATE public.missions
    SET
      is_report = false,
      crowdfunding_mode = false,
      status = 'available',
      expected_price = v_price,
      amount_target = v_price,
      crowdfunding_expires_at = NULL
    WHERE id = p_mission_id
    RETURNING * INTO v_mission;
  END IF;

  RETURN v_mission;
END;
$$;

REVOKE ALL ON FUNCTION public.convert_report_to_mission(uuid, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_report_to_mission(uuid, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_report_to_mission(uuid, integer, boolean) TO service_role;

COMMENT ON FUNCTION public.convert_report_to_mission(uuid, integer, boolean) IS
  'Optional unpaid convert — report creator only. Crowd path enters funding at $0 with a 7-day quiet-hide window (P0-1). Neighbors wake the pin with the first Stripe dollar (P0-2 apply_stripe_contribution).';
