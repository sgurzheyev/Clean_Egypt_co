/**
 * Loads the global location filter sources from Supabase:
 *   - `public.location_catalog`            — seeded countries + major cities.
 *   - `list_mission_location_facets()`     — DB-wide counts, not page limited.
 *
 * Both are process-cached: the reference catalog is static, and facets only
 * need to be fresh enough to keep the filter list honest. Failures degrade to
 * empty arrays so the filter falls back to mission-derived values.
 */
import { supabase } from '../../services/supabase';
import type { LocationCatalogRow, LocationFacet } from './globalMarketplace';

export type LocationCatalogSources = {
  catalogRows: LocationCatalogRow[];
  facets: LocationFacet[];
};

const EMPTY: LocationCatalogSources = { catalogRows: [], facets: [] };

/** Facets are re-fetched at most once per this window. */
const FACETS_TTL_MS = 60_000;

let catalogRowsCache: LocationCatalogRow[] | null = null;
let catalogRowsInFlight: Promise<LocationCatalogRow[]> | null = null;

let facetsCache: { at: number; rows: LocationFacet[] } | null = null;
let facetsInFlight: Promise<LocationFacet[]> | null = null;

async function loadCatalogRows(): Promise<LocationCatalogRow[]> {
  if (catalogRowsCache) return catalogRowsCache;
  if (catalogRowsInFlight) return catalogRowsInFlight;

  catalogRowsInFlight = (async () => {
    try {
      const { data, error } = await supabase
        .from('location_catalog')
        .select('country, country_code, city, lat, lng, is_quick_region')
        .order('country', { ascending: true })
        .order('city', { ascending: true });

      if (error) throw error;

      const rows: LocationCatalogRow[] = (data ?? [])
        .map((row: Record<string, unknown>) => ({
          country: String(row.country ?? '').trim(),
          countryCode: row.country_code ? String(row.country_code) : null,
          city: String(row.city ?? '').trim(),
          lat: Number(row.lat),
          lng: Number(row.lng),
          isQuickRegion: !!row.is_quick_region,
        }))
        .filter(
          (row) => !!row.country && Number.isFinite(row.lat) && Number.isFinite(row.lng)
        );

      catalogRowsCache = rows;
      return rows;
    } catch (err) {
      // Table missing (migration not applied yet) or offline — fall back.
      console.warn('[locationCatalog] location_catalog unavailable:', err);
      return [];
    } finally {
      catalogRowsInFlight = null;
    }
  })();

  return catalogRowsInFlight;
}

async function loadFacets(): Promise<LocationFacet[]> {
  const fresh = facetsCache && Date.now() - facetsCache.at < FACETS_TTL_MS;
  if (fresh) return facetsCache!.rows;
  if (facetsInFlight) return facetsInFlight;

  facetsInFlight = (async () => {
    try {
      const { data, error } = await supabase.rpc('list_mission_location_facets');
      if (error) throw error;

      const rows: LocationFacet[] = (data ?? [])
        .map((row: Record<string, unknown>) => ({
          country: String(row.country ?? '').trim(),
          city: String(row.city ?? '').trim(),
          missionCount: Number(row.mission_count) || 0,
          lat: Number(row.lat),
          lng: Number(row.lng),
        }))
        .filter((row) => !!row.country);

      facetsCache = { at: Date.now(), rows };
      return rows;
    } catch (err) {
      // RPC missing (migration not applied yet) or offline — fall back.
      console.warn('[locationCatalog] list_mission_location_facets unavailable:', err);
      return [];
    } finally {
      facetsInFlight = null;
    }
  })();

  return facetsInFlight;
}

/** Fetch both catalog sources. Never rejects. */
export async function fetchLocationCatalogSources(): Promise<LocationCatalogSources> {
  try {
    const [catalogRows, facets] = await Promise.all([loadCatalogRows(), loadFacets()]);
    return { catalogRows, facets };
  } catch {
    return EMPTY;
  }
}

/** Drop the facet cache so the next read reflects newly created missions. */
export function invalidateLocationFacets(): void {
  facetsCache = null;
}
