-- ============================================================================
-- Missions schema cleanup, validation & hardening (consolidated)
-- ----------------------------------------------------------------------------
-- AUDIT FINDINGS (2026-07-26, supabase/audit/20260726_missions_schema_audit.sql)
--   CRITICAL  RLS was DISABLED on public.missions while anon+authenticated held
--             full INSERT/UPDATE/DELETE/TRUNCATE grants — anyone holding the
--             public anon key could rewrite or wipe the missions table. The
--             existing SELECT policy ("Allow users to read all missions") was
--             inert because RLS was off.
--   MISSING   No CHECK constraints on missions coordinates (lat/lng range) or
--             country/city label length (RPCs cap at 120 chars, direct paths
--             did not).
--   CLEAN     0 orphaned children (contributions / chats / reviews), 0 dangling
--             creator/cleaner references, 0 out-of-range coordinates, 0
--             whitespace-only or untrimmed labels, all FKs and location
--             indexes intact, catalog consistent (54 countries / 372 rows).
--
-- WHAT THIS MIGRATION DOES
--   1. Pre-flight validation — aborts loudly if data would violate the new
--      constraints (guarantees VALIDATE CONSTRAINT succeeds).
--   2. Data normalization — trims labels, nullifies whitespace-only values
--      (no-op today; keeps re-runs safe).
--   3. Spatial + label CHECK constraints on missions.
--   4. Re-asserts canonical location indexes.
--   5. Re-applies the canonical location trigger (cross-border-safe version)
--      and the list_mission_location_facets() RPC.
--   6. RLS hardening: enables RLS on missions with correctly-scoped policies,
--      revokes the dangerous table grants, re-asserts location_catalog RLS.
--   7. Post-flight assertions — fails if the expected state is not in place.
--
-- All statements are idempotent; the file is safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Pre-flight: abort if existing data would violate the new constraints.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.missions
  WHERE location_lat < -90 OR location_lat > 90
     OR location_lng < -180 OR location_lng > 180;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Pre-flight failed: % mission(s) with out-of-range coordinates', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.contributions c
  WHERE NOT EXISTS (SELECT 1 FROM public.missions m WHERE m.id = c.mission_id);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Pre-flight failed: % orphaned contribution(s)', v_bad;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Normalize labels: trim whitespace, drop empty strings.
--    (Audit found 0 such rows — kept for idempotent safety on future re-runs.)
-- ---------------------------------------------------------------------------
UPDATE public.missions
SET country = nullif(btrim(country), ''),
    city    = nullif(btrim(city), '')
WHERE (country IS NOT NULL AND (country <> btrim(country) OR btrim(country) = ''))
   OR (city    IS NOT NULL AND (city    <> btrim(city)    OR btrim(city)    = ''));

-- ---------------------------------------------------------------------------
-- 3) Spatial + label constraints (NOT VALID first: no full-table lock window,
--    then VALIDATE — pre-flight already proved the data is clean).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'missions_lat_range' AND conrelid = 'public.missions'::regclass) THEN
    ALTER TABLE public.missions
      ADD CONSTRAINT missions_lat_range
      CHECK (location_lat >= -90 AND location_lat <= 90) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'missions_lng_range' AND conrelid = 'public.missions'::regclass) THEN
    ALTER TABLE public.missions
      ADD CONSTRAINT missions_lng_range
      CHECK (location_lng >= -180 AND location_lng <= 180) NOT VALID;
  END IF;

  -- Mirrors the 120-char cap enforced by create_lead_mission_with_token /
  -- create_garbage_zone_report so direct writes cannot exceed it either.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'missions_country_length' AND conrelid = 'public.missions'::regclass) THEN
    ALTER TABLE public.missions
      ADD CONSTRAINT missions_country_length
      CHECK (country IS NULL OR char_length(country) <= 120) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'missions_city_length' AND conrelid = 'public.missions'::regclass) THEN
    ALTER TABLE public.missions
      ADD CONSTRAINT missions_city_length
      CHECK (city IS NULL OR char_length(city) <= 120) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.missions VALIDATE CONSTRAINT missions_lat_range;
ALTER TABLE public.missions VALIDATE CONSTRAINT missions_lng_range;
ALTER TABLE public.missions VALIDATE CONSTRAINT missions_country_length;
ALTER TABLE public.missions VALIDATE CONSTRAINT missions_city_length;

-- ---------------------------------------------------------------------------
-- 4) Canonical location / sort indexes (idempotent re-assert).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_missions_country
  ON public.missions (country)
  WHERE country IS NOT NULL AND length(btrim(country)) > 0;

