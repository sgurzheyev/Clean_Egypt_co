-- USD-only economy: rename EGP columns/RPCs and remove FX from wallet top-ups.
-- Safe on fresh installs (pin_fee_usd already created) and existing DBs (renames pin_fee_egp).

-- 1) missions.pin_fee_egp → pin_fee_usd
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'missions' AND column_name = 'pin_fee_egp'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'missions' AND column_name = 'pin_fee_usd'
  ) THEN
    ALTER TABLE public.missions RENAME COLUMN pin_fee_egp TO pin_fee_usd;
  END IF;
END $$;

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS pin_fee_usd integer NULL;

COMMENT ON COLUMN public.missions.pin_fee_usd IS
  'Scout / pin fee charged in USD (or NULL when token-bid model applies).';

COMMENT ON COLUMN public.missions.expected_price IS
  'Client-offered work budget in USD (what the worker earns). amount_target stores token bid for listing rank.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'missions' AND column_name = 'current_funding'
  ) THEN
    EXECUTE $c$
      COMMENT ON COLUMN public.missions.current_funding IS
        'Crowdfunding raised so far in USD (sum of contributions.amount_usd).'
    $c$;
  END IF;
END $$;

-- 2) Wallet top-up: credit USD with 0.97 buffer only (no FX rate)
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
  v_usd bigint;
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

  v_usd := floor(p_usd_charged * 0.97)::bigint;

  IF v_usd <= 0 THEN
    RAISE EXCEPTION 'Computed credit is zero';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  UPDATE public.profiles
  SET wallet_balance = coalesce(wallet_balance, 0) + v_usd
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
    v_usd,
    'wallet_topup',
    'stripe',
    v_ref
  );

  RETURN v_usd::integer;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_wallet_topup_stripe(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_wallet_topup_stripe(uuid, numeric, text) TO service_role;

COMMENT ON FUNCTION public.credit_wallet_topup_stripe IS
  'Edge Function only: credit USD from verified Stripe charge × 0.97 (no FX).';

-- 3) Admin credit in USD (same auth gate as prior admin_credit_wallet_egp)
CREATE OR REPLACE FUNCTION public.admin_credit_wallet_usd(p_amount bigint)
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
  VALUES (auth.uid(), NULL, p_amount, 'wallet_topup', 'admin_manual', 'admin_credit_wallet_usd');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_credit_wallet_usd(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_credit_wallet_usd(bigint) TO authenticated;

-- Compatibility: drop old EGP-named admin credit (callers must use admin_credit_wallet_usd)
DROP FUNCTION IF EXISTS public.admin_credit_wallet_egp(bigint);

-- Retire FX rate helpers
DROP FUNCTION IF EXISTS public.get_usd_to_egp_rate();
DROP FUNCTION IF EXISTS public.set_usd_to_egp_rate(numeric);