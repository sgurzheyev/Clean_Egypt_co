-- ============================================================================
-- Wave C — P2-3 amount_target token rank + P3-4 block funded creator DELETE
-- ============================================================================
-- APPLY (remote CLI history is out of sync — do NOT rely on `supabase db push`
-- to replay older files). Paste this entire file into the Supabase SQL Editor
-- (or `psql` as a privileged role) AFTER
-- `20260912_wave_b_failed_recovery_abandon_confirm.sql` (Wave B).
-- Safe to re-run: CREATE OR REPLACE / DROP POLICY IF EXISTS / keyed UPDATEs.
--
-- P2-3: amount_target is token-boost / listing rank. convert_report_to_mission
-- and accept_mission_bid were copying USD prices into it, so a $50 convert
-- outranked every 1-token pin. USD lives in expected_price / bid_amount only.
-- Convert launches a pin at rank 1. Accept leaves the existing token rank.
-- Optional backfill: rows where amount_target equals the USD budget (or legacy
-- fiat-only amount_target >= 100) reset rank to 1 and keep USD in
-- expected_price.
--
-- P3-4: creator DELETE (RLS + API) is blocked when the mission has retained
-- funds (current_funding > 0 or any contributions row). Admin moderation
-- (admin_delete_mission / is_platform_admin) is unchanged. $0 unpaid convert
-- / P2P with no Stripe pot can still be deleted by the creator.
--
-- Does not redo P0 / Wave A / Wave B.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- P2-3) convert_report_to_mission — USD in expected_price; token rank = 1
-- (body = Wave A creator gate + $2 floor; only amount_target assignment changes)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convert_report_to_mission(
  p_mission_id uuid,
  p_expected_price integer,
  p_crowdfunding_mode boolean DEFAULT true
)
RETURNS public.missions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mission public.missions;
  v_price integer;
  v_crowd boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_mission
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  IF v_mission.creator_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Only the report creator can convert this pin';
  END IF;

  IF NOT coalesce(v_mission.is_report, false)
     OR lower(coalesce(v_mission.status::text, '')) <> 'reported' THEN
    RAISE EXCEPTION 'Only open report pins can be converted';
  END IF;

  v_price := floor(coalesce(p_expected_price, 0));
  IF v_price < 2 THEN
    RAISE EXCEPTION 'Target budget must be at least 2 USD';
  END IF;

  v_crowd := coalesce(p_crowdfunding_mode, true)
    AND public.is_garbage_removal_service(v_mission.service_type);

  IF v_crowd THEN
    UPDATE public.missions
    SET
      is_report = false,
      crowdfunding_mode = true,
      status = 'funding',
      expected_price = v_price,
      amount_target = 1,
      current_funding = coalesce(current_funding, 0),
      crowdfunding_expires_at = now() + interval '7 days'
    WHERE id = p_mission_id
    RETURNING * INTO v_mission;
  ELSE
    UPDATE public.missions
    SET
      is_report = false,
      crowdfunding_mode = false,
      status = 'available',
      expected_price = v_price,
      amount_target = 1,
      crowdfunding_expires_at = NULL
    WHERE id = p_mission_id
    RETURNING * INTO v_mission;
  END IF;

  RETURN v_mission;
END;
$$;

REVOKE ALL ON FUNCTION public.convert_report_to_mission(uuid, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_report_to_mission(uuid, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_report_to_mission(uuid, integer, boolean) TO service_role;

COMMENT ON FUNCTION public.convert_report_to_mission(uuid, integer, boolean) IS
  'Optional unpaid convert — report creator only. USD target → expected_price. amount_target stays listing rank (1). Crowd path enters funding at $0 with a 7-day quiet-hide window (P0-1). Neighbors wake the pin with the first Stripe dollar (P0-2).';

-- ---------------------------------------------------------------------------
-- P2-3) accept_mission_bid — bump expected_price only (keep token rank)
-- (body = 20260726_tiered_bid_packages.sql; amount_target no longer copied)
-- ---------------------------------------------------------------------------
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
  'Creator accepts a pending bid; optional p_package_id selects a tiered counter-offer package. USD → expected_price / bid_amount. amount_target (token rank) is not overwritten.';

-- ---------------------------------------------------------------------------
-- P2-3) safe backfill — only when amount_target is a copy of the USD budget
-- or a legacy fiat-only value (>= 100 with no expected_price).
-- Collision: a genuine N-token boost on a $N mission (N>=2) resets to 1.
-- Token pins are almost always 1 (sometimes 2–3) with a different USD budget.
-- ---------------------------------------------------------------------------
UPDATE public.missions
SET expected_price = amount_target
WHERE coalesce(expected_price, 0) = 0
  AND coalesce(amount_target, 0) >= 100;

UPDATE public.missions
SET amount_target = 1
WHERE coalesce(expected_price, 0) >= 2
  AND amount_target IS NOT DISTINCT FROM expected_price;

COMMENT ON COLUMN public.missions.amount_target IS
  'Platform token bid / listing rank (boost). USD work budget lives in expected_price. Do not copy bid or campaign USD here.';

-- ---------------------------------------------------------------------------
-- P3-4) block creator DELETE while funds are retained
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mission_has_retained_funds(p_mission_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.missions m
    WHERE m.id = p_mission_id
      AND (
        coalesce(m.current_funding, 0) > 0
        OR EXISTS (
          SELECT 1
          FROM public.contributions c
          WHERE c.mission_id = m.id
          LIMIT 1
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.mission_has_retained_funds(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mission_has_retained_funds(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mission_has_retained_funds(uuid) TO service_role;

COMMENT ON FUNCTION public.mission_has_retained_funds(uuid) IS
  'True when current_funding > 0 or any contributions row exists (Stripe pot / eco-ultimatum retain). Used to block creator DELETE.';

DROP POLICY IF EXISTS missions_delete_creator_or_admin ON public.missions;
CREATE POLICY missions_delete_creator_or_admin
  ON public.missions
  FOR DELETE
  TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR (
      creator_id = auth.uid()
      AND NOT public.mission_has_retained_funds(id)
    )
  );

CREATE OR REPLACE FUNCTION public.creator_delete_mission(p_mission_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mission public.missions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_mission_id IS NULL THEN
    RAISE EXCEPTION 'Mission id required';
  END IF;

  SELECT * INTO v_mission
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  IF v_mission.creator_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Only the mission creator can delete this pin';
  END IF;

  IF public.is_platform_admin(v_uid) THEN
    RAISE EXCEPTION 'Admins must use admin_delete_mission';
  END IF;

  IF public.mission_has_retained_funds(p_mission_id) THEN
    RAISE EXCEPTION 'Cannot delete a mission that has received funds';
  END IF;

  DELETE FROM public.missions WHERE id = p_mission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.creator_delete_mission(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.creator_delete_mission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_delete_mission(uuid) TO service_role;

COMMENT ON FUNCTION public.creator_delete_mission(uuid) IS
  'Creator-only hard delete for $0 / unfunded pins. Rejects when current_funding > 0 or contributions exist. Admins use admin_delete_mission.';
