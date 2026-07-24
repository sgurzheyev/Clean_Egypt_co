/**
 * Global country / city marketplace filter for worldwide mission pins.
 * Complements the legacy Egypt hub helpers in `egyptMarketplace.ts`.
 */

import {
  closestMarketplaceCity,
  EGYPT_MARKETPLACE_CITIES,
  getMarketplaceCityById,
} from './egyptMarketplace';

/** Default filter: show missions from every country. */
export const MARKETPLACE_ALL_WORLD_ID = 'all_world';

/** Empty / missing city = no city constraint within the selected country. */
export const MARKETPLACE_ALL_CITIES_ID = '';

/** Legacy alias — same behaviour as All World (kept for old localStorage / props). */
export const MARKETPLACE_ALL_EGYPT_ID = 'all_egypt';

/** Quick-filter chips shown when those countries appear in (or are seeded into) the catalog. */
export const QUICK_REGION_COUNTRIES = [
  'United States',
  'Poland',
  'Egypt',
] as const;

export function isAllWorldFilter(id: string | null | undefined): boolean {
  return !id || id === MARKETPLACE_ALL_WORLD_ID || id === MARKETPLACE_ALL_EGYPT_ID;
}

export function isAllCitiesFilter(id: string | null | undefined): boolean {
  return !id || id === MARKETPLACE_ALL_CITIES_ID;
}

export type MissionGeoFields = {
  country?: string | null;
  city?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
};

export type LocationCatalog = {
  countries: string[];
  /** Cities keyed by country (or `__all__` flat list when browsing All World). */
  citiesByCountry: Record<string, string[]>;
  /** Average lat/lng of missions for each `country|city` key. */
  cityCentroids: Record<string, { lat: number; lng: number; count: number }>;
  /** Average lat/lng of missions for each country. */
  countryCentroids: Record<string, { lat: number; lng: number; count: number }>;
};

const ALL_CITIES_KEY = '__all__';

