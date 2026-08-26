-- =============================================================================
-- Hungry-Games: 1 token per bid on ALL missions (P2P + crowdfunding)
-- =============================================================================
-- place_mission_bid previously charged 1 token only when crowdfunding_mode.
-- Standard P2P bids were free. Charge 1 token for every new bid, ledger it,
-- and upsert an existing pending bid without a second debit.
-- =============================================================================

-- Token ledger (idempotent if the table already exists on hosted DBs).
CREATE TABLE IF NOT EXISTS public.token_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  mission_id uuid REFERENCES public.missions(id) ON DELETE SET NULL,
  amount integer NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.token_transactions
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS mission_id uuid,
  ADD COLUMN IF NOT EXISTS amount integer,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS token_transactions_user_id_created_at_idx
  ON public.token_transactions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS token_transactions_mission_id_idx
  ON public.token_transactions (mission_id)
  WHERE mission_id IS NOT NULL;

ALTER TABLE public.token_transactions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.token_transactions FROM PUBLIC;
REVOKE ALL ON TABLE public.token_transactions FROM anon;
REVOKE ALL ON TABLE public.token_transactions FROM authenticated;
GRANT SELECT ON TABLE public.token_transactions TO authenticated;
GRANT ALL ON TABLE public.token_transactions TO service_role;

DROP POLICY IF EXISTS token_transactions_select_own ON public.token_transactions;
CREATE POLICY token_transactions_select_own
  ON public.token_transactions
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_platform_admin(auth.uid())
  );

COMMENT ON TABLE public.token_transactions IS
  'Append-only token ledger. Writes go through SECURITY DEFINER RPCs (no client INSERT).';

-- Keep the newest pending bid per worker/mission so the unique index can be created.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY mission_id, cleaner_id
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.mission_bids
  WHERE lower(coalesce(status::text, '')) = 'pending'
)
UPDATE public.mission_bids b
SET status = 'rejected'
FROM ranked r
WHERE b.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS mission_bids_one_pending_per_worker
  ON public.mission_bids (mission_id, cleaner_id)
  WHERE lower(coalesce(status::text, '')) = 'pending';

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
  v_packages jsonb := '[]'::jsonb;
  v_pkg jsonb;
  v_pkg_price integer;
  v_min_price integer := NULL;
  v_count integer := 0;
  v_existing_id uuid;
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
  ELSE
    IF v_status NOT IN ('available', 'pending') THEN
      RAISE EXCEPTION 'Mission is not open for bidding';
    END IF;
  END IF;

  -- Update existing pending bid (no second token debit).
  SELECT id
  INTO v_existing_id
  FROM public.mission_bids
  WHERE mission_id = p_mission_id
    AND cleaner_id = uid
    AND lower(coalesce(status::text, '')) = 'pending'
  FOR UPDATE;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.mission_bids
    SET
      bid_amount = v_amount,
      offer_packages = v_packages
    WHERE id = v_existing_id;

    RETURN v_existing_id;
  END IF;

  -- New bid: always debit 1 token (P2P and crowdfunding).
  SELECT token_balance
  INTO v_balance
  FROM public.profiles
  WHERE id = uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF coalesce(v_balance, 0) < 1 THEN
    RAISE EXCEPTION 'Insufficient tokens. 1 token required to place a bid.';
  END IF;

  UPDATE public.profiles
  SET token_balance = token_balance - 1
  WHERE id = uid;

  INSERT INTO public.token_transactions (user_id, mission_id, amount, reason)
  VALUES (uid, p_mission_id, -1, 'bid_placement');

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
  'Place or update a pending bid with optional offer_packages. Every NEW bid costs 1 token (P2P and crowdfunding); ledgered as token_transactions.reason = bid_placement. Creators cannot bid on their own missions.';
