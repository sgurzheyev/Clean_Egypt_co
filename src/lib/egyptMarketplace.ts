/** Fixed marketplace city hubs (Egypt) — radius grouping for Global Market filter */

export const MARKETPLACE_REGION_EGYPT = 'egypt';

/** Dropdown value: show every open mission regardless of coordinates */
export const MARKETPLACE_ALL_EGYPT_ID = 'all_egypt';

/** Default grouping radius when filtering missions by selected city */
export const DEFAULT_MARKETPLACE_RADIUS_KM = 50;

export type MarketplaceCity = {
  id: string;
  /** i18n key, e.g. `marketplaceCity_cairo` */
  nameKey: string;
  lat: number;
  lng: number;
  radiusKm: number;
};

/** Major Egyptian hubs — always shown in the city dropdown (not derived from missions). */
export const EGYPT_MARKETPLACE_CITIES: MarketplaceCity[] = [
  { id: 'cairo', nameKey: 'marketplaceCity_cairo', lat: 30.0444, lng: 31.2357, radiusKm: DEFAULT_MARKETPLACE_RADIUS_KM },
  { id: 'giza', nameKey: 'marketplaceCity_giza', lat: 30.0131, lng: 31.2089, radiusKm: DEFAULT_MARKETPLACE_RADIUS_KM },
  { id: 'alexandria', nameKey: 'marketplaceCity_alexandria', lat: 31.2001, lng: 29.9182, radiusKm: DEFAULT_MARKETPLACE_RADIUS_KM },
  { id: 'hurghada', nameKey: 'marketplaceCity_hurghada', lat: 27.2579, lng: 33.8116, radiusKm: DEFAULT_MARKETPLACE_RADIUS_KM },
  { id: 'sharm_el_sheikh', nameKey: 'marketplaceCity_sharm_el_sheikh', lat: 27.9158, lng: 34.3300, radiusKm: DEFAULT_MARKETPLACE_RADIUS_KM },
  { id: 'luxor', nameKey: 'marketplaceCity_luxor', lat: 25.6872, lng: 32.6396, radiusKm: DEFAULT_MARKETPLACE_RADIUS_KM },
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

export function missionWithinCity(
  missionLat: number | null | undefined,
  missionLng: number | null | undefined,
  city: MarketplaceCity
): boolean {
  if (missionLat == null || missionLng == null) return false;
  if (!Number.isFinite(missionLat) || !Number.isFinite(missionLng)) return false;
  const d = haversineKm(missionLat, missionLng, city.lat, city.lng);
  return d <= city.radiusKm;
}

type MissionCoords = {
  location_lat?: number | null;
  location_lng?: number | null;
};

/** Filter missions for Global Market by fixed city id (or all Egypt). */
export function filterMissionsByMarketCity<T extends MissionCoords>(
  missions: T[],
  cityId: string | null | undefined
): T[] {
  if (!cityId) return [];
  if (cityId === MARKETPLACE_ALL_EGYPT_ID) return missions;

  const city = getMarketplaceCityById(cityId);
  if (!city) return [];

  return missions.filter((m) =>
    missionWithinCity(m.location_lat, m.location_lng, city)
  );
}