function normLabel(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Resolve display country for a mission (DB column → Egypt hub fallback). */
export function missionCountry(mission: MissionGeoFields): string {
  const fromDb = normLabel(mission.country);
  if (fromDb) return fromDb;
  const hub = closestMarketplaceCity(mission.location_lat, mission.location_lng);
  if (hub) return 'Egypt';
  return '';
}

/** Resolve display city for a mission (DB column → Egypt hub fallback). */
export function missionCity(mission: MissionGeoFields): string {
  const fromDb = normLabel(mission.city);
  if (fromDb) return fromDb;
  const hub = closestMarketplaceCity(mission.location_lat, mission.location_lng);
  if (hub) {
    // Prefer humanized id: cairo → Cairo
    return hub.id
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  return '';
}

export function cityCentroidKey(country: string, city: string): string {
  return `${normLabel(country).toLowerCase()}|${normLabel(city).toLowerCase()}`;
}

/** Build country/city catalog + centroids from loaded mission rows. */
export function buildLocationCatalog(missions: MissionGeoFields[]): LocationCatalog {
  const countrySet = new Set<string>();
  const citiesByCountry: Record<string, Set<string>> = { [ALL_CITIES_KEY]: new Set() };
  const cityCentroids: LocationCatalog['cityCentroids'] = {};
  const countryCentroids: LocationCatalog['countryCentroids'] = {};

  const bump = (
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

  for (const m of missions) {
    const country = missionCountry(m);
    const city = missionCity(m);
    const lat = Number(m.location_lat);
    const lng = Number(m.location_lng);
    if (!country) continue;

    countrySet.add(country);
    if (!citiesByCountry[country]) citiesByCountry[country] = new Set();
    if (city) {
      citiesByCountry[country].add(city);
      citiesByCountry[ALL_CITIES_KEY].add(city);
    }

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      bump(countryCentroids, country.toLowerCase(), lat, lng);
      if (city) bump(cityCentroids, cityCentroidKey(country, city), lat, lng);
    }
  }

  // Seed active regions + Egypt hubs so empty catalogs still show useful quick filters.
  for (const region of QUICK_REGION_COUNTRIES) {
    countrySet.add(region);
    if (!citiesByCountry[region]) citiesByCountry[region] = new Set();
  }
  for (const hub of EGYPT_MARKETPLACE_CITIES) {
    const label = hub.id
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    citiesByCountry['Egypt'].add(label);
  }

  const countries = Array.from(countrySet).sort((a, b) => {
    const ai = QUICK_REGION_COUNTRIES.findIndex(
      (c) => c.toLowerCase() === a.toLowerCase()
    );
    const bi = QUICK_REGION_COUNTRIES.findIndex(
      (c) => c.toLowerCase() === b.toLowerCase()
    );
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }
    return a.localeCompare(b);
  });
  const citiesByCountryOut: Record<string, string[]> = {};
  for (const [k, set] of Object.entries(citiesByCountry)) {
    citiesByCountryOut[k] = Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  return { countries, citiesByCountry: citiesByCountryOut, cityCentroids, countryCentroids };
}

/**
 * Filter missions by country + city.
 * `countryId` = All World | country name
 * `cityId` = '' | All Cities | city name (scoped to country when country selected)
 */
export function filterMissionsByCountryCity<T extends MissionGeoFields>(
  missions: T[],
  countryId: string | null | undefined,
  cityId: string | null | undefined
): T[] {
  const allWorld = isAllWorldFilter(countryId);
  const cityFilter = normLabel(cityId);
  const countryFilter = normLabel(countryId);

  if (allWorld && !cityFilter) return missions;

  return missions.filter((m) => {
    const ctry = missionCountry(m);
    const city = missionCity(m);

    if (!allWorld) {
      if (!ctry || ctry.toLowerCase() !== countryFilter.toLowerCase()) return false;
    }
    if (cityFilter) {
      if (!city || city.toLowerCase() !== cityFilter.toLowerCase()) return false;
    }
    return true;
  });
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
    const hubCity = hub.id
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    return filterMissionsByCountryCity(missions, 'Egypt', hubCity);
  }
  // Treat as free-text city under All World
  return filterMissionsByCountryCity(missions, MARKETPLACE_ALL_WORLD_ID, cityOrWorldId);
}

/** Approximate centroids for quick-region chips when no missions exist yet. */
const SEEDED_COUNTRY_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  'united states': { lat: 39.8283, lng: -98.5795 },
  poland: { lat: 52.0693, lng: 19.4803 },
  egypt: { lat: 26.8206, lng: 30.8025 },
};

/** Look up flyTo target for a selected country/city. */
export function resolveFilterFlyTarget(
  catalog: LocationCatalog,
  countryId: string | null | undefined,
  cityId: string | null | undefined
): { lat: number; lng: number; zoom: number } | null {
  const city = normLabel(cityId);
  const country = normLabel(countryId);

  if (city && country && !isAllWorldFilter(country)) {
    const hit = catalog.cityCentroids[cityCentroidKey(country, city)];
    if (hit) return { lat: hit.lat, lng: hit.lng, zoom: 12.5 };
  }
  if (city) {
    // Search any country for this city name
    for (const [key, hit] of Object.entries(catalog.cityCentroids)) {
      const [, c] = key.split('|');
      if (c === city.toLowerCase()) return { lat: hit.lat, lng: hit.lng, zoom: 12.5 };
    }
    // Seeded Egypt hub without missions yet → use hub coordinates.
    if (!country || country.toLowerCase() === 'egypt' || isAllWorldFilter(country)) {
      const hub = EGYPT_MARKETPLACE_CITIES.find((h) => {
        const label = h.id
          .split('_')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
        return label.toLowerCase() === city.toLowerCase() || h.id === city.toLowerCase();
      });
      if (hub) return { lat: hub.lat, lng: hub.lng, zoom: 12.5 };
    }
  }
  if (country && !isAllWorldFilter(country)) {
    const hit = catalog.countryCentroids[country.toLowerCase()];
    if (hit) return { lat: hit.lat, lng: hit.lng, zoom: 5.5 };
    const seeded = SEEDED_COUNTRY_CENTROIDS[country.toLowerCase()];
    if (seeded) return { ...seeded, zoom: 5.2 };
  }
  return null;
}
