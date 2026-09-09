/**
 * Builds the country/city filter catalog from the Supabase reference table,
 * DB-wide mission facets, and the mission rows the caller already has loaded.
 *
 * Fetching the DB sources is what keeps a populated country from returning
 * "0 results" just because its missions fell outside the caller's page window.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  buildLocationCatalog,
  type LocationCatalog,
  type MissionGeoFields,
} from '../lib/globalMarketplace';
import {
  fetchLocationCatalogSources,
  type LocationCatalogSources,
} from '../lib/locationCatalogSource';

const EMPTY_SOURCES: LocationCatalogSources = { catalogRows: [], facets: [] };

/**
 * @param missions Rows currently loaded by the caller (optimistic/local rows
 *                 stay visible in the filter even before the DB knows them).
 * @param enabled  Skip the network call while a panel is closed.
 */
export function useLocationCatalog(
  missions: readonly MissionGeoFields[] | null | undefined,
  enabled = true
): { catalog: LocationCatalog; loading: boolean } {
  const [sources, setSources] = useState<LocationCatalogSources>(EMPTY_SOURCES);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchLocationCatalogSources()
      .then((next) => {
        if (cancelled) return;
        setSources(next);
      })
      .catch((err) => {
        console.warn('[useLocationCatalog] failed:', err);
        if (!cancelled) setSources(EMPTY_SOURCES);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const catalog = useMemo(
    () =>
      buildLocationCatalog(Array.isArray(missions) ? missions : [], {
        catalogRows: Array.isArray(sources.catalogRows) ? sources.catalogRows : [],
        facets: Array.isArray(sources.facets) ? sources.facets : [],
      }),
    [missions, sources]
  );

  return { catalog, loading };
}
