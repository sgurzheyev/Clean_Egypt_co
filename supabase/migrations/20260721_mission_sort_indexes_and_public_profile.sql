-- ============================================================================
-- Mission sorting indexes + public creator profile read
-- ----------------------------------------------------------------------------
-- 1) Performance indexes for list/map sorting at scale:
--      - missions(created_at DESC)  → "Date submitted" sort
--      - missions(<budget> DESC)    → "Job budget" sort (amount_usd if present,
--        else expected_price, the canonical USD work budget on missions)
--      - missions(status, created_at DESC) → common filtered feed query
-- 2) get_public_profile(uuid): safe, minimal public creator card for the
--    "/profile/:id" navigation from mission cards (RLS-agnostic, SECURITY DEFINER).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Sorting / filtering indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_missions_created_at_desc
  ON public.missions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_missions_status_created_at_desc
  ON public.missions (status, created_at DESC);

-- Budget sort. The requested column is amount_usd; on this schema the canonical
-- USD work budget lives in expected_price. Index whichever exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'missions'
      AND column_name = 'amount_usd'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_missions_amount_usd_desc
               ON public.missions (amount_usd DESC)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'missions'
      AND column_name = 'expected_price'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_missions_expected_price_desc
               ON public.missions (expected_price DESC)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Public creator profile (minimal, safe fields only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_public_profile(p_id uuid)
RETURNS TABLE (
  id uuid,
  full_name text,
  avatar_url text,
  is_verified boolean,
  rating numeric,
  missions_created integer,
  missions_completed integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.avatar_url,
    coalesce(p.is_verified, false) AS is_verified,
    p.rating::numeric AS rating,
    (
      SELECT count(*)::integer
      FROM public.missions m
      WHERE m.creator_id = p.id
    ) AS missions_created,
    (
      SELECT count(*)::integer
      FROM public.missions m
      WHERE m.creator_id = p.id
        AND lower(coalesce(m.status::text, '')) IN ('completed', 'finished')
    ) AS missions_completed
  FROM public.profiles p
  WHERE p.id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_public_profile(uuid) IS
  'Public, minimal creator card (name, avatar, verified, rating, mission counts) for /profile/:id navigation.';
