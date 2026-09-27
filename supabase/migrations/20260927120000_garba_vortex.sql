-- ============================================================================
-- Garba-Vortex — zoom heatmap, free-pin anti-spam, cleanup sectors
-- ----------------------------------------------------------------------------
-- Apply manually (do NOT db push):
--   supabase db query --linked -f supabase/migrations/20260927120000_garba_vortex.sql
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT DO NOTHING.
-- Re-running does NOT reset tuned rows in garba_vortex_config.
--
-- PostGIS is already required by 20260720_proof_of_work_lifecycle_security.sql
-- (missions.location geography). This file creates the extension only when it
-- is missing. Heatmap aggregation is zoom-dependent lat/lng grid binning on
-- top of that geography index (stable cells, capped row count). Meter checks
-- (bump, isolation, sector squares) use ST_DWithin / ST_Covers.
--
-- Storm mode is the next file: 20260927130000_garba_vortex_storm.sql.
-- ============================================================================

DO $ext$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
      CREATE EXTENSION postgis WITH SCHEMA extensions;
    ELSE
      CREATE EXTENSION postgis;
    END IF;
  END IF;
END
$ext$;

-- ---------------------------------------------------------------------------
-- Tunables (singleton). Defaults are inserted once; later edits stick.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.garba_vortex_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  free_pins_per_day integer NOT NULL DEFAULT 5 CHECK (free_pins_per_day >= 0),
  -- Own recent free pin within this radius is strengthened instead of inserted.
  bump_radius_m integer NOT NULL DEFAULT 200 CHECK (bump_radius_m >= 1),
  -- Any reporter's pin this close is the same pile (global duplicate).
  same_spot_radius_m integer NOT NULL DEFAULT 35 CHECK (same_spot_radius_m >= 1),
  -- 'own_user' (default): 200 m exclusion is per reporter, so neighbours can
  -- still drop the centre+4 pattern. 'any': 200 m bump applies to every pin
  -- (stricter anti-spam; sectors then fill only after bump_recency_days).
  bump_scope text NOT NULL DEFAULT 'own_user' CHECK (bump_scope IN ('own_user', 'any')),
  bump_recency_days integer NOT NULL DEFAULT 14 CHECK (bump_recency_days >= 1),
  isolation_radius_m integer NOT NULL DEFAULT 25000 CHECK (isolation_radius_m >= 100),
  isolation_neighbor_max integer NOT NULL DEFAULT 1 CHECK (isolation_neighbor_max >= 0),
  sector_grid_m integer NOT NULL DEFAULT 200 CHECK (sector_grid_m >= 50),
  -- Centre + 4 perimeter pins inside one sector square.
  sector_pin_threshold integer NOT NULL DEFAULT 5 CHECK (sector_pin_threshold >= 2),
  -- Charged only when a new free pin lands in a cell that already has
  -- high_risk_min_pins free pins. 0 disables the charge.
  high_risk_token_cost integer NOT NULL DEFAULT 0 CHECK (high_risk_token_cost >= 0),
  high_risk_min_pins integer NOT NULL DEFAULT 3 CHECK (high_risk_min_pins >= 1),
  -- Isolated singleton cells at or above this severity get the black-hole ring.
  -- Heatmap spikes still fire for every isolated singleton below the cutoff.
  black_hole_min_severity integer NOT NULL DEFAULT 8 CHECK (black_hole_min_severity BETWEEN 1 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.garba_vortex_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.garba_vortex_config IS
  'Garba-Vortex tunables. Edit the singleton row; do not delete it. Client zoom fade (11→12) lives in src/lib/garbaVortex.ts.';

ALTER TABLE public.garba_vortex_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS garba_vortex_config_read ON public.garba_vortex_config;
CREATE POLICY garba_vortex_config_read
  ON public.garba_vortex_config
  FOR SELECT
  TO anon, authenticated
  USING (true);

REVOKE ALL ON TABLE public.garba_vortex_config FROM PUBLIC;
REVOKE ALL ON TABLE public.garba_vortex_config FROM anon;
REVOKE ALL ON TABLE public.garba_vortex_config FROM authenticated;
GRANT SELECT ON TABLE public.garba_vortex_config TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Missions: intensity + isolation + sector membership
-- ---------------------------------------------------------------------------
ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS severity_score integer NOT NULL DEFAULT 1;

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS is_isolated boolean NOT NULL DEFAULT false;

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS sector_id uuid;

DO $sev$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'missions_severity_score_range'
      AND conrelid = 'public.missions'::regclass
  ) THEN
    ALTER TABLE public.missions
      ADD CONSTRAINT missions_severity_score_range
      CHECK (severity_score BETWEEN 1 AND 100) NOT VALID;
  END IF;
END
$sev$;

ALTER TABLE public.missions VALIDATE CONSTRAINT missions_severity_score_range;

COMMENT ON COLUMN public.missions.severity_score IS
  'Garba-Vortex intensity 1–100. Duplicate free reports bump this instead of inserting a row.';
COMMENT ON COLUMN public.missions.is_isolated IS
  'True only after garba_vortex_refresh_isolation. Default false so a new paid pin is not a black-hole spike before that recompute.';
COMMENT ON COLUMN public.missions.sector_id IS
  'Set when this free pin was dissolved into a closed cleanup sector.';

REVOKE UPDATE (severity_score, is_isolated, sector_id) ON TABLE public.missions FROM PUBLIC;
REVOKE UPDATE (severity_score, is_isolated, sector_id) ON TABLE public.missions FROM anon;
REVOKE UPDATE (severity_score, is_isolated, sector_id) ON TABLE public.missions FROM authenticated;

