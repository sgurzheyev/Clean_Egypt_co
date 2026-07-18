-- Server-side USD→EGP for Stripe wallet top-ups (never trust client EGP credit).
-- Also replaces insecure client-callable top_up_wallet with admin-only RPC.

-- ---------------------------------------------------------------------------
-- Public read helper (used by SQL and optionally by PostgREST).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_usd_to_egp_rate()
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  r numeric;
BEGIN
  SELECT usd_to_egp_rate INTO r FROM public.platform_settings WHERE id = 1;
  IF r IS NULL OR r <= 0 OR r > 1000 THEN
    RETURN 55::numeric;
  END IF;
  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION public.get_usd_to_egp_rate() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_usd_to_egp_rate() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_usd_to_egp_rate() IS 'Live USD→EGP from platform_settings (id=1), fallback 55.';

-- Buffer must match constants.ts CURRENCY_RISK_BUFFER_FACTOR (0.97).
-- ---------------------------------------------------------------------------
-- Stripe wallet credit: called only by Edge Function (service_role).
-- Computes EGP = floor(usd_charged * rate * 0.97); idempotent per PaymentIntent id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_wallet_topup_stripe(
  p_user_id uuid,
  p_usd_charged numeric,
  p_payment_intent_id text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate numeric;
  v_egp bigint;
  v_existing integer;
  v_ref text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid user';
  END IF;
  IF p_payment_intent_id IS NULL OR length(trim(p_payment_intent_id)) < 3 THEN
    RAISE EXCEPTION 'Invalid payment intent';
  END IF;
  IF p_usd_charged IS NULL OR p_usd_charged <= 0 OR p_usd_charged > 500000 THEN
    RAISE EXCEPTION 'Invalid USD amount';
  END IF;

  v_ref := 'stripe_pi:' || trim(p_payment_intent_id);

  SELECT t.amount::integer INTO v_existing
  FROM public.transactions t
  WHERE t.user_id = p_user_id
    AND t.type = 'wallet_topup'
    AND t.gateway = 'stripe'
    AND t.payout_details = v_ref
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_rate := public.get_usd_to_egp_rate();
  v_egp := floor(p_usd_charged * v_rate * 0.97)::bigint;

  IF v_egp <= 0 THEN
    RAISE EXCEPTION 'Computed credit is zero';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  UPDATE public.profiles
  SET wallet_balance = coalesce(wallet_balance, 0) + v_egp
  WHERE id = p_user_id;

  INSERT INTO public.transactions (
    user_id,
    mission_id,
    amount,
    type,
    gateway,
    payout_details
  )
  VALUES (
    p_user_id,
    NULL,
    v_egp,
    'wallet_topup',
    'stripe',
    v_ref
  );

  RETURN v_egp::integer;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_wallet_topup_stripe(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_wallet_topup_stripe(uuid, numeric, text) TO service_role;

COMMENT ON FUNCTION public.credit_wallet_topup_stripe IS 'Edge Function only: credit EGP from verified Stripe USD × DB rate × 0.97.';

-- ---------------------------------------------------------------------------
-- Admin-only manual EGP credit (replaces insecure top_up_wallet for Profile admin UI).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_credit_wallet_egp(p_amount bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_tg text;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 100000000 THEN
    RAISE EXCEPTION 'Invalid amount';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  SELECT lower(coalesce(telegram_username, '')) INTO v_tg FROM public.profiles WHERE id = auth.uid();

  IF NOT (
    v_email = 'sgurzheyev@gmail.com'
    OR v_email ILIKE '%tg_6618910143%'
    OR v_tg = 'sergiogurgini'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.profiles
  SET wallet_balance = coalesce(wallet_balance, 0) + p_amount
  WHERE id = auth.uid();

  INSERT INTO public.transactions (user_id, mission_id, amount, type, gateway, payout_details)
  VALUES (auth.uid(), NULL, p_amount, 'wallet_topup', 'admin_manual', 'admin_credit_wallet_egp');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_credit_wallet_egp(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_credit_wallet_egp(bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- Remove legacy client-trusted top_up_wallet (if present).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.top_up_wallet(integer);
DROP FUNCTION IF EXISTS public.top_up_wallet(bigint);
DROP FUNCTION IF EXISTS public.top_up_wallet(numeric);