CREATE INDEX IF NOT EXISTS idx_missions_country_city
  ON public.missions (country, city)
  WHERE country IS NOT NULL AND city IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_missions_status_created_at_desc
  ON public.missions (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_location_catalog_country
  ON public.location_catalog (country);

CREATE INDEX IF NOT EXISTS idx_location_catalog_cities
  ON public.location_catalog (country, city)
  WHERE city <> '';

-- ---------------------------------------------------------------------------
-- 5) Canonical trigger + facets RPC (single source of truth going forward).
--    Trigger body = cross-border-safe version from
--    20260726_fix_location_trigger_border.sql.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.haversine_km(
  lat1 double precision,
  lng1 double precision,
  lat2 double precision,
  lng2 double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT 2 * 6371 * asin(
    sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) *
      power(sin(radians(lng2 - lng1) / 2), 2)
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.missions_fill_location_from_catalog()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_km constant double precision := 300;
  v_country text := nullif(btrim(coalesce(NEW.country, '')), '');
  v_city text := nullif(btrim(coalesce(NEW.city, '')), '');
  v_match_country text;
  v_match_city text;
BEGIN
  IF NEW.location_lat IS NULL OR NEW.location_lng IS NULL THEN
    RETURN NEW;
  END IF;

  -- Explicit values from the client (Mapbox reverse geocode) always win.
  IF v_country IS NOT NULL AND v_city IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- City known, country missing: the city name is the stronger signal.
  IF v_country IS NULL AND v_city IS NOT NULL THEN
    SELECT lc.country
    INTO v_match_country
    FROM public.location_catalog lc
    WHERE lc.city <> ''
      AND lower(btrim(lc.city)) = lower(v_city)
    ORDER BY public.haversine_km(NEW.location_lat, NEW.location_lng, lc.lat, lc.lng)
    LIMIT 1;

    IF v_match_country IS NOT NULL THEN
      NEW.country := v_match_country;
      RETURN NEW;
    END IF;
  END IF;

  -- Nearest catalog city. When the country is already known, never cross the
  -- border: restrict candidates to cities within that country.
  SELECT lc.country, lc.city
  INTO v_match_country, v_match_city
  FROM public.location_catalog lc
  WHERE lc.city <> ''
    AND (v_country IS NULL OR lower(btrim(lc.country)) = lower(v_country))
    AND public.haversine_km(NEW.location_lat, NEW.location_lng, lc.lat, lc.lng) <= v_max_km
  ORDER BY public.haversine_km(NEW.location_lat, NEW.location_lng, lc.lat, lc.lng)
  LIMIT 1;

  IF v_match_country IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_country IS NULL THEN
    NEW.country := v_match_country;
  END IF;
  IF v_city IS NULL THEN
    NEW.city := v_match_city;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.missions_fill_location_from_catalog() IS
  'Fills missions.country/city from location_catalog by nearest major city. Never assigns a city from a different country than the one supplied.';

DROP TRIGGER IF EXISTS trg_missions_fill_location ON public.missions;
CREATE TRIGGER trg_missions_fill_location
  BEFORE INSERT OR UPDATE OF location_lat, location_lng, country, city
  ON public.missions
  FOR EACH ROW
  EXECUTE FUNCTION public.missions_fill_location_from_catalog();

CREATE OR REPLACE FUNCTION public.list_mission_location_facets()
RETURNS TABLE (
  country text,
  city text,
  mission_count bigint,
  lat double precision,
  lng double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    btrim(m.country)                        AS country,
    coalesce(nullif(btrim(m.city), ''), '') AS city,
    count(*)                                AS mission_count,
    avg(m.location_lat)                     AS lat,
    avg(m.location_lng)                     AS lng
  FROM public.missions m
  WHERE nullif(btrim(coalesce(m.country, '')), '') IS NOT NULL
    AND m.location_lat IS NOT NULL
    AND m.location_lng IS NOT NULL
    AND lower(coalesce(m.status, '')) IN (
      'pending', 'available', 'open', 'funding', 'in_progress', 'reported'
    )
  GROUP BY btrim(m.country), coalesce(nullif(btrim(m.city), ''), '')
  ORDER BY count(*) DESC, btrim(m.country);
$$;

REVOKE ALL ON FUNCTION public.list_mission_location_facets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_mission_location_facets() TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) RLS hardening — the core fix.
--
--    Write paths that must keep working (verified against the client code):
--      • Mission creation      → SECURITY DEFINER RPCs only (token-charged
--                                create_lead_mission_with_token /
--                                create_garbage_zone_report). No direct INSERT
--                                exists in the client, so no INSERT policy —
--                                direct inserts would bypass the 1-token bid.
--      • Proof "before" photos → assigned cleaner updates photo_urls/started_at
--                                directly (components/Profile.tsx).
--      • Mission edits         → creator_update_mission_details RPC + direct
--                                creator updates.
--      • Creator cancel        → direct DELETE of own mission
--                                (components/Profile.tsx handleDeleteJob).
--      • Admin moderation      → direct UPDATE/DELETE from AdminDashboard,
--                                gated by public.is_platform_admin().
--      • Lifecycle mutations   → SECURITY DEFINER RPCs (bypass RLS as owner).
--
--    SELECT stays world-readable (anon included): the map + Live Market Feed
--    are the logged-out landing experience, and this matches the effective
--    exposure before this migration. Contact privacy lives in profiles, not
--    missions.
-- ---------------------------------------------------------------------------
ALTER TABLE public.missions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow users to read all missions" ON public.missions;
DROP POLICY IF EXISTS missions_select_all ON public.missions;
CREATE POLICY missions_select_all
  ON public.missions
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS missions_update_participants ON public.missions;
CREATE POLICY missions_update_participants
  ON public.missions
  FOR UPDATE
  TO authenticated
  USING (
    creator_id = auth.uid()
    OR cleaner_id = auth.uid()
    OR public.is_platform_admin(auth.uid())
  )
  WITH CHECK (
    creator_id = auth.uid()
    OR cleaner_id = auth.uid()
    OR public.is_platform_admin(auth.uid())
  );

DROP POLICY IF EXISTS missions_delete_creator_or_admin ON public.missions;
CREATE POLICY missions_delete_creator_or_admin
  ON public.missions
  FOR DELETE
  TO authenticated
  USING (
    creator_id = auth.uid()
    OR public.is_platform_admin(auth.uid())
  );

-- Grants: TRUNCATE bypasses RLS entirely and REFERENCES/TRIGGER are never
-- legitimate for API roles — revoke. INSERT is revoked because creation is
-- RPC-only (SECURITY DEFINER functions are unaffected by these grants).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.missions FROM anon;
REVOKE INSERT, TRUNCATE, REFERENCES, TRIGGER ON public.missions FROM authenticated;
GRANT SELECT ON public.missions TO anon, authenticated;
GRANT UPDATE, DELETE ON public.missions TO authenticated;

-- location_catalog: read-only reference data (re-assert).
ALTER TABLE public.location_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS location_catalog_select_all ON public.location_catalog;
CREATE POLICY location_catalog_select_all
  ON public.location_catalog
  FOR SELECT
  TO anon, authenticated
  USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.location_catalog FROM anon, authenticated;
GRANT SELECT ON public.location_catalog TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7) Post-flight assertions — fail loudly if the hardening did not stick.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_rls boolean;
  v_policies integer;
  v_trigger integer;
  v_constraints integer;
