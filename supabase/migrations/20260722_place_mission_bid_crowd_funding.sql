-- ============================================================================
-- Phase 1.2: Crowd-bidding while crowdfunding status = funding
-- ============================================================================
-- • Workers may place bids on crowdfunding missions during `funding`
--   (not only after target met → `available`).
-- • Crowdfunding bids cost exactly 1 platform token (Hungry-Games stake).
-- • Non-crowdfunding (private) missions: unchanged — bid on available/pending,
--   no token deduction in this RPC.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.place_mission_bid(
  p_mission_id uuid,
  p_bid_amount integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_mission record;
  v_amount integer;
  v_bid_id uuid;
  v_balance integer;
  v_status text;
  v_is_crowd boolean;
  v_token_cost integer := 0;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_amount := floor(coalesce(p_bid_amount, 0));
  IF v_amount < 1 THEN
    RAISE EXCEPTION 'Bid amount must be at least 1 USD';
  END IF;

  SELECT *
  INTO v_mission
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  IF v_mission.creator_id IS NOT DISTINCT FROM uid THEN
    RAISE EXCEPTION 'Cannot bid on your own mission';
  END IF;

  IF v_mission.cleaner_id IS NOT NULL THEN
    RAISE EXCEPTION 'Mission already has an assigned worker';
  END IF;

  v_status := lower(coalesce(v_mission.status::text, ''));
  v_is_crowd := coalesce(v_mission.crowdfunding_mode, false);

  -- Status gate:
  --   private / standard → available | pending
  --   crowdfunding       → funding | available | pending
  IF v_is_crowd THEN
    IF v_status NOT IN ('funding', 'available', 'pending') THEN
      RAISE EXCEPTION 'Mission is not open for crowd-bidding';
    END IF;
    IF v_status = 'funding'
       AND v_mission.crowdfunding_expires_at IS NOT NULL
       AND v_mission.crowdfunding_expires_at < now() THEN
      RAISE EXCEPTION 'Crowdfunding window has expired';
    END IF;
    -- Hungry-Games: 1 token stake on crowdfunding bids.
    v_token_cost := 1;
  ELSE
    IF v_status NOT IN ('available', 'pending') THEN
      RAISE EXCEPTION 'Mission is not open for bidding';
    END IF;
  END IF;

  IF v_token_cost > 0 THEN
    SELECT token_balance
    INTO v_balance
    FROM public.profiles
    WHERE id = uid
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Profile not found';
    END IF;

    IF coalesce(v_balance, 0) < v_token_cost THEN
      RAISE EXCEPTION 'Insufficient tokens: placing a crowdfunding bid costs 1 token';
    END IF;

    UPDATE public.profiles
    SET token_balance = token_balance - v_token_cost
    WHERE id = uid;
  END IF;

  INSERT INTO public.mission_bids (
    mission_id,
    cleaner_id,
    bid_amount,
    status
  )
  VALUES (
    p_mission_id,
    uid,
    v_amount,
    'pending'
  )
  RETURNING id INTO v_bid_id;

  RETURN v_bid_id;
END;
$$;

REVOKE ALL ON FUNCTION public.place_mission_bid(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_mission_bid(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_mission_bid(uuid, integer) TO service_role;

COMMENT ON FUNCTION public.place_mission_bid(uuid, integer) IS
  'Place a pending bid. Crowdfunding (funding/available): deducts 1 token. Private: available/pending only, no token stake.';
