-- ============================================================================
-- Wave G — Lifecycle & State Machine Hardening (LIFE-1, LIFE-2, LIFE-3)
-- ----------------------------------------------------------------------------
-- LIFE-1: Accept bid on fully-raised available crowd pin → in_progress even if
--   bid > raised.
--   Fix: accept_mission_bid now gates strictly on crowdfunding_mode AND raised < budget
--   (ignoring whether the prior status string was 'funding' or 'available').
--   When underfunded, it forces status = 'funding' with expected_price = bid_amount.
--
-- LIFE-2: reject_mission_bid was only in migrations/archive/.
--   Fix: Promote canonical reject_mission_bid RPC to active migration with
--   proper SECURITY DEFINER and creator authentication checks.
--
-- LIFE-3: Expiry leaves cleaner_id on expired underfunded pot (worker stranded).
--   Fix: process_expired_crowdfunding_missions() now sets cleaner_id = NULL
--   and marks bids rejected when transitioning to expired or hidden.
--   Also backfills/unlocks any currently stranded cleaners on expired rows.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) LIFE-1: accept_mission_bid — handle available crowd pin with bid > raised
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_mission_bid(
  p_bid_id uuid,
  p_package_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  v_is_crowd boolean;
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
  v_is_crowd := coalesce(v_mission.crowdfunding_mode, false);

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

  -- LIFE-1: Gate strictly on crowdfunding_mode AND raised < budget
  -- If underfunded, stays or re-enters 'funding' regardless of previous status
  IF v_is_crowd AND v_raised < v_budget THEN
    v_new_status := 'funding';
    UPDATE public.missions
    SET
      cleaner_id = v_bid.cleaner_id,
      expected_price = v_target,
      status = 'funding'
    WHERE id = v_bid.mission_id;
  ELSE
    v_new_status := 'in_progress';
    UPDATE public.missions
    SET
      cleaner_id = v_bid.cleaner_id,
      expected_price = v_target,
      status = 'in_progress',
      started_at = coalesce(started_at, now())
    WHERE id = v_bid.mission_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_mission_bid(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_mission_bid(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.accept_mission_bid(uuid, text) IS
  'Wave G (LIFE-1): Creator accepts pending bid. If crowdfunding_mode AND raised < accepted_bid, sets status=funding with expected_price=bid. Enters in_progress only when fully funded or P2P.';

-- ---------------------------------------------------------------------------
-- 2) LIFE-2: reject_mission_bid — promoted from archive to active migrations
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_mission_bid(p_bid_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_bid record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT b.*, m.creator_id
  INTO v_bid
  FROM public.mission_bids b
  JOIN public.missions m ON m.id = b.mission_id
  WHERE b.id = p_bid_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bid not found';
  END IF;

  IF v_bid.creator_id IS NULL OR v_bid.creator_id <> v_uid THEN
    RAISE EXCEPTION 'Only the mission creator can decline bids';
  END IF;

  IF lower(coalesce(v_bid.status::text, '')) <> 'pending' THEN
    RAISE EXCEPTION 'Bid is not pending';
  END IF;

  UPDATE public.mission_bids
  SET status = 'rejected'
  WHERE id = p_bid_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_mission_bid(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_mission_bid(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.reject_mission_bid(uuid) IS
  'Wave G (LIFE-2): Creator declines a pending bid. Active migration promotion.';

-- ---------------------------------------------------------------------------
-- 3) LIFE-3: process_expired_crowdfunding_missions — unlock cleaner on expiry
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_expired_crowdfunding_missions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
  v_expires timestamptz;
  v_updated integer;
  v_raised integer;
  v_target integer;
BEGIN
  FOR v_row IN
    SELECT m.*
    FROM public.missions m
    WHERE COALESCE(
            m.crowdfunding_expires_at,
            m.created_at + interval '7 days',
            now() - interval '1 second'
          ) < now()
      AND (
        -- Aged free civic pins that never took a dollar.
        (
          lower(coalesce(m.status::text, '')) = 'reported'
          AND coalesce(m.current_funding, 0) = 0
        )
        OR
        -- Live campaigns past the window and still under target (incl. $0).
        (
          coalesce(m.crowdfunding_mode, false) = true
          AND lower(coalesce(m.status::text, '')) = 'funding'
          AND (
            coalesce(m.expected_price, 0) < 1
            OR coalesce(m.current_funding, 0) < coalesce(m.expected_price, 0)
          )
        )
      )
    FOR UPDATE OF m SKIP LOCKED
  LOOP
    v_expires := COALESCE(
      v_row.crowdfunding_expires_at,
      v_row.created_at + interval '7 days',
      now()
    );
    v_raised := coalesce(v_row.current_funding, 0);
    v_target := coalesce(v_row.expected_price, 0);

    -- Quiet hide: nothing raised — clear cleaner lock & reject bids
    IF v_raised <= 0 THEN
      UPDATE public.missions
      SET
        status = 'hidden',
        cleaner_id = NULL,
        crowdfunding_expires_at = COALESCE(crowdfunding_expires_at, v_expires),
        history_public_until = NULL
      WHERE id = v_row.id
        AND lower(coalesce(status::text, '')) IN ('reported', 'funding')
        AND coalesce(current_funding, 0) <= 0;

      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated > 0 THEN
        UPDATE public.mission_bids
        SET status = 'rejected'
        WHERE mission_id = v_row.id
          AND lower(coalesce(status::text, '')) IN ('pending', 'accepted');
        v_count := v_count + 1;
      END IF;
      CONTINUE;
    END IF;

    -- Eco-ultimatum: 0 < raised < target (or raised > 0 with an invalid target).
    IF v_target >= 1 AND v_raised >= v_target THEN
      CONTINUE; -- funded under the lock
    END IF;

    -- Expired underfunded pot: unlock worker, stamp history window
    UPDATE public.missions
    SET
      status = 'expired',
      cleaner_id = NULL,
      crowdfunding_expires_at = COALESCE(crowdfunding_expires_at, v_expires),
      history_public_until = COALESCE(history_public_until, now() + interval '7 days')
    WHERE id = v_row.id
      AND lower(coalesce(status::text, '')) = 'funding'
      AND coalesce(current_funding, 0) > 0
      AND (
        coalesce(expected_price, 0) < 1
        OR coalesce(current_funding, 0) < coalesce(expected_price, 0)
      );

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      CONTINUE;
    END IF;

    -- Unlock cleaner: mark pending & accepted bids on expired mission as rejected
    UPDATE public.mission_bids
    SET status = 'rejected'
    WHERE mission_id = v_row.id
      AND lower(coalesce(status::text, '')) IN ('pending', 'accepted');

    INSERT INTO public.city_notification_events (mission_id, event_type, payload, pdf_status)
    VALUES (
      v_row.id,
      'crowdfunding_expired',
      jsonb_build_object(
        'service_type', v_row.service_type,
        'location_lat', v_row.location_lat,
        'location_lng', v_row.location_lng,
        'target_budget', v_row.expected_price,
        'raised', v_raised,
        'description', v_row.description,
        'funding_expires_at', v_expires,
        'expired_at', now(),
        'history_public_until', now() + interval '7 days'
      ),
      'pending'
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.process_expired_crowdfunding_missions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_expired_crowdfunding_missions() TO service_role;

COMMENT ON FUNCTION public.process_expired_crowdfunding_missions() IS
  'Wave G (LIFE-3): Clears cleaner_id = NULL and marks bids rejected upon expiry so workers are not stranded.';

-- Backfill: unlock cleaners and reject accepted bids on already expired/hidden/archived missions
UPDATE public.mission_bids
SET status = 'rejected'
WHERE mission_id IN (
  SELECT id FROM public.missions
  WHERE lower(coalesce(status::text, '')) IN ('expired', 'hidden', 'archived')
) AND lower(coalesce(status::text, '')) IN ('pending', 'accepted');

UPDATE public.missions
SET cleaner_id = NULL
WHERE lower(coalesce(status::text, '')) IN ('expired', 'hidden', 'archived')
  AND cleaner_id IS NOT NULL;

COMMIT;
