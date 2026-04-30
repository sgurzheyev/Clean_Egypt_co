-- Gurgini Financial Engine: Tokens + SaaS Subscriptions (profiles columns + secure RPCs)

-- 1) Profiles schema
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS token_balance integer NOT NULL DEFAULT 0 CHECK (token_balance >= 0);

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz NULL;

-- 2) Missions schema for lead-gen (safe no-op if already exists)
ALTER TABLE public.missions
ADD COLUMN IF NOT EXISTS service_type text NULL;

ALTER TABLE public.missions
ADD COLUMN IF NOT EXISTS pin_fee_egp integer NULL;

ALTER TABLE public.missions
ADD COLUMN IF NOT EXISTS building_id text NULL;

ALTER TABLE public.missions
ADD COLUMN IF NOT EXISTS building_height_m double precision NULL;

-- 3) Deduct exactly 1 token (customer pin placement)
CREATE OR REPLACE FUNCTION public.deduct_one_token()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_balance integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT token_balance
  INTO v_balance
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF coalesce(v_balance, 0) < 1 THEN
    RAISE EXCEPTION 'Insufficient tokens';
  END IF;

  UPDATE public.profiles
  SET token_balance = token_balance - 1
  WHERE id = v_uid;

  RETURN v_balance - 1;
END;
$$;

REVOKE ALL ON FUNCTION public.deduct_one_token() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deduct_one_token() TO authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_one_token() TO service_role;

-- 4) Create lead mission + atomically deduct 1 token (prevents frontend cheating)
CREATE OR REPLACE FUNCTION public.create_lead_mission_with_token(
  p_service_type text,
  p_location_lat double precision,
  p_location_lng double precision,
  p_description text,
  p_photo_urls text[],
  p_building_id text DEFAULT NULL,
  p_building_height_m double precision DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_balance integer;
  v_mid uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_service_type IS NULL OR length(trim(p_service_type)) = 0 THEN
    RAISE EXCEPTION 'Missing service_type';
  END IF;

  -- Lock profile row and deduct token
  SELECT token_balance
  INTO v_balance
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF coalesce(v_balance, 0) < 1 THEN
    RAISE EXCEPTION 'Insufficient tokens';
  END IF;

  UPDATE public.profiles
  SET token_balance = token_balance - 1
  WHERE id = v_uid;

  INSERT INTO public.missions (
    creator_id,
    status,
    service_type,
    pin_fee_egp,
    location_lat,
    location_lng,
    description,
    photo_urls,
    building_id,
    building_height_m
  )
  VALUES (
    v_uid,
    'available',
    p_service_type,
    NULL,
    p_location_lat,
    p_location_lng,
    NULLIF(trim(coalesce(p_description, '')), ''),
    coalesce(p_photo_urls, array[]::text[]),
    NULLIF(trim(coalesce(p_building_id, '')), ''),
    p_building_height_m
  )
  RETURNING id INTO v_mid;

  RETURN v_mid;
END;
$$;

REVOKE ALL ON FUNCTION public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision
) TO service_role;

-- 5) Service-role only: credit tokens after Stripe payment
-- NOTE: This is called from a backend/edge function after verifying Stripe payment intent.
CREATE TABLE IF NOT EXISTS public.token_purchases (
  payment_intent_id text PRIMARY KEY,
  user_id uuid NOT NULL,
  tokens integer NOT NULL CHECK (tokens > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.credit_tokens_service_role(
  p_user_id uuid,
  p_tokens integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing user_id';
  END IF;
  IF p_tokens IS NULL OR p_tokens <= 0 OR p_tokens > 100000 THEN
    RAISE EXCEPTION 'Invalid token amount';
  END IF;

  UPDATE public.profiles
  SET token_balance = greatest(0, coalesce(token_balance, 0)) + p_tokens
  WHERE id = p_user_id
  RETURNING token_balance INTO v_next;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  RETURN v_next;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_tokens_service_role(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_tokens_service_role(uuid, integer) TO service_role;

-- Idempotent credit via Stripe payment_intent_id (recommended entrypoint).
CREATE OR REPLACE FUNCTION public.credit_tokens_from_payment_service_role(
  p_user_id uuid,
  p_payment_intent_id text,
  p_tokens integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing user_id';
  END IF;
  IF p_payment_intent_id IS NULL OR length(trim(p_payment_intent_id)) = 0 THEN
    RAISE EXCEPTION 'Missing payment_intent_id';
  END IF;
  IF p_tokens IS NULL OR p_tokens <= 0 OR p_tokens > 100000 THEN
    RAISE EXCEPTION 'Invalid token amount';
  END IF;

  INSERT INTO public.token_purchases(payment_intent_id, user_id, tokens)
  VALUES (trim(p_payment_intent_id), p_user_id, p_tokens)
  ON CONFLICT (payment_intent_id) DO NOTHING;

  IF NOT FOUND THEN
    -- already credited
    SELECT token_balance INTO v_next FROM public.profiles WHERE id = p_user_id;
    RETURN coalesce(v_next, 0);
  END IF;

  RETURN public.credit_tokens_service_role(p_user_id, p_tokens);
END;
$$;

REVOKE ALL ON FUNCTION public.credit_tokens_from_payment_service_role(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_tokens_from_payment_service_role(uuid, text, integer) TO service_role;

-- 6) Service-role only: activate/extend subscription after Stripe payment
CREATE TABLE IF NOT EXISTS public.subscription_purchases (
  payment_intent_id text PRIMARY KEY,
  user_id uuid NOT NULL,
  months integer NOT NULL CHECK (months > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.activate_subscription_service_role(
  p_user_id uuid,
  p_months integer
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base timestamptz;
  v_next timestamptz;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing user_id';
  END IF;
  IF p_months IS NULL OR p_months <= 0 OR p_months > 120 THEN
    RAISE EXCEPTION 'Invalid months';
  END IF;

  SELECT subscription_expires_at
  INTO v_base
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  v_base := greatest(coalesce(v_base, now()), now());
  v_next := v_base + make_interval(months => p_months);

  UPDATE public.profiles
  SET subscription_expires_at = v_next
  WHERE id = p_user_id;

  RETURN v_next;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_subscription_service_role(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_subscription_service_role(uuid, integer) TO service_role;

-- Idempotent activation via Stripe payment_intent_id (recommended entrypoint).
CREATE OR REPLACE FUNCTION public.activate_subscription_from_payment_service_role(
  p_user_id uuid,
  p_payment_intent_id text,
  p_months integer
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next timestamptz;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing user_id';
  END IF;
  IF p_payment_intent_id IS NULL OR length(trim(p_payment_intent_id)) = 0 THEN
    RAISE EXCEPTION 'Missing payment_intent_id';
  END IF;
  IF p_months IS NULL OR p_months <= 0 OR p_months > 120 THEN
    RAISE EXCEPTION 'Invalid months';
  END IF;

  INSERT INTO public.subscription_purchases(payment_intent_id, user_id, months)
  VALUES (trim(p_payment_intent_id), p_user_id, p_months)
  ON CONFLICT (payment_intent_id) DO NOTHING;

  IF NOT FOUND THEN
    SELECT subscription_expires_at INTO v_next FROM public.profiles WHERE id = p_user_id;
    RETURN v_next;
  END IF;

  RETURN public.activate_subscription_service_role(p_user_id, p_months);
END;
$$;

REVOKE ALL ON FUNCTION public.activate_subscription_from_payment_service_role(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_subscription_from_payment_service_role(uuid, text, integer) TO service_role;

