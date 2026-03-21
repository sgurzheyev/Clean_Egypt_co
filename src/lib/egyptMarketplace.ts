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
