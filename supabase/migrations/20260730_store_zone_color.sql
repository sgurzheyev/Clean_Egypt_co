-- ============================================================================
-- Store zone color — custom HEX for coverage polygons / office pins
-- ============================================================================

ALTER TABLE public.contractor_stores
  ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '#22d3ee';

COMMENT ON COLUMN public.contractor_stores.color IS
  'HEX accent for map coverage polygon + office pin (e.g. #22d3ee).';

DO $$
BEGIN
  ALTER TABLE public.contractor_stores
    DROP CONSTRAINT IF EXISTS contractor_stores_color_hex_check;
  ALTER TABLE public.contractor_stores
    ADD CONSTRAINT contractor_stores_color_hex_check
    CHECK (color ~ '^#[0-9A-Fa-f]{6}$');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'contractor_stores.color check: %', SQLERRM;
END $$;

-- Backfill legacy rows that somehow lack a valid color
UPDATE public.contractor_stores
SET color = '#22d3ee'
WHERE color IS NULL OR color !~ '^#[0-9A-Fa-f]{6}$';

-- ---------------------------------------------------------------------------
-- get_contractor_store — expose color
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_contractor_store(uuid);

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
  service_bundles jsonb,
  recurrence_type text,
  supported_recurrence_types text[],
  color text,
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
    s.service_bundles,
    s.recurrence_type,
    s.supported_recurrence_types,
    coalesce(nullif(btrim(s.color), ''), '#22d3ee'),
    s.updated_at
  FROM public.contractor_stores s
  WHERE s.owner_id = p_owner_id
    AND (s.is_published = true OR s.owner_id = auth.uid())
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_contractor_store(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_contractor_store(uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_contractor_store(uuid) IS
  'Public storefront card for a contractor (includes map zone color).';
