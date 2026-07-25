/**
 * Global country / city marketplace filter for worldwide mission pins.
 *
 * The catalog is assembled from three sources so the filter never shows a
 * region that returns 0 results (and never hides a populated one):
 *   1. `location_catalog` reference rows from Supabase (major countries/cities).
 *   2. `list_mission_location_facets()` — DB-wide counts, not page limited.
 *   3. The mission rows currently loaded by the client.
 *
 * Missions written before `missions.country`/`city` existed can still be NULL;
 * those are resolved to the nearest reference city by coordinates.
 *
 * Complements the legacy Egypt hub helpers in `egyptMarketplace.ts`.
 */

import {
  closestMarketplaceCity,
  EGYPT_MARKETPLACE_CITIES,
  getMarketplaceCityById,
  haversineKm,
} from './egyptMarketplace';

/** Default filter: show missions from every country. */
export const MARKETPLACE_ALL_WORLD_ID = 'all_world';

/** Empty / missing city = no city constraint within the selected country. */
export const MARKETPLACE_ALL_CITIES_ID = '';

/** Legacy alias — same behaviour as All World (kept for old localStorage / props). */
export const MARKETPLACE_ALL_EGYPT_ID = 'all_egypt';

/**
 * Fallback quick-filter chips used until `location_catalog` loads.
 * Mirrors the `is_quick_region` rows in 20260726_global_location_catalog.sql.
 */
export const QUICK_REGION_COUNTRIES = [
  'United States',
  'United Arab Emirates',
  'Saudi Arabia',
  'United Kingdom',
  'Germany',
  'France',
  'Canada',
  'Australia',
  'Poland',
  'Egypt',
] as const;

/**
 * Country centroids for the quick regions, so chips can fly the camera before
 * any mission (or the DB catalog) has loaded. Full set lives in the DB.
 */
const FALLBACK_COUNTRY_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  'united states': { lat: 39.8283, lng: -98.5795 },
  'united arab emirates': { lat: 23.4241, lng: 53.8478 },
  'saudi arabia': { lat: 23.8859, lng: 45.0792 },
  'united kingdom': { lat: 55.3781, lng: -3.436 },
  germany: { lat: 51.1657, lng: 10.4515 },
  france: { lat: 46.2276, lng: 2.2137 },
  canada: { lat: 56.1304, lng: -106.3468 },
  australia: { lat: -25.2744, lng: 133.7751 },
  poland: { lat: 52.0693, lng: 19.4803 },
  egypt: { lat: 26.8206, lng: 30.8025 },
};

/**
 * Max distance from a reference city for a coordinate-only mission to be
 * attributed to it. Matches the backfill radius in the SQL migration.
 */
const REGION_SNAP_MAX_KM = 300;

export function isAllWorldFilter(id: string | null | undefined): boolean {
  return !id || id === MARKETPLACE_ALL_WORLD_ID || id === MARKETPLACE_ALL_EGYPT_ID;
}

export function isAllCitiesFilter(id: string | null | undefined): boolean {
  return !id || id === MARKETPLACE_ALL_CITIES_ID;
}

/** True when no country constraint is active (empty selection = All World). */
export function isAllWorldSelection(countryIds: readonly string[] | null | undefined): boolean {
  if (!countryIds || countryIds.length === 0) return true;
  return countryIds.every((id) => isAllWorldFilter(id));
}

/** Normalize a country prop that may be a single id or a list. */
export function toCountrySelection(
  value: string | readonly string[] | null | undefined
): string[] {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  const out: string[] = [];
  for (const raw of list) {
    const label = normLabel(raw);
    if (!label || isAllWorldFilter(label)) continue;
    if (!out.some((c) => c.toLowerCase() === label.toLowerCase())) out.push(label);
  }
  return out;
}

export type MissionGeoFields = {
  country?: string | null;
  city?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
};

/** A row from `public.location_catalog` (city `''` = country centroid). */
export type LocationCatalogRow = {
  country: string;
  countryCode?: string | null;
  city: string;
  lat: number;
  lng: number;
  isQuickRegion?: boolean;
};