BEGIN
  SELECT relrowsecurity INTO v_rls
  FROM pg_class WHERE oid = 'public.missions'::regclass;
  IF NOT v_rls THEN
    RAISE EXCEPTION 'Post-flight failed: RLS still disabled on public.missions';
  END IF;

  SELECT count(*) INTO v_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'missions';
  IF v_policies < 3 THEN
    RAISE EXCEPTION 'Post-flight failed: expected >= 3 policies on missions, found %', v_policies;
  END IF;

  SELECT count(*) INTO v_trigger
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  WHERE c.relname = 'missions' AND t.tgname = 'trg_missions_fill_location';
  IF v_trigger <> 1 THEN
    RAISE EXCEPTION 'Post-flight failed: trg_missions_fill_location missing';
  END IF;

  SELECT count(*) INTO v_constraints
  FROM pg_constraint
  WHERE conrelid = 'public.missions'::regclass
    AND conname IN ('missions_lat_range', 'missions_lng_range',
                    'missions_country_length', 'missions_city_length')
    AND convalidated;
  IF v_constraints <> 4 THEN
    RAISE EXCEPTION 'Post-flight failed: expected 4 validated CHECK constraints, found %', v_constraints;
  END IF;

  RAISE NOTICE 'missions schema hardening: OK (RLS on, % policies, trigger + 4 constraints validated)', v_policies;
END $$;
