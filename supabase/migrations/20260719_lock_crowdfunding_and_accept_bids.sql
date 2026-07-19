-- ============================================================================
-- Lock crowdfunding money path + tighten accept_mission_bid status gate
-- ----------------------------------------------------------------------------
-- P0: authenticated users must not call contribute_to_mission (that bypasses
--     Stripe and can flip funding → available for free).
-- P0: drop client INSERT on contributions; only service-role RPCs write rows.
-- P1: accept_mission_bid only on open marketplace statuses (available/pending).
-- ============================================================================

-- 1) Revoke free crowdfunding RPC from clients
REVOKE ALL ON FUNCTION public.contribute_to_mission(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contribute_to_mission(uuid, integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.contribute_to_mission(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.contribute_to_mission(uuid, integer) TO service_role;

COMMENT ON FUNCTION public.contribute_to_mission(uuid, integer) IS
  'Service-role / internal only. Clients must use Stripe Checkout → apply_stripe_contribution.';

-- 2) Prevent authenticated client inserts into contributions
DROP POLICY IF EXISTS contributions_insert_own ON public.contributions;

-- 3) Tighten accept_mission_bid: only open-for-bidding statuses
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
  -- Open marketplace only. Explicitly reject funding / expired / review / etc.
  IF v_status NOT IN ('available', 'pending') THEN
    RAISE EXCEPTION 'Mission cannot accept bids in current status';
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

  UPDATE public.mission_bids
  SET status = 'accepted'
  WHERE id = p_bid_id;

  UPDATE public.mission_bids
  SET status = 'rejected'
  WHERE mission_id = v_bid.mission_id
    AND id <> p_bid_id
    AND lower(coalesce(status::text, '')) = 'pending';

  UPDATE public.missions
  SET
    cleaner_id = v_bid.cleaner_id,
    expected_price = v_budget,
    status = 'in_progress',
    started_at = coalesce(started_at, now())
  WHERE id = v_bid.mission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_mission_bid(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_mission_bid(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_mission_bid(uuid) TO service_role;
