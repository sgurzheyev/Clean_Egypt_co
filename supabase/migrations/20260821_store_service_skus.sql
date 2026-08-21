-- ============================================================================
-- Store service SKUs — priced catalog on contractor storefronts
-- ============================================================================
-- • New JSONB column store_service_skus: [{id,name,base_price,unit}, ...]
-- • Backfill from legacy offered_services text[] (price 0, unit 'job')
-- • Keep offered_services in sync (ids only) for map filters / older clients
-- • Extend get_contractor_store to return store_service_skus
-- ============================================================================

ALTER TABLE public.contractor_stores
  ADD COLUMN IF NOT EXISTS store_service_skus jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.contractor_stores.store_service_skus IS
  'Priced service catalog: [{id, name, base_price, unit}] where unit in (job, hour, sqm). Source of truth; offered_services mirrors ids.';

-- Backfill empty catalogs from legacy tag array
UPDATE public.contractor_stores s
SET store_service_skus = COALESCE(
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', svc,
        'name', initcap(replace(svc, '_', ' ')),
        'base_price', 0,
        'unit', 'job'
      )
      ORDER BY ord
    )
    FROM unnest(COALESCE(s.offered_services, '{}'::text[]))
      WITH ORDINALITY AS t(svc, ord)
  ),
  '[]'::jsonb
)
WHERE COALESCE(jsonb_array_length(s.store_service_skus), 0) = 0
  AND cardinality(COALESCE(s.offered_services, '{}'::text[])) > 0;

-- ---------------------------------------------------------------------------
-- get_contractor_store — expose store_service_skus
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
  store_service_skus jsonb,
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
    COALESCE(s.store_service_skus, '[]'::jsonb),
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
  'Public storefront card for a contractor (includes priced store_service_skus).';
