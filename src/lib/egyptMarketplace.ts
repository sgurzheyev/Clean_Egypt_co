/** Approximate centers for marketplace city filter (Egypt) */

export type MarketplaceCity = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusKm: number;
};

export const MARKETPLACE_REGION_EGYPT = 'egypt';

export const EGYPT_MARKETPLACE_CITIES: MarketplaceCity[] = [
  { id: 'cairo', name: 'Cairo', lat: 30.0444, lng: 31.2357, radiusKm: 55 },
  { id: 'hurghada', name: 'Hurghada', lat: 27.2579, lng: 33.8116, radiusKm: 45 },
  { id: 'alexandria', name: 'Alexandria', lat: 31.2001, lng: 29.9182, radiusKm: 45 },
  { id: 'luxor', name: 'Luxor', lat: 25.6872, lng: 32.6396, radiusKm: 35 },
  { id: 'giza', name: 'Giza', lat: 30.0131, lng: 31.2089, radiusKm: 40 },
];

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

function formatAreaLabel(lat: number, lng: number): string {
  const latHem = lat >= 0 ? 'N' : 'S';
  const lngHem = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${latHem}, ${Math.abs(lng).toFixed(2)}°${lngHem}`;
}

/**
 * Build the city filter list from missions currently on the marketplace.
 * Known Egypt hubs appear when a mission falls inside their radius; missions
 * elsewhere (e.g. Abu Simbel) get a dynamic cluster entry so they remain filterable.
 */
export function deriveMarketplaceCitiesFromJobs(jobs: MissionCoords[]): MarketplaceCity[] {
  const usedKnownIds = new Set<string>();
  const dynamic: MarketplaceCity[] = [];

  for (const job of jobs) {
    const lat = job.location_lat;
    const lng = job.location_lng;
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const known = EGYPT_MARKETPLACE_CITIES.find((c) => missionWithinCity(lat, lng, c));
    if (known) {
      usedKnownIds.add(known.id);
      continue;
    }

    const existingCluster = dynamic.find(
      (c) => haversineKm(lat, lng, c.lat, c.lng) <= c.radiusKm
    );
    if (existingCluster) continue;

    dynamic.push({
      id: `loc-${lat.toFixed(3)}-${lng.toFixed(3)}`,
      name: formatAreaLabel(lat, lng),
      lat,
      lng,
      radiusKm: 30,
    });
  }

  const known = EGYPT_MARKETPLACE_CITIES.filter((c) => usedKnownIds.has(c.id));
  return [...known, ...dynamic].sort((a, b) => a.name.localeCompare(b.name));
}
