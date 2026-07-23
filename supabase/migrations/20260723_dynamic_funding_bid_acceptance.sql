-- ============================================================================
-- Dynamic crowdfunding goal on bid acceptance during funding
-- ============================================================================
-- • Allow accept_mission_bid while status is funding (plus available/pending/open).
-- • Lock expected_price to the accepted market bid (bump when bid > current target).
-- • If raised >= bid → assign cleaner and start work (in_progress).
-- • If raised < bid → assign cleaner, keep status=funding so community can top up.
-- • When Stripe fills the bumped target and a cleaner is already assigned → in_progress
--   (not available / re-open bidding).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.accept_mission_bid(p_bid_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_bid record;
  v_mission record;
  v_cat text;
  v_verified boolean;
  v_budget integer;
  v_status text;
  v_raised integer;
  v_target integer;
  v_new_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT *
  INTO v_bid
  FROM public.mission_bids
  WHERE id = p_bid_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bid not found';
  END IF;

  IF lower(coalesce(v_bid.status::text, '')) <> 'pending' THEN
    RAISE EXCEPTION 'Bid is not pending';
  END IF;

  SELECT *
  INTO v_mission
  FROM public.missions
  WHERE id = v_bid.mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  IF v_mission.creator_id IS NULL OR v_mission.creator_id <> v_uid THEN
    RAISE EXCEPTION 'Only the mission creator can accept bids';
  END IF;

  IF v_mission.cleaner_id IS NOT NULL THEN
    RAISE EXCEPTION 'Mission already assigned';
  END IF;

  v_status := lower(coalesce(v_mission.status::text, ''));
  -- Marketplace open + active crowdfunding campaigns (dynamic market price).
  IF v_status NOT IN ('available', 'pending', 'open', 'funding') THEN
    RAISE EXCEPTION 'Mission cannot accept bids in current status';
  END IF;

  -- Crowdfunding expiry: do not lock a worker onto an expired underfunded campaign.
  IF v_status = 'funding'
     AND v_mission.crowdfunding_expires_at IS NOT NULL
     AND v_mission.crowdfunding_expires_at < now() THEN
    RAISE EXCEPTION 'Crowdfunding window has expired';
  END IF;

  v_cat := lower(coalesce(v_mission.category::text, ''));
  IF v_cat IN ('home', 'office') THEN
    SELECT coalesce(p.is_verified, false)
    INTO v_verified
    FROM public.profiles p
    WHERE p.id = v_bid.cleaner_id;

    IF NOT coalesce(v_verified, false) THEN
      RAISE EXCEPTION 'ID verification required for home missions';
    END IF;
  END IF;

  v_budget := greatest(1, floor(coalesce(v_bid.bid_amount, 0)::numeric)::integer);
  v_raised := greatest(0, floor(coalesce(v_mission.current_funding, 0)::numeric)::integer);
  v_target := greatest(0, floor(coalesce(v_mission.expected_price, 0)::numeric)::integer);

  -- Market price becomes the campaign / work target (bumps when bid > current goal).
  IF v_budget > v_target THEN
    v_target := v_budget;
  ELSE
    -- Still lock expected_price to the accepted bid for non-crowdfund / fully funded paths.
    v_target := v_budget;
  END IF;

  UPDATE public.mission_bids
  SET status = 'accepted'
  WHERE id = p_bid_id;

  UPDATE public.mission_bids
  SET status = 'rejected'
  WHERE mission_id = v_bid.mission_id
    AND id <> p_bid_id
    AND lower(coalesce(status::text, '')) = 'pending';

  IF v_status = 'funding' AND v_raised < v_budget THEN
    -- Pre-select worker; community still funds the remaining gap.
    v_new_status := 'funding';
    UPDATE public.missions
    SET
      cleaner_id = v_bid.cleaner_id,
      expected_price = v_target,
      amount_target = v_target,
      status = 'funding'
    WHERE id = v_bid.mission_id;
  ELSE
    -- Funds cover the accepted bid (or non-funding open mission) → start work.
    v_new_status := 'in_progress';
    UPDATE public.missions
    SET
      cleaner_id = v_bid.cleaner_id,
      expected_price = v_target,
      amount_target = v_target,
      status = 'in_progress',
      started_at = coalesce(started_at, now())
    WHERE id = v_bid.mission_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_mission_bid(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_mission_bid(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_mission_bid(uuid) TO service_role;

COMMENT ON FUNCTION public.accept_mission_bid(uuid) IS
  'Creator accepts a pending bid. During funding: bumps expected_price to bid; if raised < bid keeps funding with cleaner locked, else starts in_progress.';

-- ---------------------------------------------------------------------------
-- When remaining funds arrive and a cleaner is already locked → start work
-- ---------------------------------------------------------------------------
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
  v_remaining integer;
  v_opened boolean := false;
  v_started boolean := false;
  v_existing uuid;
BEGIN
  IF p_stripe_checkout_session_id IS NULL OR length(trim(p_stripe_checkout_session_id)) = 0 THEN
    RAISE EXCEPTION 'Missing Stripe session id';
  END IF;

  -- Idempotency: same Stripe session never double-credits.
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
      'started_work', lower(coalesce(v_mission.status::text, '')) = 'in_progress',
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

  -- Only open funding campaigns accept new money (not already-available).
  IF lower(coalesce(v_mission.status::text, '')) <> 'funding' THEN
    RAISE EXCEPTION 'Mission is not accepting contributions';
  END IF;

  IF v_mission.crowdfunding_expires_at IS NOT NULL
     AND v_mission.crowdfunding_expires_at < now() THEN
    RAISE EXCEPTION 'Crowdfunding window has expired';
  END IF;

  v_target := coalesce(v_mission.expected_price, 0);
  IF v_target < 1 THEN
    RAISE EXCEPTION 'Campaign target budget is invalid';
  END IF;

  v_remaining := greatest(0, v_target - coalesce(v_mission.current_funding, 0));
  IF v_remaining < 1 THEN
    RAISE EXCEPTION 'Campaign already funded';
  END IF;

  -- Reject oversubscription so Stripe ops can refund; do not silently credit excess.
  IF v_amount > v_remaining THEN
    RAISE EXCEPTION 'Contribution exceeds remaining budget (% USD left)', v_remaining;
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

  IF v_new_funding >= v_target THEN
    IF v_mission.cleaner_id IS NOT NULL THEN
      -- Worker was pre-selected during funding → start the job immediately.
      UPDATE public.missions
      SET
        current_funding = v_new_funding,
        status = 'in_progress',
        started_at = coalesce(started_at, now())
      WHERE id = p_mission_id;
      v_started := true;
    ELSE
      UPDATE public.missions
      SET
        current_funding = v_new_funding,
        status = 'available'
      WHERE id = p_mission_id;
      v_opened := true;
    END IF;
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
    'started_work', v_started,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_stripe_contribution(uuid, uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_stripe_contribution(uuid, uuid, integer, text) TO service_role;

COMMENT ON FUNCTION public.apply_stripe_contribution(uuid, uuid, integer, text) IS
  'Credits Stripe contribution. On target met: in_progress if cleaner pre-assigned, else available for bidding.';