-- ---------------------------------------------------------------------------
-- Cleanup sectors (200 m squares)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cleanup_sectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grid_key text NOT NULL UNIQUE,
  center_lat double precision NOT NULL,
  center_lng double precision NOT NULL,
  pin_count integer NOT NULL DEFAULT 0,
  severity_sum integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'forming' CHECK (status IN ('forming', 'cleanup')),
  area geography(Polygon, 4326),
  mission_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

DO $fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cleanup_sectors_mission_id_fkey'
  ) THEN
    ALTER TABLE public.cleanup_sectors
      ADD CONSTRAINT cleanup_sectors_mission_id_fkey
      FOREIGN KEY (mission_id) REFERENCES public.missions(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'missions_sector_id_fkey'
  ) THEN
    ALTER TABLE public.missions
      ADD CONSTRAINT missions_sector_id_fkey
      FOREIGN KEY (sector_id) REFERENCES public.cleanup_sectors(id) ON DELETE SET NULL;
  END IF;
END
$fk$;

CREATE INDEX IF NOT EXISTS idx_cleanup_sectors_area_gist
  ON public.cleanup_sectors USING GIST (area);

CREATE INDEX IF NOT EXISTS idx_cleanup_sectors_status
  ON public.cleanup_sectors (status);

COMMENT ON TABLE public.cleanup_sectors IS
  'Garba-Vortex dirty squares. status=cleanup closes the square to new free pins. mission_id stays null until open_cleanup_sector_mission.';

ALTER TABLE public.cleanup_sectors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cleanup_sectors_read ON public.cleanup_sectors;
CREATE POLICY cleanup_sectors_read
  ON public.cleanup_sectors
  FOR SELECT
  TO anon, authenticated
  USING (true);

REVOKE ALL ON TABLE public.cleanup_sectors FROM PUBLIC;
REVOKE ALL ON TABLE public.cleanup_sectors FROM anon;
REVOKE ALL ON TABLE public.cleanup_sectors FROM authenticated;
GRANT SELECT ON TABLE public.cleanup_sectors TO anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_missions_location_vortex_gist
  ON public.missions USING GIST (location)
  WHERE hidden_at IS NULL AND location IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_missions_vortex_bbox
  ON public.missions (location_lat, location_lng)
  WHERE hidden_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_missions_free_pin_creator_day
  ON public.missions (creator_id, created_at DESC)
  WHERE coalesce(is_report, false) = true;

-- ---------------------------------------------------------------------------
-- Geometry helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.garba_vortex_point(
  p_lat double precision,
  p_lng double precision
)
RETURNS geography
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, extensions, net, pg_temp
AS $$
  SELECT ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;
$$;

