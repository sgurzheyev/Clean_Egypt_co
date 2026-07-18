-- Stripe Checkout idempotency for crowdfunding contributions (USD).

-- Rename legacy column if an earlier draft migration created amount_egp.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contributions'
      AND column_name = 'amount_egp'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contributions'
      AND column_name = 'amount_usd'
  ) THEN
    ALTER TABLE public.contributions RENAME COLUMN amount_egp TO amount_usd;
  END IF;
END $$;

ALTER TABLE public.contributions
  ADD COLUMN IF NOT EXISTS amount_usd integer;

-- Ensure NOT NULL + check once column exists (fresh or renamed).
UPDATE public.contributions
SET amount_usd = COALESCE(amount_usd, 1)
WHERE amount_usd IS NULL;

ALTER TABLE public.contributions
  ALTER COLUMN amount_usd SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contributions_amount_usd_check'
  ) THEN
    ALTER TABLE public.contributions
      ADD CONSTRAINT contributions_amount_usd_check CHECK (amount_usd > 0);
  END IF;
END $$;

ALTER TABLE public.contributions
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contributions_stripe_session
  ON public.contributions(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

-- Drop old EGP-named signature if it was already created.
DROP FUNCTION IF EXISTS public.apply_stripe_contribution(uuid, uuid, integer, text);
DROP FUNCTION IF EXISTS public.contribute_to_mission(uuid, integer);

-- Recreate contribute_to_mission with USD param name (same arity).
CREATE OR REPLACE FUNCTION public.contribute_to_mission(
  p_mission_id uuid,
  p_amount_usd integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mission record;
  v_amount integer;
  v_new_funding integer;
  v_target integer;
  v_opened boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_amount := floor(coalesce(p_amount_usd, 0));
  IF v_amount < 1 THEN
    RAISE EXCEPTION 'Contribution must be at least 1 USD';
  END IF;

  SELECT *
  INTO v_mission
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  IF NOT coalesce(v_mission.crowdfunding_mode, false) THEN
    RAISE EXCEPTION 'This mission is direct-payment only — use bidding instead';
  END IF;

  IF NOT public.is_garbage_removal_service(v_mission.service_type) THEN
    RAISE EXCEPTION 'Crowdfunding contributions are only for Garbage Removal';
  END IF;

  IF lower(coalesce(v_mission.status::text, '')) <> 'funding' THEN
    RAISE EXCEPTION 'Mission is not accepting contributions';
  END IF;

  IF v_mission.crowdfunding_expires_at IS NOT NULL
     AND v_mission.crowdfunding_expires_at < now() THEN
    RAISE EXCEPTION 'Crowdfunding window has expired';
  END IF;

  INSERT INTO public.contributions (mission_id, contributor_id, amount_usd)
  VALUES (p_mission_id, v_uid, v_amount);

  v_new_funding := coalesce(v_mission.current_funding, 0) + v_amount;
  v_target := coalesce(v_mission.expected_price, 0);

  IF v_target > 0 AND v_new_funding >= v_target THEN
    UPDATE public.missions
    SET
      current_funding = v_new_funding,
      status = 'available'
    WHERE id = p_mission_id;
    v_opened := true;
  ELSE
    UPDATE public.missions
    SET current_funding = v_new_funding
    WHERE id = p_mission_id;
  END IF;

  RETURN jsonb_build_object(
    'mission_id', p_mission_id,
    'amount_usd', v_amount,
    'current_funding', v_new_funding,
    'target_budget', v_target,
    'opened_for_bidding', v_opened
  );
END;
$$;

REVOKE ALL ON FUNCTION public.contribute_to_mission(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contribute_to_mission(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contribute_to_mission(uuid, integer) TO service_role;

-- Service-role only: apply a verified Stripe contribution (idempotent on session id).
CREATE OR REPLACE FUNCTION public.apply_stripe_contribution(
  p_mission_id uuid,
  p_contributor_id uuid,
  p_amount_usd integer,
  p_stripe_checkout_session_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mission record;
  v_amount integer;
  v_new_funding integer;
  v_target integer;
  v_opened boolean := false;
  v_existing uuid;
BEGIN
  IF coalesce((auth.jwt() ->> 'role'), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role only';
  END IF;

  IF p_stripe_checkout_session_id IS NULL OR length(trim(p_stripe_checkout_session_id)) = 0 THEN
    RAISE EXCEPTION 'Missing Stripe session id';
  END IF;

  SELECT id INTO v_existing
  FROM public.contributions
  WHERE stripe_checkout_session_id = p_stripe_checkout_session_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    SELECT *
    INTO v_mission
    FROM public.missions
    WHERE id = p_mission_id;

    RETURN jsonb_build_object(
      'mission_id', p_mission_id,
      'amount_usd', p_amount_usd,
      'current_funding', coalesce(v_mission.current_funding, 0),
      'target_budget', coalesce(v_mission.expected_price, 0),
      'opened_for_bidding', lower(coalesce(v_mission.status::text, '')) = 'available',
      'idempotent', true
    );
  END IF;

  v_amount := floor(coalesce(p_amount_usd, 0));
  IF v_amount < 1 THEN
    RAISE EXCEPTION 'Contribution must be at least 1 USD';
  END IF;

  SELECT *
  INTO v_mission
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  IF NOT coalesce(v_mission.crowdfunding_mode, false) THEN
    RAISE EXCEPTION 'This mission is direct-payment only';
  END IF;

  IF NOT public.is_garbage_removal_service(v_mission.service_type) THEN
    RAISE EXCEPTION 'Crowdfunding contributions are only for Garbage Removal';
  END IF;

  IF lower(coalesce(v_mission.status::text, '')) NOT IN ('funding', 'available') THEN
    RAISE EXCEPTION 'Mission is not accepting contributions';
  END IF;

  INSERT INTO public.contributions (
    mission_id,
    contributor_id,
    amount_usd,
    stripe_checkout_session_id
  )
  VALUES (
    p_mission_id,
    p_contributor_id,
    v_amount,
    p_stripe_checkout_session_id
  );

  v_new_funding := coalesce(v_mission.current_funding, 0) + v_amount;
  v_target := coalesce(v_mission.expected_price, 0);

  IF v_target > 0 AND v_new_funding >= v_target THEN
    UPDATE public.missions
    SET
      current_funding = v_new_funding,
      status = 'available'
    WHERE id = p_mission_id;
    v_opened := true;
  ELSE
    UPDATE public.missions
    SET current_funding = v_new_funding
    WHERE id = p_mission_id;
  END IF;

  RETURN jsonb_build_object(
    'mission_id', p_mission_id,
    'amount_usd', v_amount,
    'current_funding', v_new_funding,
    'target_budget', v_target,
    'opened_for_bidding', v_opened,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_stripe_contribution(uuid, uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_stripe_contribution(uuid, uuid, integer, text) TO service_role;
