-- ============================================================================
-- Drop legacy contributions.amount_egp (NOT NULL) blocking USD-only Stripe inserts.
-- Live DB kept amount_egp AND amount_usd; apply_stripe_contribution only writes amount_usd.
-- ============================================================================

DO $$
BEGIN
  -- Case A: both columns exist → drop legacy EGP (prefer amount_usd).
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contributions'
      AND column_name = 'amount_egp'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contributions'
      AND column_name = 'amount_usd'
  ) THEN
    -- Backfill amount_usd from amount_egp only where USD is missing.
    UPDATE public.contributions
    SET amount_usd = COALESCE(amount_usd, amount_egp, 1)
    WHERE amount_usd IS NULL;

    ALTER TABLE public.contributions DROP COLUMN amount_egp;

  -- Case B: only amount_egp exists → rename to amount_usd.
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contributions'
      AND column_name = 'amount_egp'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contributions'
      AND column_name = 'amount_usd'
  ) THEN
    ALTER TABLE public.contributions RENAME COLUMN amount_egp TO amount_usd;
  END IF;
END $$;

-- Ensure amount_usd is present and constrained.
ALTER TABLE public.contributions
  ADD COLUMN IF NOT EXISTS amount_usd integer;

UPDATE public.contributions
SET amount_usd = COALESCE(amount_usd, 1)
WHERE amount_usd IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contributions'
      AND column_name = 'amount_usd'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE public.contributions
      ALTER COLUMN amount_usd SET NOT NULL;
  END IF;
END $$;

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

COMMENT ON COLUMN public.contributions.amount_usd IS
  'Crowdfunding contribution amount in whole USD. Legacy amount_egp removed.';

-- Reaffirm apply_stripe_contribution writes ONLY amount_usd (no amount_egp).
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
