-- ============================================================================
-- READ-ONLY audit: missions / location_catalog schema, integrity, RLS.
-- Single statement (CLI returns only the last result set) — one jsonb per row.
-- Run: supabase db query --linked -f supabase/audit/20260726_missions_schema_audit.sql
-- ============================================================================
SELECT jsonb_build_object(
  'columns', (
    SELECT jsonb_agg(jsonb_build_object(
      't', table_name, 'c', column_name, 'type', data_type, 'null', is_nullable
    ) ORDER BY table_name, ordinal_position)
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('missions', 'location_catalog')
  ),
  'indexes', (
    SELECT jsonb_agg(jsonb_build_object('t', tablename, 'name', indexname, 'def', indexdef)
                     ORDER BY tablename, indexname)
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename IN ('missions', 'location_catalog')
  ),
  'triggers', (
    SELECT jsonb_agg(jsonb_build_object('name', tgname, 'def', pg_get_triggerdef(t.oid)))
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname = 'missions' AND NOT t.tgisinternal
  ),
  'rls_enabled', (
    SELECT jsonb_agg(jsonb_build_object('t', relname, 'rls', relrowsecurity))
    FROM pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relname IN ('missions', 'location_catalog', 'mission_chats', 'contributions', 'notifications', 'reviews')
      AND relkind = 'r'
  ),
  'policies', (
    SELECT jsonb_agg(jsonb_build_object(
      't', tablename, 'name', policyname, 'cmd', cmd, 'roles', roles::text,
      'using', qual, 'check', with_check) ORDER BY tablename, policyname)
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('missions', 'location_catalog')
  ),
  'foreign_keys', (
    SELECT jsonb_agg(jsonb_build_object(
      'on', conrelid::regclass::text, 'name', conname, 'def', pg_get_constraintdef(oid)))
    FROM pg_constraint
    WHERE contype = 'f'
      AND (conrelid = 'public.missions'::regclass OR confrelid = 'public.missions'::regclass)
  ),
  'check_constraints', (
    SELECT jsonb_agg(jsonb_build_object('name', conname, 'def', pg_get_constraintdef(oid)))
    FROM pg_constraint
    WHERE contype = 'c' AND conrelid = 'public.missions'::regclass
  ),
  'orphans', jsonb_build_object(
    'contributions', (SELECT count(*) FROM public.contributions c
      WHERE NOT EXISTS (SELECT 1 FROM public.missions m WHERE m.id = c.mission_id)),
    'mission_chats', (SELECT count(*) FROM public.mission_chats mc
      WHERE NOT EXISTS (SELECT 1 FROM public.missions m WHERE m.id = mc.mission_id)),
    'reviews', (SELECT count(*) FROM public.reviews r
      WHERE r.mission_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.missions m WHERE m.id = r.mission_id)),
    'missions_creator', (SELECT count(*) FROM public.missions m
      WHERE m.creator_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = m.creator_id)),
    'missions_cleaner', (SELECT count(*) FROM public.missions m
      WHERE m.cleaner_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = m.cleaner_id))
  ),
  'data_integrity', jsonb_build_object(
    'coords_out_of_range', (SELECT count(*) FROM public.missions
      WHERE location_lat IS NOT NULL
        AND (location_lat < -90 OR location_lat > 90 OR location_lng < -180 OR location_lng > 180)),
    'coords_null', (SELECT count(*) FROM public.missions
      WHERE location_lat IS NULL OR location_lng IS NULL),
    'country_ws_only', (SELECT count(*) FROM public.missions
      WHERE country IS NOT NULL AND btrim(country) = ''),
    'city_ws_only', (SELECT count(*) FROM public.missions
      WHERE city IS NOT NULL AND btrim(city) = ''),
    'untrimmed_labels', (SELECT count(*) FROM public.missions
      WHERE (country IS NOT NULL AND country <> btrim(country))
         OR (city IS NOT NULL AND city <> btrim(city))),
    'null_country_with_coords', (SELECT count(*) FROM public.missions
      WHERE location_lat IS NOT NULL AND location_lng IS NOT NULL
        AND nullif(btrim(coalesce(country, '')), '') IS NULL),
    'total_missions', (SELECT count(*) FROM public.missions)
  ),
  'status_distribution', (
    SELECT jsonb_object_agg(coalesce(status, '(null)'), cnt)
    FROM (SELECT status, count(*) AS cnt FROM public.missions GROUP BY status) s
  ),
  'label_pairs_not_in_catalog', (
    SELECT jsonb_agg(jsonb_build_object('country', country, 'city', city, 'n', cnt))
    FROM (
      SELECT m.country, m.city, count(*) AS cnt
      FROM public.missions m
      WHERE nullif(btrim(coalesce(m.country, '')), '') IS NOT NULL
        AND nullif(btrim(coalesce(m.city, '')), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.location_catalog lc
          WHERE lower(btrim(lc.country)) = lower(btrim(m.country))
            AND lower(btrim(lc.city)) = lower(btrim(m.city)))
      GROUP BY m.country, m.city ORDER BY count(*) DESC LIMIT 40
    ) q
  ),
  'catalog_sanity', jsonb_build_object(
    'total_rows', (SELECT count(*) FROM public.location_catalog),
    'country_centroids', (SELECT count(*) FROM public.location_catalog WHERE city = ''),
    'countries', (SELECT count(DISTINCT country) FROM public.location_catalog)
  )
) AS audit;
