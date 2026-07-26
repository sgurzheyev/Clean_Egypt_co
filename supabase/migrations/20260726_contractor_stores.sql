-- ============================================================================
-- Contractor / Business Stores — storefront data for worker profiles
-- ============================================================================
-- • public.contractor_stores — one storefront per contractor (owner = profiles.id)
-- • Public read for published stores; owners manage their own row (RLS)
-- • service_radius_polygon stored as GeoJSON Polygon / MultiPolygon jsonb
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.contractor_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Office / base of operations
  office_lat double precision,
  office_lng double precision,
  office_address text,
  -- Idealista-style coverage zone (GeoJSON Polygon | MultiPolygon)
  service_radius_polygon jsonb,
  -- Catalog
  offered_services text[] NOT NULL DEFAULT '{}',
  materials_and_chemicals text[] NOT NULL DEFAULT '{}',
  store_photos text[] NOT NULL DEFAULT '{}',
  -- Presentation
  store_name text,
  store_bio text,
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contractor_stores_owner_unique UNIQUE (owner_id),
  CONSTRAINT contractor_stores_office_lat_range
    CHECK (office_lat IS NULL OR (office_lat >= -90 AND office_lat <= 90)),
  CONSTRAINT contractor_stores_office_lng_range
    CHECK (office_lng IS NULL OR (office_lng >= -180 AND office_lng <= 180)),
  CONSTRAINT contractor_stores_photos_cap
    CHECK (cardinality(store_photos) <= 12),
  CONSTRAINT contractor_stores_services_cap
    CHECK (cardinality(offered_services) <= 32),
  CONSTRAINT contractor_stores_materials_cap
    CHECK (cardinality(materials_and_chemicals) <= 48)
);

COMMENT ON TABLE public.contractor_stores IS
  'Worker/business storefront: office pin, coverage polygon, services, materials, gallery.';

COMMENT ON COLUMN public.contractor_stores.service_radius_polygon IS
  'GeoJSON Polygon or MultiPolygon for the contractor working area (Idealista-style).';

CREATE INDEX IF NOT EXISTS idx_contractor_stores_owner
  ON public.contractor_stores (owner_id);

CREATE INDEX IF NOT EXISTS idx_contractor_stores_published
  ON public.contractor_stores (is_published)
  WHERE is_published = true;

CREATE INDEX IF NOT EXISTS idx_contractor_stores_office
  ON public.contractor_stores (office_lat, office_lng)
  WHERE office_lat IS NOT NULL AND office_lng IS NOT NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_contractor_stores_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contractor_stores_updated_at ON public.contractor_stores;
CREATE TRIGGER trg_contractor_stores_updated_at
  BEFORE UPDATE ON public.contractor_stores
  FOR EACH ROW
  EXECUTE FUNCTION public.set_contractor_stores_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.contractor_stores ENABLE ROW LEVEL SECURITY;

-- Anyone (incl. anon) can read published storefronts; owners always see theirs.
DROP POLICY IF EXISTS contractor_stores_select_public ON public.contractor_stores;
CREATE POLICY contractor_stores_select_public
  ON public.contractor_stores
  FOR SELECT
  TO anon, authenticated
  USING (is_published = true OR owner_id = auth.uid());

DROP POLICY IF EXISTS contractor_stores_insert_own ON public.contractor_stores;
CREATE POLICY contractor_stores_insert_own
  ON public.contractor_stores
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS contractor_stores_update_own ON public.contractor_stores;
CREATE POLICY contractor_stores_update_own
  ON public.contractor_stores
  FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS contractor_stores_delete_own ON public.contractor_stores;
CREATE POLICY contractor_stores_delete_own
  ON public.contractor_stores
  FOR DELETE
  TO authenticated
  USING (owner_id = auth.uid());

GRANT SELECT ON public.contractor_stores TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.contractor_stores TO authenticated;
GRANT ALL ON public.contractor_stores TO service_role;

-- ---------------------------------------------------------------------------
-- Public read helper (stable shape for frontend / PublicProfile)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_contractor_store(p_owner_id uuid)
RETURNS TABLE (
  id uuid,
  owner_id uuid,
  office_lat double precision,
  office_lng double precision,
  office_address text,
  service_radius_polygon jsonb,
  offered_services text[],
  materials_and_chemicals text[],
  store_photos text[],
  store_name text,
  store_bio text,
  is_published boolean,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.owner_id,
    s.office_lat,
    s.office_lng,
    s.office_address,
    s.service_radius_polygon,
    s.offered_services,
    s.materials_and_chemicals,
    s.store_photos,
    s.store_name,
    s.store_bio,
    s.is_published,
    s.updated_at
  FROM public.contractor_stores s
  WHERE s.owner_id = p_owner_id
    AND (s.is_published = true OR s.owner_id = auth.uid())
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_contractor_store(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_contractor_store(uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_contractor_store(uuid) IS
  'Public storefront card for a contractor. Draft stores visible only to the owner.';
