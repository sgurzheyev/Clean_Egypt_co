/** Fixed marketplace city hubs (Egypt) — closest-city grouping for market filter */

export const MARKETPLACE_REGION_EGYPT = 'egypt';

/** Dropdown value: show every open mission regardless of coordinates */
export const MARKETPLACE_ALL_EGYPT_ID = 'all_egypt';

export type MarketplaceCity = {
  id: string;
  /** i18n key, e.g. `marketplaceCity_cairo` */
  nameKey: string;
  lat: number;
  lng: number;
  /** @deprecated Closest-city assignment replaces strict radius filtering */
  radiusKm?: number;
};

/** Major Egyptian hubs — always shown in the city dropdown (not derived from missions). */
export const EGYPT_MARKETPLACE_CITIES: MarketplaceCity[] = [
  { id: 'cairo', nameKey: 'marketplaceCity_cairo', lat: 30.0444, lng: 31.2357 },
  { id: 'giza', nameKey: 'marketplaceCity_giza', lat: 30.0131, lng: 31.2089 },
  { id: 'alexandria', nameKey: 'marketplaceCity_alexandria', lat: 31.2001, lng: 29.9182 },
  { id: 'hurghada', nameKey: 'marketplaceCity_hurghada', lat: 27.2579, lng: 33.8116 },
  { id: 'sharm_el_sheikh', nameKey: 'marketplaceCity_sharm_el_sheikh', lat: 27.9158, lng: 34.33 },
  { id: 'luxor', nameKey: 'marketplaceCity_luxor', lat: 25.6872, lng: 32.6396 },
  { id: 'aswan', nameKey: 'marketplaceCity_aswan', lat: 24.0889, lng: 32.8998 },
  { id: 'ismailia', nameKey: 'marketplaceCity_ismailia', lat: 30.5965, lng: 32.2715 },
  { id: 'port_said', nameKey: 'marketplaceCity_port_said', lat: 31.2653, lng: 32.3019 },
  { id: 'suez', nameKey: 'marketplaceCity_suez', lat: 29.9668, lng: 32.5498 },
  { id: 'mansoura', nameKey: 'marketplaceCity_mansoura', lat: 31.0409, lng: 31.3785 },
  { id: 'tanta', nameKey: 'marketplaceCity_tanta', lat: 30.7865, lng: 31.0004 },
  { id: 'asyut', nameKey: 'marketplaceCity_asyut', lat: 27.1783, lng: 31.1859 },
];

export function getMarketplaceCityById(id: string): MarketplaceCity | undefined {
  return EGYPT_MARKETPLACE_CITIES.find((c) => c.id === id);
}

export function isValidMarketCityId(id: string): boolean {
  return id === MARKETPLACE_ALL_EGYPT_ID || EGYPT_MARKETPLACE_CITIES.some((c) => c.id === id);
}

/** Great-circle distance between two WGS84 points, in kilometres */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Nearest predefined hub for a mission coordinate (no radius cutoff). */
export function closestMarketplaceCity(
  lat: number | null | undefined,
  lng: number | null | undefined
): MarketplaceCity | null {
  if (lat == null || lng == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  let best: MarketplaceCity | null = null;
  let bestDist = Infinity;

  for (const city of EGYPT_MARKETPLACE_CITIES) {
    const d = haversineKm(lat, lng, city.lat, city.lng);
    if (d < bestDist) {
      bestDist = d;
      best = city;
    }
  }

  return best;
}

export function missionAssignedCityId(
  missionLat: number | null | undefined,
  missionLng: number | null | undefined
): string | null {
  return closestMarketplaceCity(missionLat, missionLng)?.id ?? null;
}

type MissionCoords = {
  location_lat?: number | null;
  location_lng?: number | null;
};

/** Filter missions by closest hub city (or all Egypt). */
export function filterMissionsByMarketCity<T extends MissionCoords>(
  missions: T[],
  cityId: string | null | undefined
): T[] {
  if (!cityId) return [];
  if (cityId === MARKETPLACE_ALL_EGYPT_ID) return missions;

  const city = getMarketplaceCityById(cityId);
  if (!city) return [];

  return missions.filter(
    (m) => missionAssignedCityId(m.location_lat, m.location_lng) === city.id
  );
}