/** A row from `list_mission_location_facets()`. */
export type LocationFacet = {
  country: string;
  city: string;
  missionCount: number;
  lat: number;
  lng: number;
};

export type LocationCatalog = {
  countries: string[];
  /** Cities keyed by country (or `__all__` flat list when browsing All World). */
  citiesByCountry: Record<string, string[]>;
  /** Average lat/lng of missions for each `country|city` key. */
  cityCentroids: Record<string, { lat: number; lng: number; count: number }>;
  /** Average lat/lng of missions for each country. */
  countryCentroids: Record<string, { lat: number; lng: number; count: number }>;
  /** Countries flagged as one-tap quick chips. */
  quickCountries: string[];
  /** Known mission counts (DB-wide when facets are loaded). */
  countryCounts: Record<string, number>;
  cityCounts: Record<string, number>;
  /** Reference cities used to resolve missions that have no country/city. */
  referenceCities: LocationCatalogRow[];
  /** Identity bumped whenever the reference set changes (cache invalidation). */
  revision: number;
};

const ALL_CITIES_KEY = '__all__';

function normLabel(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function humanizeHubId(id: string): string {
  return id
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function cityCentroidKey(country: string, city: string): string {
  return `${normLabel(country).toLowerCase()}|${normLabel(city).toLowerCase()}`;
}

/** Egypt hub reference rows, used when the DB catalog has not loaded yet. */
const FALLBACK_REFERENCE_CITIES: LocationCatalogRow[] = EGYPT_MARKETPLACE_CITIES.map((hub) => ({
  country: 'Egypt',
  countryCode: 'EG',
  city: humanizeHubId(hub.id),
  lat: hub.lat,
  lng: hub.lng,
  isQuickRegion: true,
}));

/**
 * Nearest reference city to a coordinate, within REGION_SNAP_MAX_KM.
 * Mirrors the nearest-city backfill/trigger logic in SQL.
 */
function nearestReferenceCity(
  lat: number,
  lng: number,
  reference: readonly LocationCatalogRow[]
): LocationCatalogRow | null {
  let best: LocationCatalogRow | null = null;
  let bestKm = Infinity;
  for (const row of reference) {
    if (!row.city) continue;
    const km = haversineKm(lat, lng, row.lat, row.lng);
    if (km < bestKm) {
      bestKm = km;
      best = row;
    }
  }
  return best && bestKm <= REGION_SNAP_MAX_KM ? best : null;
}

type ResolvedRegion = { country: string; city: string };

/**
 * Per-mission region cache. Missions are stable object refs across filter
 * re-renders, so this keeps nearest-city resolution off the hot path.
 */
const regionCache = new WeakMap<object, { revision: number; region: ResolvedRegion }>();

/**
 * Resolve a mission's country/city: stored columns first, then nearest
 * reference city by coordinates, then the legacy Egypt hub.
 */
export function resolveMissionRegion(
  mission: MissionGeoFields,
  catalog?: LocationCatalog | null
): ResolvedRegion {
  const storedCountry = normLabel(mission.country);
  const storedCity = normLabel(mission.city);
  if (storedCountry && storedCity) return { country: storedCountry, city: storedCity };

  const reference = catalog?.referenceCities?.length
    ? catalog.referenceCities
    : FALLBACK_REFERENCE_CITIES;
  const revision = catalog?.revision ?? 0;

  const cached = typeof mission === 'object' && mission ? regionCache.get(mission) : undefined;
  if (cached && cached.revision === revision) return cached.region;

  let country = storedCountry;
  let city = storedCity;

  const lat = Number(mission.location_lat);
  const lng = Number(mission.location_lng);
  if ((!country || !city) && Number.isFinite(lat) && Number.isFinite(lng)) {
    const near = nearestReferenceCity(lat, lng, reference);
    if (near) {
      if (!country) country = near.country;
      if (!city) city = near.city;
    } else {
      const hub = closestMarketplaceCity(lat, lng);
      if (hub) {
        if (!country) country = 'Egypt';
        if (!city) city = humanizeHubId(hub.id);
      }
    }
  }

  const region: ResolvedRegion = { country, city };
  if (typeof mission === 'object' && mission) {
    regionCache.set(mission, { revision, region });
  }
  return region;
}

/** Resolve display country for a mission (DB column → catalog → Egypt hub). */
export function missionCountry(
  mission: MissionGeoFields,
  catalog?: LocationCatalog | null
): string {
  return resolveMissionRegion(mission, catalog).country;
}

/** Resolve display city for a mission (DB column → catalog → Egypt hub). */
export function missionCity(
  mission: MissionGeoFields,
  catalog?: LocationCatalog | null
): string {
  return resolveMissionRegion(mission, catalog).city;
}

export type BuildLocationCatalogOptions = {
  /** Reference rows from `public.location_catalog`. */
  catalogRows?: readonly LocationCatalogRow[];
  /** DB-wide facets from `list_mission_location_facets()`. */
  facets?: readonly LocationFacet[];
};

let catalogRevision = 0;

/**
 * Build the country/city catalog from reference rows, DB-wide facets and the
 * loaded mission page. Any source alone is enough to populate the filter.
 */
export function buildLocationCatalog(
  missions: readonly MissionGeoFields[],
  options: BuildLocationCatalogOptions = {}
): LocationCatalog {
  const catalogRows = options.catalogRows ?? [];
  const facets = options.facets ?? [];

  const countrySet = new Set<string>();
  const quickSet = new Set<string>();
  const citiesByCountry: Record<string, Set<string>> = { [ALL_CITIES_KEY]: new Set() };
  const cityCentroids: LocationCatalog['cityCentroids'] = {};
  const countryCentroids: LocationCatalog['countryCentroids'] = {};
  const countryCounts: Record<string, number> = {};
  const cityCounts: Record<string, number> = {};
  const referenceCities: LocationCatalogRow[] = [];

  const addCountry = (country: string) => {
    if (!country) return;
    countrySet.add(country);
    if (!citiesByCountry[country]) citiesByCountry[country] = new Set();
  };

  const addCity = (country: string, city: string) => {
    if (!country || !city) return;
    addCountry(country);
    citiesByCountry[country].add(city);
    citiesByCountry[ALL_CITIES_KEY].add(city);
  };

  const setCentroid = (
    bucket: Record<string, { lat: number; lng: number; count: number }>,
    key: string,
    lat: number,
    lng: number,
    count: number
  ) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    bucket[key] = { lat, lng, count };
  };

  const bumpCentroid = (
    bucket: Record<string, { lat: number; lng: number; count: number }>,
    key: string,
    lat: number,
    lng: number
  ) => {
    const prev = bucket[key];
    if (!prev) {
      bucket[key] = { lat, lng, count: 1 };
      return;
    }
    const n = prev.count + 1;
    bucket[key] = {
      lat: (prev.lat * prev.count + lat) / n,
      lng: (prev.lng * prev.count + lng) / n,
      count: n,
    };
  };

  // ---- 1) Reference catalog (authoritative list + centroids) ----------------
  for (const row of catalogRows) {
    const country = normLabel(row.country);
    const city = normLabel(row.city);
    if (!country) continue;
    addCountry(country);
    if (row.isQuickRegion) quickSet.add(country);

    if (city) {
      addCity(country, city);
      referenceCities.push({ ...row, country, city });
      setCentroid(cityCentroids, cityCentroidKey(country, city), row.lat, row.lng, 0);
    } else {
      setCentroid(countryCentroids, country.toLowerCase(), row.lat, row.lng, 0);
    }
  }

  // ---- 2) DB-wide facets (counts + real mission centroids) -----------------
  for (const facet of facets) {
    const country = normLabel(facet.country);
    const city = normLabel(facet.city);
    if (!country) continue;
    addCountry(country);
    const count = Number(facet.missionCount) || 0;

    countryCounts[country.toLowerCase()] =
      (countryCounts[country.toLowerCase()] ?? 0) + count;

    if (city) {
      addCity(country, city);
      const key = cityCentroidKey(country, city);
      cityCounts[key] = (cityCounts[key] ?? 0) + count;
      // Real mission centroids beat the reference city centre.
      setCentroid(cityCentroids, key, facet.lat, facet.lng, count);
    }
    if (Number.isFinite(facet.lat) && Number.isFinite(facet.lng)) {
      const prev = countryCentroids[country.toLowerCase()];
      if (!prev || prev.count < count) {
        setCentroid(countryCentroids, country.toLowerCase(), facet.lat, facet.lng, count);
      }
    }
  }

  // ---- 3) Loaded missions (keeps optimistic/local rows visible) ------------
  const partial: LocationCatalog = {
    countries: [],
    citiesByCountry: {},
    cityCentroids: {},
    countryCentroids: {},
    quickCountries: [],
    countryCounts: {},
    cityCounts: {},
    referenceCities: referenceCities.length ? referenceCities : FALLBACK_REFERENCE_CITIES,
    revision: ++catalogRevision,
  };

  for (const mission of missions) {
    const { country, city } = resolveMissionRegion(mission, partial);
    if (!country) continue;
    addCountry(country);
    if (city) addCity(country, city);

    const lat = Number(mission.location_lat);
    const lng = Number(mission.location_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // Only fill gaps the facets RPC did not already cover.
    if (!countryCentroids[country.toLowerCase()]) {
      bumpCentroid(countryCentroids, country.toLowerCase(), lat, lng);
    }
    if (city && !cityCentroids[cityCentroidKey(country, city)]) {
      bumpCentroid(cityCentroids, cityCentroidKey(country, city), lat, lng);
    }
  }

  // ---- 4) Always offer the fallback quick regions --------------------------
  for (const region of QUICK_REGION_COUNTRIES) {
    addCountry(region);
    quickSet.add(region);
  }
  for (const hub of FALLBACK_REFERENCE_CITIES) {
    addCity(hub.country, hub.city);
  }

  const quickCountries = Array.from(quickSet);
  const quickRank = (label: string) => {
    const idx = quickCountries.findIndex((q) => q.toLowerCase() === label.toLowerCase());
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  };

  const countries = Array.from(countrySet).sort((a, b) => {
    // Populated countries first, then quick regions, then alphabetical.
    const ca = countryCounts[a.toLowerCase()] ?? 0;
    const cb = countryCounts[b.toLowerCase()] ?? 0;
    if (ca !== cb) return cb - ca;
    const qa = quickRank(a);
    const qb = quickRank(b);
    if (qa !== qb) return qa - qb;
    return a.localeCompare(b);
  });

  const citiesByCountryOut: Record<string, string[]> = {};
  for (const [key, set] of Object.entries(citiesByCountry)) {
    citiesByCountryOut[key] = Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  return {
    countries,
    citiesByCountry: citiesByCountryOut,
    cityCentroids,
    countryCentroids,
    quickCountries: quickCountries.sort((a, b) => quickRank(a) - quickRank(b)),
    countryCounts,
    cityCounts,
    referenceCities: partial.referenceCities,
    revision: partial.revision,
  };
}

/** Union of cities available for the selected countries (all when none). */
export function citiesForCountrySelection(
  catalog: LocationCatalog | null | undefined,
  countryIds: readonly string[]
): string[] {
  if (!catalog) return [];
  if (isAllWorldSelection(countryIds)) {
    return catalog.citiesByCountry[ALL_CITIES_KEY] ?? [];
  }
  const seen = new Set<string>();
  for (const country of countryIds) {
    const match = Object.keys(catalog.citiesByCountry).find(
      (key) => key !== ALL_CITIES_KEY && key.toLowerCase() === country.toLowerCase()
    );
    for (const city of (match ? catalog.citiesByCountry[match] : undefined) ?? []) {
      seen.add(city);
    }
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

/**
 * Filter missions by one or more countries plus an optional city.
 * Empty `countryIds` (or All World) means no country constraint.
 */
export function filterMissionsByCountriesCity<T extends MissionGeoFields>(
  missions: T[],
  countryIds: readonly string[] | null | undefined,
  cityId: string | null | undefined,
  catalog?: LocationCatalog | null
): T[] {
  const selection = toCountrySelection(countryIds);
  const allWorld = selection.length === 0;
  const cityFilter = normLabel(cityId);

  if (allWorld && !cityFilter) return missions;

  const wanted = new Set(selection.map((c) => c.toLowerCase()));

  return missions.filter((mission) => {
    const { country, city } = resolveMissionRegion(mission, catalog);
    if (!allWorld && (!country || !wanted.has(country.toLowerCase()))) return false;
    if (cityFilter && (!city || city.toLowerCase() !== cityFilter.toLowerCase())) return false;
    return true;
  });
}

/**
 * Single-country wrapper.
 * `countryId` = All World | country name
 */
export function filterMissionsByCountryCity<T extends MissionGeoFields>(
  missions: T[],
  countryId: string | null | undefined,
  cityId: string | null | undefined,
  catalog?: LocationCatalog | null
): T[] {
  return filterMissionsByCountriesCity(
    missions,
    toCountrySelection(countryId),
    cityId,
    catalog
  );
}

/**
 * Backward-compatible wrapper used by older call sites that only pass a hub id
 * (`all_egypt`, `cairo`, …) or the new All World id.
 */
export function filterMissionsByMarketCity<T extends MissionGeoFields>(
  missions: T[],
  cityOrWorldId: string | null | undefined
): T[] {
  if (isAllWorldFilter(cityOrWorldId)) return missions;
  const hub = getMarketplaceCityById(String(cityOrWorldId));
  if (hub) {
    // Legacy Egypt hub id → country Egypt + city label
    return filterMissionsByCountryCity(missions, 'Egypt', humanizeHubId(hub.id));
  }
  // Treat as free-text city under All World
  return filterMissionsByCountryCity(missions, MARKETPLACE_ALL_WORLD_ID, cityOrWorldId);
}

/**
 * Look up the flyTo target for the current selection.
 * A single selected country zooms to that country; several stay put unless a
 * city is chosen (there is no meaningful centroid for a multi-country set).
 */
export function resolveFilterFlyTarget(
  catalog: LocationCatalog,
  countryIds: string | readonly string[] | null | undefined,
  cityId: string | null | undefined
): { lat: number; lng: number; zoom: number } | null {
  const selection = toCountrySelection(countryIds);
  const city = normLabel(cityId);

  if (city) {
    // Prefer the selected country's own centroid for that city name.
    for (const country of selection) {
      const hit = catalog.cityCentroids[cityCentroidKey(country, city)];
      if (hit) return { lat: hit.lat, lng: hit.lng, zoom: 12.5 };
    }
    // Otherwise any country that has this city.
    for (const [key, hit] of Object.entries(catalog.cityCentroids)) {
      const [, c] = key.split('|');
      if (c === city.toLowerCase()) return { lat: hit.lat, lng: hit.lng, zoom: 12.5 };
    }
    // Seeded Egypt hub without missions yet → use hub coordinates.
    const hub = EGYPT_MARKETPLACE_CITIES.find(
      (h) => humanizeHubId(h.id).toLowerCase() === city.toLowerCase() || h.id === city.toLowerCase()
    );
    if (hub) return { lat: hub.lat, lng: hub.lng, zoom: 12.5 };
  }

  if (selection.length === 1) {
    const country = selection[0].toLowerCase();
    const hit = catalog.countryCentroids[country];
    if (hit) return { lat: hit.lat, lng: hit.lng, zoom: 5.5 };
    const seeded = FALLBACK_COUNTRY_CENTROIDS[country];
    if (seeded) return { ...seeded, zoom: 5.2 };
  }

  return null;
}