CREATE OR REPLACE FUNCTION public.garba_vortex_cell(
  p_lat double precision,
  p_lng double precision,
  p_grid_m integer,
  OUT cell_lat double precision,
  OUT cell_lng double precision,
  OUT grid_key text
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_cos double precision := greatest(cos(radians(p_lat)), 0.2);
  v_side integer := greatest(coalesce(p_grid_m, 200), 50);
  v_lat_step double precision := v_side / 111320.0;
  v_lng_step double precision := v_side / (111320.0 * v_cos);
BEGIN
  cell_lat := round(p_lat / v_lat_step) * v_lat_step;
  cell_lng := round(p_lng / v_lng_step) * v_lng_step;
  grid_key := trim(to_char(cell_lat, 'FM999990.000000'))
    || ':'
    || trim(to_char(cell_lng, 'FM999990.000000'));
END;
$$;

-- $0 free pins drop off every read once the 7-day clock (or created_at+7d) has passed.
-- A contribution that raised current_funding stays visible; the Stripe path
-- moves crowdfunding_expires_at to at least now()+30 days.
CREATE OR REPLACE FUNCTION public.garba_free_pin_still_live(
  p_is_report boolean,
  p_status text,
  p_current_funding numeric,
  p_created_at timestamptz,
  p_expires_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, extensions, net, pg_temp
AS $$
  SELECT
    NOT (coalesce(p_is_report, false) OR lower(coalesce(p_status, '')) = 'reported')
    OR coalesce(p_current_funding, 0) > 0
    OR coalesce(p_expires_at, p_created_at + interval '7 days', now() + interval '1 day') > now();
$$;

REVOKE ALL ON FUNCTION public.garba_free_pin_still_live(boolean, text, numeric, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.garba_free_pin_still_live(boolean, text, numeric, timestamptz, timestamptz)
  TO anon, authenticated, service_role;

-- Map-visible waste, matching the client pin filter plus hidden_at.
-- Drop the 6-arg form so a re-run does not leave an overload that skips expiry.
DROP FUNCTION IF EXISTS public.garba_vortex_pin_visible(text, timestamptz, timestamptz, numeric, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.garba_vortex_pin_visible(
  p_status text,
  p_hidden_at timestamptz,
  p_created_at timestamptz,
  p_current_funding numeric,
  p_history_public_until timestamptz,
  p_media_purged_at timestamptz,
  p_is_report boolean DEFAULT false,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, extensions, net, pg_temp
AS $$
  SELECT
    p_hidden_at IS NULL
    AND p_status IS NOT NULL
    AND lower(p_status) NOT IN ('hidden', 'archived', 'pending_payment')
    AND public.garba_free_pin_still_live(
      p_is_report, p_status, p_current_funding, p_created_at, p_expires_at
    )
    AND (
      lower(p_status) IN (
        'reported', 'pending', 'available', 'funding', 'open',
        'in_progress', 'review', 'pending_approval', 'awaiting_approval'
      )
      OR (
        lower(p_status) = 'completed'
        AND p_created_at IS NOT NULL
        AND p_created_at >= now() - interval '24 hours'
      )
      OR (
        lower(p_status) = 'expired'
        AND p_media_purged_at IS NULL
        AND coalesce(p_current_funding, 0) > 0
        AND p_history_public_until IS NOT NULL
        AND p_history_public_until > now()
      )
    );
$$;

-- Closed squares stop blocking once their cleanup order is finished or hidden.
CREATE OR REPLACE FUNCTION public.garba_vortex_sector_order_open(p_mission_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, extensions, net, pg_temp
AS $$
  SELECT
    p_mission_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.missions m
      WHERE m.id = p_mission_id
        AND m.hidden_at IS NULL
        AND lower(coalesce(m.status::text, '')) IN (
          'available', 'funding', 'pending', 'open', 'in_progress',
          'review', 'pending_approval', 'awaiting_approval'
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.garba_vortex_cell_m(p_zoom double precision)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, net, pg_temp
AS $$
  SELECT greatest(
    250::double precision,
    400000::double precision / power(2::double precision, least(greatest(coalesce(p_zoom, 0), 0), 14))
  );
$$;

REVOKE ALL ON FUNCTION public.garba_vortex_point(double precision, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.garba_vortex_cell(double precision, double precision, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.garba_vortex_pin_visible(text, timestamptz, timestamptz, numeric, timestamptz, timestamptz, boolean, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.garba_vortex_sector_order_open(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.garba_vortex_cell_m(double precision) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.garba_vortex_point(double precision, double precision) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.garba_vortex_cell(double precision, double precision, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.garba_vortex_pin_visible(text, timestamptz, timestamptz, numeric, timestamptz, timestamptz, boolean, timestamptz) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.garba_vortex_sector_order_open(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.garba_vortex_cell_m(double precision) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Isolation recompute (owner-only). Skips city-wide writes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.garba_vortex_refresh_isolation(
  p_lat double precision,
  p_lng double precision
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_radius integer;
  v_max integer;
  v_geog geography;
  v_near integer;
BEGIN
  SELECT isolation_radius_m, isolation_neighbor_max
    INTO v_radius, v_max
  FROM public.garba_vortex_config
  WHERE id = 1;

  v_radius := coalesce(v_radius, 25000);
  v_max := coalesce(v_max, 1);
  v_geog := public.garba_vortex_point(p_lat, p_lng);

  SELECT count(*)::integer INTO v_near
  FROM public.missions n
  WHERE n.hidden_at IS NULL
    AND n.location IS NOT NULL
    AND ST_DWithin(n.location, v_geog, v_radius);

  -- Dense city: the new point is not isolated. Don't rewrite every neighbour.
  IF coalesce(v_near, 0) > 120 THEN
    UPDATE public.missions m
       SET is_isolated = false
     WHERE m.hidden_at IS NULL
       AND ST_DWithin(
         coalesce(m.location, public.garba_vortex_point(m.location_lat, m.location_lng)),
         v_geog,
         40
       );
    RETURN;
  END IF;

  UPDATE public.missions m
     SET is_isolated = (
       SELECT count(*) <= v_max
       FROM public.missions n
       WHERE n.id <> m.id
         AND n.hidden_at IS NULL
         AND n.location IS NOT NULL
         AND public.garba_vortex_pin_visible(
           n.status::text,
           n.hidden_at,
           n.created_at,
           n.current_funding,
           n.history_public_until,
           n.media_purged_at,
           n.is_report,
           n.crowdfunding_expires_at
         )
         AND ST_DWithin(
           n.location,
           coalesce(m.location, public.garba_vortex_point(m.location_lat, m.location_lng)),
           v_radius
         )
     )
   WHERE m.hidden_at IS NULL
     AND m.location_lat IS NOT NULL
     AND ST_DWithin(
       coalesce(m.location, public.garba_vortex_point(m.location_lat, m.location_lng)),
       v_geog,
       v_radius
     );
END;
$$;

REVOKE ALL ON FUNCTION public.garba_vortex_refresh_isolation(double precision, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.garba_vortex_refresh_isolation(double precision, double precision) FROM anon;
REVOKE ALL ON FUNCTION public.garba_vortex_refresh_isolation(double precision, double precision) FROM authenticated;

-- Recompute isolation for every visible mission when its place or visibility changes.
-- UPDATE OF skips is_isolated itself, so the inner refresh cannot recurse.
CREATE OR REPLACE FUNCTION public.garba_vortex_isolation_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
BEGIN
  IF NEW.location_lat IS NULL OR NEW.location_lng IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM public.garba_vortex_refresh_isolation(NEW.location_lat, NEW.location_lng);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.garba_vortex_isolation_trigger() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.garba_vortex_isolation_trigger() FROM anon;
REVOKE ALL ON FUNCTION public.garba_vortex_isolation_trigger() FROM authenticated;

DROP TRIGGER IF EXISTS trg_garba_vortex_isolation ON public.missions;
CREATE TRIGGER trg_garba_vortex_isolation
  AFTER INSERT OR UPDATE OF location, location_lat, location_lng, hidden_at, status
  ON public.missions
  FOR EACH ROW
  EXECUTE FUNCTION public.garba_vortex_isolation_trigger();

-- ---------------------------------------------------------------------------
-- Promote a 200 m square into a Cleanup Sector. No mission row is created.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.garba_vortex_rollup_sector(
  p_lat double precision,
  p_lng double precision,
  p_creator uuid,
  p_country text,
  p_city text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_grid_m integer;
  v_threshold integer;
  v_cell record;
  v_count integer := 0;
  v_sev integer := 0;
  v_sector_id uuid;
  v_status text;
  v_half double precision;
  v_dlat double precision;
  v_dlng double precision;
  v_cos double precision;
  v_area geography;
BEGIN
  SELECT sector_grid_m, sector_pin_threshold
    INTO v_grid_m, v_threshold
  FROM public.garba_vortex_config
  WHERE id = 1;

  v_grid_m := coalesce(v_grid_m, 200);
  v_threshold := coalesce(v_threshold, 5);

  SELECT * INTO v_cell
  FROM public.garba_vortex_cell(p_lat, p_lng, v_grid_m);

  PERFORM pg_advisory_xact_lock(hashtext('garba-sector:' || v_cell.grid_key));

  SELECT count(*)::integer, coalesce(sum(m.severity_score), 0)::integer
    INTO v_count, v_sev
  FROM public.missions m
  WHERE m.hidden_at IS NULL
    AND coalesce(m.is_report, false) = true
    AND lower(coalesce(m.status::text, '')) IN ('reported', 'pending', 'available', 'funding', 'open')
    AND public.garba_free_pin_still_live(
      m.is_report, m.status::text, m.current_funding, m.created_at, m.crowdfunding_expires_at
    )
    AND m.location_lat BETWEEN v_cell.cell_lat - 0.02 AND v_cell.cell_lat + 0.02
    AND m.location_lng BETWEEN v_cell.cell_lng - 0.02 AND v_cell.cell_lng + 0.02
    AND (SELECT c.grid_key FROM public.garba_vortex_cell(m.location_lat, m.location_lng, v_grid_m) AS c) = v_cell.grid_key;

  INSERT INTO public.cleanup_sectors AS s (
    grid_key, center_lat, center_lng, pin_count, severity_sum, status
  )
  VALUES (v_cell.grid_key, v_cell.cell_lat, v_cell.cell_lng, v_count, v_sev, 'forming')
  ON CONFLICT (grid_key) DO UPDATE
    SET pin_count = EXCLUDED.pin_count,
        severity_sum = EXCLUDED.severity_sum,
        center_lat = EXCLUDED.center_lat,
        center_lng = EXCLUDED.center_lng,
        updated_at = now()
  RETURNING s.id, s.status
    INTO v_sector_id, v_status;

  IF v_count < v_threshold OR v_status = 'cleanup' THEN
    RETURN v_sector_id;
  END IF;

  v_half := v_grid_m / 2.0;
  v_cos := greatest(cos(radians(v_cell.cell_lat)), 0.2);
  v_dlat := v_half / 111320.0;
  v_dlng := v_half / (111320.0 * v_cos);
  v_area := ST_SetSRID(
    ST_MakePolygon(
      ST_MakeLine(ARRAY[
        ST_MakePoint(v_cell.cell_lng - v_dlng, v_cell.cell_lat - v_dlat),
        ST_MakePoint(v_cell.cell_lng + v_dlng, v_cell.cell_lat - v_dlat),
        ST_MakePoint(v_cell.cell_lng + v_dlng, v_cell.cell_lat + v_dlat),
        ST_MakePoint(v_cell.cell_lng - v_dlng, v_cell.cell_lat + v_dlat),
        ST_MakePoint(v_cell.cell_lng - v_dlng, v_cell.cell_lat - v_dlat)
      ])
    ),
    4326
  )::geography;

  -- Unfunded square. A later open_cleanup_sector_mission call creates the order
  -- with auth.uid() as creator and the normal lead-mission price/token rules.
  UPDATE public.cleanup_sectors
     SET status = 'cleanup',
         area = v_area,
         mission_id = NULL,
         closed_at = coalesce(closed_at, now()),
         updated_at = now()
   WHERE id = v_sector_id;

  UPDATE public.missions m
     SET sector_id = v_sector_id
   WHERE m.hidden_at IS NULL
     AND coalesce(m.is_report, false) = true
     AND public.garba_free_pin_still_live(
       m.is_report, m.status::text, m.current_funding, m.created_at, m.crowdfunding_expires_at
     )
     AND m.location_lat BETWEEN v_cell.cell_lat - 0.02 AND v_cell.cell_lat + 0.02
     AND m.location_lng BETWEEN v_cell.cell_lng - 0.02 AND v_cell.cell_lng + 0.02
     AND (SELECT c.grid_key FROM public.garba_vortex_cell(m.location_lat, m.location_lng, v_grid_m) AS c) = v_cell.grid_key;

  RETURN v_sector_id;
END;
$$;

REVOKE ALL ON FUNCTION public.garba_vortex_rollup_sector(double precision, double precision, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.garba_vortex_rollup_sector(double precision, double precision, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.garba_vortex_rollup_sector(double precision, double precision, uuid, text, text) FROM authenticated;

COMMENT ON FUNCTION public.garba_vortex_rollup_sector(double precision, double precision, uuid, text, text) IS
  'Marks a full 200 m square as a Cleanup Sector. Does not insert a mission. p_creator is unused and kept so existing callers stay valid.';

-- Explicit fund/convert. Creator is auth.uid() inside create_lead_mission_with_token
-- ($2 floor, token bid, optional crowdfund clock).
CREATE OR REPLACE FUNCTION public.open_cleanup_sector_mission(
  p_sector_id uuid,
  p_expected_price integer,
  p_description text,
  p_photo_urls text[] DEFAULT ARRAY[]::text[],
  p_crowdfunding_mode boolean DEFAULT false,
  p_token_bid integer DEFAULT 1
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
  v_mission uuid;
  v_lat double precision;
  v_lng double precision;
  v_desc text;
  v_mid uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_sector_id IS NULL THEN
    RAISE EXCEPTION 'Sector id required';
  END IF;

  SELECT s.status, s.mission_id, s.center_lat, s.center_lng
    INTO v_status, v_mission, v_lat, v_lng
  FROM public.cleanup_sectors s
  WHERE s.id = p_sector_id
  FOR UPDATE;

  IF NOT FOUND OR v_status IS DISTINCT FROM 'cleanup' THEN
    RAISE EXCEPTION 'cleanup_sector_not_ready' USING ERRCODE = 'P0001';
  END IF;

  IF v_mission IS NOT NULL AND public.garba_vortex_sector_order_open(v_mission) THEN
    RAISE EXCEPTION 'cleanup_sector_already_open' USING ERRCODE = 'P0001';
  END IF;

  v_desc := nullif(btrim(coalesce(p_description, '')), '');
  IF v_desc IS NULL THEN
    v_desc := 'Cleanup Sector — fund this 200 m square.';
  END IF;

  v_mid := public.create_lead_mission_with_token(
    'beach_street_cleanup',
    v_lat,
    v_lng,
    v_desc,
    coalesce(p_photo_urls, ARRAY[]::text[]),
    NULL,
    NULL,
    greatest(1, coalesce(p_token_bid, 1)),
    p_expected_price,
    coalesce(p_crowdfunding_mode, false),
    NULL,
    NULL,
    'one_time',
    NULL
  );

  UPDATE public.cleanup_sectors
     SET mission_id = v_mid,
         updated_at = now()
   WHERE id = p_sector_id;

  RETURN v_mid;
END;
$$;

REVOKE ALL ON FUNCTION public.open_cleanup_sector_mission(uuid, integer, text, text[], boolean, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_cleanup_sector_mission(uuid, integer, text, text[], boolean, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.open_cleanup_sector_mission(uuid, integer, text, text[], boolean, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.open_cleanup_sector_mission(uuid, integer, text, text[], boolean, integer) IS
  'Authenticated user opens a Cleanup Sector as a normal lead mission. Does not copy other reporters'' photos.';

-- Bump photos live here, not on the mission the bump strengthens.
CREATE TABLE IF NOT EXISTS public.garba_vortex_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  sector_id uuid,
  reporter_id uuid NOT NULL,
  photo_urls text[] NOT NULL DEFAULT ARRAY[]::text[],
  video_proof_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_garba_vortex_contributions_mission
  ON public.garba_vortex_contributions (mission_id, created_at DESC);

ALTER TABLE public.garba_vortex_contributions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.garba_vortex_contributions FROM PUBLIC;
REVOKE ALL ON TABLE public.garba_vortex_contributions FROM anon;
REVOKE ALL ON TABLE public.garba_vortex_contributions FROM authenticated;

COMMENT ON TABLE public.garba_vortex_contributions IS
  'Photos and video from a free-pin bump. The bumped mission photo_urls stay the owner''s.';

-- ---------------------------------------------------------------------------
-- Free pin entry. p_commit=false is the preflight (no writes, no token move).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_free_vortex_pin(
  p_location_lat double precision,
  p_location_lng double precision,
  p_description text,
  p_photo_urls text[] DEFAULT ARRAY[]::text[],
  p_service_type text DEFAULT 'beach_street_cleanup',
  p_country text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_video_proof_url text DEFAULT NULL,
  p_commit boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_service text;
  v_desc text;
  v_country text := nullif(btrim(coalesce(p_country, '')), '');
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_video text := nullif(btrim(coalesce(p_video_proof_url, '')), '');
  v_geog geography;
  v_cfg public.garba_vortex_config;
  v_bump_id uuid;
  v_bump_score integer;
  v_day_count integer;
  v_cell_count integer;
  v_cost integer := 0;
  v_balance integer;
  v_id uuid;
  v_sector uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_location_lat IS NULL OR p_location_lng IS NULL
     OR p_location_lat < -90 OR p_location_lat > 90
     OR p_location_lng < -180 OR p_location_lng > 180 THEN
    RAISE EXCEPTION 'Location required';
  END IF;

  SELECT * INTO v_cfg FROM public.garba_vortex_config WHERE id = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'garba_vortex_config missing';
  END IF;

  v_service := lower(coalesce(nullif(btrim(p_service_type), ''), 'beach_street_cleanup'));
  IF NOT public.is_garbage_removal_service(v_service) THEN
    v_service := 'beach_street_cleanup';
  END IF;

  v_desc := nullif(btrim(coalesce(p_description, '')), '');
  IF v_desc IS NULL THEN
    v_desc := '#GarbageZone Needs attention';
  END IF;
  IF char_length(v_desc) > 2000 THEN
    RAISE EXCEPTION 'Description too long';
  END IF;

  IF v_video IS NOT NULL AND char_length(v_video) > 500 THEN
    RAISE EXCEPTION 'Video proof URL too long';
  END IF;

  IF v_country IS NOT NULL AND char_length(v_country) > 120 THEN
    v_country := left(v_country, 120);
  END IF;
  IF v_city IS NOT NULL AND char_length(v_city) > 120 THEN
    v_city := left(v_city, 120);
  END IF;

  v_geog := public.garba_vortex_point(p_location_lat, p_location_lng);

  IF p_commit THEN
    PERFORM pg_advisory_xact_lock(hashtext('garba-user:' || v_uid::text));
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cleanup_sectors s
    WHERE s.status = 'cleanup'
      AND s.area IS NOT NULL
      AND ST_Covers(s.area, v_geog)
      AND public.garba_vortex_sector_order_open(s.mission_id)
  ) THEN
    RAISE EXCEPTION 'cleanup_sector_closed' USING ERRCODE = 'P0001';
  END IF;

  -- Global same-spot duplicate, then (unless scope=any) the caller's own 200 m exclusion.
  SELECT m.id, m.severity_score
    INTO v_bump_id, v_bump_score
  FROM public.missions m
  WHERE coalesce(m.is_report, false) = true
    AND m.hidden_at IS NULL
    AND lower(coalesce(m.status::text, '')) IN ('reported', 'pending', 'available', 'funding', 'open')
    AND public.garba_free_pin_still_live(
      m.is_report, m.status::text, m.current_funding, m.created_at, m.crowdfunding_expires_at
    )
    AND m.created_at >= now() - make_interval(days => v_cfg.bump_recency_days)
    AND ST_DWithin(
      coalesce(m.location, public.garba_vortex_point(m.location_lat, m.location_lng)),
      v_geog,
      v_cfg.same_spot_radius_m
    )
  ORDER BY ST_Distance(
    coalesce(m.location, public.garba_vortex_point(m.location_lat, m.location_lng)),
    v_geog
  )
  LIMIT 1;

  IF v_bump_id IS NULL AND v_cfg.bump_scope = 'any' THEN
    SELECT m.id, m.severity_score
      INTO v_bump_id, v_bump_score
    FROM public.missions m
    WHERE coalesce(m.is_report, false) = true
      AND m.hidden_at IS NULL
      AND lower(coalesce(m.status::text, '')) IN ('reported', 'pending', 'available', 'funding', 'open')
    AND public.garba_free_pin_still_live(
      m.is_report, m.status::text, m.current_funding, m.created_at, m.crowdfunding_expires_at
    )
      AND m.created_at >= now() - make_interval(days => v_cfg.bump_recency_days)
      AND ST_DWithin(
        coalesce(m.location, public.garba_vortex_point(m.location_lat, m.location_lng)),
        v_geog,
        v_cfg.bump_radius_m
      )
    ORDER BY ST_Distance(
      coalesce(m.location, public.garba_vortex_point(m.location_lat, m.location_lng)),
      v_geog
    )
    LIMIT 1;
  ELSIF v_bump_id IS NULL THEN
    SELECT m.id, m.severity_score
      INTO v_bump_id, v_bump_score
    FROM public.missions m
    WHERE m.creator_id = v_uid
      AND coalesce(m.is_report, false) = true
      AND m.hidden_at IS NULL
      AND lower(coalesce(m.status::text, '')) IN ('reported', 'pending', 'available', 'funding', 'open')
    AND public.garba_free_pin_still_live(
      m.is_report, m.status::text, m.current_funding, m.created_at, m.crowdfunding_expires_at
    )
      AND m.created_at >= now() - make_interval(days => v_cfg.bump_recency_days)
      AND ST_DWithin(
        coalesce(m.location, public.garba_vortex_point(m.location_lat, m.location_lng)),
        v_geog,
        v_cfg.bump_radius_m
      )
    ORDER BY ST_Distance(
      coalesce(m.location, public.garba_vortex_point(m.location_lat, m.location_lng)),
      v_geog
    )
    LIMIT 1;
  END IF;

  IF v_bump_id IS NOT NULL THEN
    v_bump_score := least(100, coalesce(v_bump_score, 1) + 1);
    IF NOT p_commit THEN
      RETURN jsonb_build_object(
        'ok', true,
        'action', 'bump',
        'id', v_bump_id,
        'severity_score', v_bump_score,
        'tokens_spent', 0
      );
    END IF;

    UPDATE public.missions
       SET severity_score = v_bump_score
     WHERE id = v_bump_id;

    INSERT INTO public.garba_vortex_contributions (mission_id, reporter_id, photo_urls, video_proof_url)
    VALUES (
      v_bump_id,
      v_uid,
      coalesce(p_photo_urls[1:9], ARRAY[]::text[]),
      v_video
    );

    PERFORM public.garba_vortex_refresh_isolation(p_location_lat, p_location_lng);

    RETURN jsonb_build_object(
      'ok', true,
      'action', 'bumped',
      'id', v_bump_id,
      'severity_score', v_bump_score,
      'tokens_spent', 0
    );
  END IF;

  SELECT count(*)::integer
    INTO v_day_count
  FROM public.missions m
  WHERE m.creator_id = v_uid
    AND coalesce(m.is_report, false) = true
    AND m.created_at >= now() - interval '1 day';

  IF v_day_count >= v_cfg.free_pins_per_day THEN
    RAISE EXCEPTION 'free_pin_daily_limit' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::integer
    INTO v_cell_count
  FROM public.missions m
  WHERE coalesce(m.is_report, false) = true
    AND m.hidden_at IS NULL
    AND lower(coalesce(m.status::text, '')) IN ('reported', 'pending', 'available', 'funding', 'open')
    AND public.garba_free_pin_still_live(
      m.is_report, m.status::text, m.current_funding, m.created_at, m.crowdfunding_expires_at
    )
    AND (SELECT c.grid_key FROM public.garba_vortex_cell(m.location_lat, m.location_lng, v_cfg.sector_grid_m) AS c)
      = (SELECT c.grid_key FROM public.garba_vortex_cell(p_location_lat, p_location_lng, v_cfg.sector_grid_m) AS c);

  IF v_cfg.high_risk_token_cost > 0 AND v_cell_count >= v_cfg.high_risk_min_pins THEN
    v_cost := v_cfg.high_risk_token_cost;
  END IF;

  IF NOT p_commit THEN
    RETURN jsonb_build_object(
      'ok', true,
      'action', 'create',
      'tokens_spent', v_cost,
      'high_risk', v_cost > 0
    );
  END IF;

  IF p_photo_urls IS NULL OR coalesce(cardinality(p_photo_urls), 0) < 1 THEN
    RAISE EXCEPTION 'At least one photo is required';
  END IF;

  IF v_cost > 0 THEN
    SELECT token_balance
      INTO v_balance
    FROM public.profiles
    WHERE id = v_uid
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Profile not found';
    END IF;
    IF coalesce(v_balance, 0) < v_cost THEN
      RAISE EXCEPTION 'insufficient_tokens' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.profiles
       SET token_balance = token_balance - v_cost
     WHERE id = v_uid;
  END IF;

  INSERT INTO public.missions (
    creator_id,
    category,
    service_type,
    status,
    is_report,
    crowdfunding_mode,
    amount_target,
    expected_price,
    current_funding,
    location_lat,
    location_lng,
    description,
    photo_urls,
    video_proof_url,
    country,
    city,
    crowdfunding_expires_at,
    severity_score,
    is_isolated
  )
  VALUES (
    v_uid,
    'public',
    v_service,
    'reported',
    true,
    false,
    0,
    0,
    0,
    p_location_lat,
    p_location_lng,
    v_desc,
    p_photo_urls[1:9],
    v_video,
    v_country,
    v_city,
    now() + interval '7 days',
    1,
    false
  )
  RETURNING id INTO v_id;

  PERFORM public.garba_vortex_refresh_isolation(p_location_lat, p_location_lng);
  v_sector := public.garba_vortex_rollup_sector(
    p_location_lat,
    p_location_lng,
    v_uid,
    v_country,
    v_city
  );

  RETURN jsonb_build_object(
    'ok', true,
    'action', 'created',
    'id', v_id,
    'severity_score', 1,
    'tokens_spent', v_cost,
    'sector_id', v_sector
  );
END;
$$;

REVOKE ALL ON FUNCTION public.place_free_vortex_pin(
  double precision, double precision, text, text[], text, text, text, text, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.place_free_vortex_pin(
  double precision, double precision, text, text[], text, text, text, text, boolean
) FROM anon;
GRANT EXECUTE ON FUNCTION public.place_free_vortex_pin(
  double precision, double precision, text, text[], text, text, text, text, boolean
) TO authenticated, service_role;

COMMENT ON FUNCTION public.place_free_vortex_pin(
  double precision, double precision, text, text[], text, text, text, text, boolean
) IS
  'Free civic pin with server-side daily cap, 200 m own-pin bump, same-spot bump, optional high-risk token cost, and cleanup-sector close. auth.uid() required. Anon cannot execute.';

-- Keep the existing client RPC. Same signature as 20260912; body delegates.
CREATE OR REPLACE FUNCTION public.create_garbage_zone_report(
  p_location_lat double precision,
  p_location_lng double precision,
  p_description text,
  p_photo_urls text[] DEFAULT ARRAY[]::text[],
  p_service_type text DEFAULT 'beach_street_cleanup',
  p_country text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_video_proof_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.place_free_vortex_pin(
    p_location_lat,
    p_location_lng,
    p_description,
    p_photo_urls,
    p_service_type,
    p_country,
    p_city,
    p_video_proof_url,
    true
  );
  RETURN (v_result->>'id')::uuid;
END;
$$;

REVOKE ALL ON FUNCTION public.create_garbage_zone_report(
  double precision, double precision, text, text[], text, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_garbage_zone_report(
  double precision, double precision, text, text[], text, text, text, text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_garbage_zone_report(
  double precision, double precision, text, text[], text, text, text, text
) TO authenticated, service_role;

COMMENT ON FUNCTION public.create_garbage_zone_report(
  double precision, double precision, text, text[], text, text, text, text
) IS
  'Free civic pin. Delegates to place_free_vortex_pin (daily cap, bump, sector close, 7-day quiet-hide clock).';

-- ---------------------------------------------------------------------------
-- Aggregated heatmap. Explicit hidden_at filter. SECURITY INVOKER so RLS also
-- applies. Caps at 2000 cells.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_garba_vortex_heatmap(
  p_min_lng double precision,
  p_min_lat double precision,
  p_max_lng double precision,
  p_max_lat double precision,
  p_zoom double precision DEFAULT 4,
  p_include_reports boolean DEFAULT true
)
RETURNS TABLE (
  lng double precision,
  lat double precision,
  weight numeric,
  point_count integer,
  max_severity integer,
  isolated boolean,
  black_hole boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_cell_m double precision := public.garba_vortex_cell_m(p_zoom);
  v_mid_lat double precision := (least(p_min_lat, p_max_lat) + greatest(p_min_lat, p_max_lat)) / 2.0;
  v_cos double precision := greatest(cos(radians(v_mid_lat)), 0.2);
  v_dlat double precision := v_cell_m / 111320.0;
  v_dlng double precision := v_cell_m / (111320.0 * v_cos);
  v_bh integer;
BEGIN
  IF p_min_lng IS NULL OR p_min_lat IS NULL OR p_max_lng IS NULL OR p_max_lat IS NULL THEN
    RETURN;
  END IF;

  SELECT black_hole_min_severity INTO v_bh
  FROM public.garba_vortex_config
  WHERE id = 1;
  v_bh := coalesce(v_bh, 8);

  RETURN QUERY
  SELECT
    avg(m.location_lng)::double precision AS lng,
    avg(m.location_lat)::double precision AS lat,
    (
      CASE
        WHEN count(*) = 1 AND bool_or(m.is_isolated) THEN
          least(12::numeric, 8::numeric + max(m.severity_score)::numeric / 20.0)
        ELSE
          least(
            12::numeric,
            2.5
              + ln(count(*)::numeric + 1) * 1.7
              + ln(sum(m.severity_score)::numeric + 1) * 0.35
          )
      END
    ) AS weight,
    count(*)::integer AS point_count,
    max(m.severity_score)::integer AS max_severity,
    bool_or(m.is_isolated) AS isolated,
    (
      count(*) = 1
      AND bool_or(m.is_isolated)
      AND max(m.severity_score) >= v_bh
    ) AS black_hole
  FROM public.missions m
  WHERE m.hidden_at IS NULL
    AND m.location_lat IS NOT NULL
    AND m.location_lng IS NOT NULL
    AND m.location_lat BETWEEN least(p_min_lat, p_max_lat) AND greatest(p_min_lat, p_max_lat)
    AND (
      (
        p_min_lng <= p_max_lng
        AND m.location_lng BETWEEN p_min_lng AND p_max_lng
      )
      OR (
        p_min_lng > p_max_lng
        AND (m.location_lng >= p_min_lng OR m.location_lng <= p_max_lng)
      )
    )
    AND public.garba_vortex_pin_visible(
      m.status::text,
      m.hidden_at,
      m.created_at,
      m.current_funding,
      m.history_public_until,
      m.media_purged_at,
      m.is_report,
      m.crowdfunding_expires_at
    )
    AND (
      coalesce(p_include_reports, true)
      OR NOT (
        coalesce(m.is_report, false)
        OR lower(coalesce(m.status::text, '')) = 'reported'
      )
    )
  GROUP BY
    round(m.location_lat / v_dlat),
    round(m.location_lng / v_dlng)
  ORDER BY 3 DESC
  LIMIT 2000;
END;
$$;

REVOKE ALL ON FUNCTION public.get_garba_vortex_heatmap(
  double precision, double precision, double precision, double precision, double precision, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_garba_vortex_heatmap(
  double precision, double precision, double precision, double precision, double precision, boolean
) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_garba_vortex_heatmap(
  double precision, double precision, double precision, double precision, double precision, boolean
) IS
  'Zoom-binned Garba-Vortex cells. hidden_at rows are excluded. Does not move tokens.';

CREATE OR REPLACE FUNCTION public.get_garba_vortex_sectors(
  p_min_lng double precision,
  p_min_lat double precision,
  p_max_lng double precision,
  p_max_lat double precision
)
RETURNS TABLE (
  id uuid,
  status text,
  pin_count integer,
  severity_sum integer,
  mission_id uuid,
  center_lng double precision,
  center_lat double precision,
  geojson jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, net, pg_temp
AS $$
  SELECT
    s.id,
    s.status,
    s.pin_count,
    s.severity_sum,
    s.mission_id,
    s.center_lng,
    s.center_lat,
    ST_AsGeoJSON(s.area::geometry)::jsonb
  FROM public.cleanup_sectors s
  WHERE s.status = 'cleanup'
    AND s.area IS NOT NULL
    AND public.garba_vortex_sector_order_open(s.mission_id)
    AND s.center_lat BETWEEN least(p_min_lat, p_max_lat) - 0.5 AND greatest(p_min_lat, p_max_lat) + 0.5
    AND s.center_lng BETWEEN least(p_min_lng, p_max_lng) - 0.5 AND greatest(p_min_lng, p_max_lng) + 0.5
  LIMIT 300;
$$;

REVOKE ALL ON FUNCTION public.get_garba_vortex_sectors(
  double precision, double precision, double precision, double precision
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_garba_vortex_sectors(
  double precision, double precision, double precision, double precision
) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_garba_vortex_sectors(
  double precision, double precision, double precision, double precision
) IS
  'Closed cleanup squares whose order is still open. Read-only. No token movement.';

-- ---------------------------------------------------------------------------
-- Backfill geography + isolation for existing visible pins.
-- ---------------------------------------------------------------------------
UPDATE public.missions
SET location = public.garba_vortex_point(location_lat, location_lng)
WHERE location IS NULL
  AND location_lat BETWEEN -90 AND 90
  AND location_lng BETWEEN -180 AND 180;

UPDATE public.missions m
SET is_isolated = (
  SELECT count(*) <= (SELECT isolation_neighbor_max FROM public.garba_vortex_config WHERE id = 1)
  FROM public.missions n
  WHERE n.id <> m.id
    AND n.hidden_at IS NULL
    AND n.location IS NOT NULL
    AND public.garba_vortex_pin_visible(
      n.status::text,
      n.hidden_at,
      n.created_at,
      n.current_funding,
      n.history_public_until,
      n.media_purged_at,
      n.is_report,
      n.crowdfunding_expires_at
    )
    AND ST_DWithin(
      n.location,
      m.location,
      (SELECT isolation_radius_m FROM public.garba_vortex_config WHERE id = 1)
    )
)
WHERE m.hidden_at IS NULL
  AND m.location IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Post-flight
-- ---------------------------------------------------------------------------
DO $pf$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    RAISE EXCEPTION 'Post-flight failed: postgis extension missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.garba_vortex_config WHERE id = 1 AND high_risk_token_cost = 0) THEN
    -- Row may have been tuned. Only fail when the singleton is absent.
    IF NOT EXISTS (SELECT 1 FROM public.garba_vortex_config WHERE id = 1) THEN
      RAISE EXCEPTION 'Post-flight failed: garba_vortex_config missing';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'missions' AND column_name = 'severity_score'
  ) THEN
    RAISE EXCEPTION 'Post-flight failed: missions.severity_score missing';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.place_free_vortex_pin(double precision, double precision, text, text[], text, text, text, text, boolean)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Post-flight failed: anon can execute place_free_vortex_pin';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.place_free_vortex_pin(double precision, double precision, text, text[], text, text, text, text, boolean)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Post-flight failed: authenticated cannot execute place_free_vortex_pin';
  END IF;

  IF NOT has_function_privilege(
    'anon',
    'public.get_garba_vortex_heatmap(double precision, double precision, double precision, double precision, double precision, boolean)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Post-flight failed: anon cannot execute get_garba_vortex_heatmap';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.garba_vortex_refresh_isolation(double precision, double precision)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Post-flight failed: anon can execute garba_vortex_refresh_isolation';
  END IF;

  IF has_function_privilege('anon', 'public.garba_vortex_isolation_trigger()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: anon can execute garba_vortex_isolation_trigger';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.open_cleanup_sector_mission(uuid, integer, text, text[], boolean, integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Post-flight failed: anon can execute open_cleanup_sector_mission';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'garba_vortex_contributions'
  ) THEN
    RAISE EXCEPTION 'Post-flight failed: garba_vortex_contributions missing';
  END IF;
END
$pf$;
