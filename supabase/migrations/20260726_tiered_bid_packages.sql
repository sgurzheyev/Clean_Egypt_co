-- =============================================================================
-- eBay-style tiered bid packages (counter-offers)
-- =============================================================================
-- Workers may attach 1–3 structured offer packages (Basic labor vs All-inclusive).
-- Creators accept a specific package; that package's price becomes the work budget.
-- =============================================================================

ALTER TABLE public.mission_bids
  ADD COLUMN IF NOT EXISTS offer_packages jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.mission_bids
  ADD COLUMN IF NOT EXISTS selected_package_id text;

ALTER TABLE public.mission_bids
  ADD COLUMN IF NOT EXISTS selected_package jsonb;

COMMENT ON COLUMN public.mission_bids.offer_packages IS
  'Tiered counter-offers: [{id,tier,title,description,price,includes_supplies,supply_labels}]';
COMMENT ON COLUMN public.mission_bids.selected_package_id IS
  'Package id chosen by the mission creator on accept.';
COMMENT ON COLUMN public.mission_bids.selected_package IS
  'Snapshot of the accepted package at accept time.';

-- ---------------------------------------------------------------------------
-- place_mission_bid — optional offer packages
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.place_mission_bid(uuid, integer);

CREATE OR REPLACE FUNCTION public.place_mission_bid(
  p_mission_id uuid,
  p_bid_amount integer,
  p_offer_packages jsonb DEFAULT NULL
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
  v_packages jsonb := '[]'::jsonb;
  v_pkg jsonb;
  v_pkg_price integer;
  v_min_price integer := NULL;
  v_count integer := 0;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_amount := floor(coalesce(p_bid_amount, 0));

  -- Normalize optional packages (max 3).
  IF p_offer_packages IS NOT NULL AND jsonb_typeof(p_offer_packages) = 'array' THEN
    FOR v_pkg IN
      SELECT value
      FROM jsonb_array_elements(p_offer_packages)
      LIMIT 3
    LOOP
      v_pkg_price := floor(coalesce((v_pkg ->> 'price')::numeric, 0));
      IF v_pkg_price < 1 THEN
        CONTINUE;
      END IF;
      IF nullif(btrim(coalesce(v_pkg ->> 'title', '')), '') IS NULL THEN
        CONTINUE;
      END IF;
      v_packages := v_packages || jsonb_build_array(
        jsonb_build_object(
          'id', coalesce(nullif(btrim(v_pkg ->> 'id'), ''), gen_random_uuid()::text),
          'tier', coalesce(nullif(btrim(v_pkg ->> 'tier'), ''), 'custom'),
          'title', left(btrim(v_pkg ->> 'title'), 80),
          'description', left(btrim(coalesce(v_pkg ->> 'description', '')), 400),
          'price', v_pkg_price,
          'includes_supplies', coalesce((v_pkg ->> 'includes_supplies')::boolean, false),
          'supply_labels', coalesce(v_pkg -> 'supply_labels', '[]'::jsonb)
        )
      );
      v_count := v_count + 1;
      IF v_min_price IS NULL OR v_pkg_price < v_min_price THEN
        v_min_price := v_pkg_price;
      END IF;
    END LOOP;
  END IF;

  IF v_count > 0 THEN
    -- Primary bid_amount mirrors the cheapest package (listing price).
    v_amount := v_min_price;
  END IF;

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

  IF v_is_crowd THEN
    IF v_status NOT IN ('funding', 'available', 'pending') THEN
      RAISE EXCEPTION 'Mission is not open for crowd-bidding';
    END IF;
    IF v_status = 'funding'
       AND v_mission.crowdfunding_expires_at IS NOT NULL
       AND v_mission.crowdfunding_expires_at < now() THEN
      RAISE EXCEPTION 'Crowdfunding window has expired';
    END IF;
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
    status,
    offer_packages
  )
  VALUES (
    p_mission_id,
    uid,
    v_amount,
    'pending',
    v_packages
  )
  RETURNING id INTO v_bid_id;

  RETURN v_bid_id;
END;
$$;

REVOKE ALL ON FUNCTION public.place_mission_bid(uuid, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_mission_bid(uuid, integer, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.place_mission_bid(uuid, integer, jsonb) IS
  'Place a pending bid with optional tiered offer_packages (JSONB). Crowdfunding deducts 1 token.';

-- ---------------------------------------------------------------------------
-- accept_mission_bid — optional package selection
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.accept_mission_bid(uuid);

CREATE OR REPLACE FUNCTION public.accept_mission_bid(
  p_bid_id uuid,
  p_package_id text DEFAULT NULL
)
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
  v_pkg jsonb;
  v_pkg_id text := nullif(btrim(coalesce(p_package_id, '')), '');
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
  IF v_status NOT IN ('available', 'pending', 'open', 'funding') THEN
    RAISE EXCEPTION 'Mission cannot accept bids in current status';
  END IF;

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
  v_pkg := NULL;

  IF v_pkg_id IS NOT NULL
     AND v_bid.offer_packages IS NOT NULL
     AND jsonb_typeof(v_bid.offer_packages) = 'array' THEN
    SELECT elem
    INTO v_pkg
    FROM jsonb_array_elements(v_bid.offer_packages) AS elem
    WHERE elem ->> 'id' = v_pkg_id
    LIMIT 1;

    IF v_pkg IS NULL THEN
      RAISE EXCEPTION 'Selected offer package not found on this bid';
    END IF;

    v_budget := greatest(1, floor(coalesce((v_pkg ->> 'price')::numeric, 0)));
  ELSIF v_bid.offer_packages IS NOT NULL
        AND jsonb_typeof(v_bid.offer_packages) = 'array'
        AND jsonb_array_length(v_bid.offer_packages) > 0
        AND v_pkg_id IS NULL THEN
    -- Multi-package bids require an explicit package choice.
    IF jsonb_array_length(v_bid.offer_packages) > 1 THEN
      RAISE EXCEPTION 'Select which offer package to accept';
    END IF;
    v_pkg := v_bid.offer_packages -> 0;
    v_pkg_id := v_pkg ->> 'id';
    v_budget := greatest(1, floor(coalesce((v_pkg ->> 'price')::numeric, v_budget)));
  END IF;

  v_raised := greatest(0, floor(coalesce(v_mission.current_funding, 0)::numeric)::integer);
  v_target := v_budget;

  UPDATE public.mission_bids
  SET
    status = 'accepted',
    bid_amount = v_budget,
    selected_package_id = v_pkg_id,
    selected_package = v_pkg
  WHERE id = p_bid_id;

  UPDATE public.mission_bids
  SET status = 'rejected'
  WHERE mission_id = v_bid.mission_id
    AND id <> p_bid_id
    AND lower(coalesce(status::text, '')) = 'pending';

  IF v_status = 'funding' AND v_raised < v_budget THEN
    v_new_status := 'funding';
    UPDATE public.missions
    SET
      cleaner_id = v_bid.cleaner_id,
      expected_price = v_target,
      amount_target = v_target,
      status = 'funding'
    WHERE id = v_bid.mission_id;
  ELSE
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

REVOKE ALL ON FUNCTION public.accept_mission_bid(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_mission_bid(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.accept_mission_bid(uuid, text) IS
  'Creator accepts a pending bid; optional p_package_id selects a tiered counter-offer package.';
