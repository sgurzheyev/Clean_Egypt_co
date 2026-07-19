import { closestMarketplaceCity } from './egyptMarketplace';

export type PinLocationContext = {
  areaName: string;
  closestCityId: string;
  closestCityNameKey: string;
};

/**
 * Reverse-geocode coordinates via Mapbox Geocoding v5.
 *
 * Notes (422 gotchas):
 * - `types` must be known values only (no `village`).
 * - Reverse geocode + `limit` requires a *single* type — so we omit `limit`
 *   when requesting several place types and pick the best feature client-side.
 */
export async function reverseGeocodePinLocation(
  lat: number,
  lng: number,
  accessToken: string | undefined
): Promise<PinLocationContext | null> {
  if (!accessToken || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const closest = closestMarketplaceCity(lat, lng);
  if (!closest) return null;

  try {
    // Path must be "lng,lat" (longitude first).
    const url = new URL(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(`${lng},${lat}`)}.json`
    );
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('language', 'en');
    // Valid v5 types only — `village` is NOT valid and causes HTTP 422.
    url.searchParams.set('types', 'neighborhood,locality,place');

    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn('[reverseGeocode] Mapbox HTTP', res.status, await res.text().catch(() => ''));
      return fallbackContext(closest);
    }

    const data = (await res.json()) as {
      features?: Array<{ text?: string; place_name?: string; place_type?: string[] }>;
    };

    const features = data.features ?? [];
    const preference = ['neighborhood', 'locality', 'place'] as const;
    let areaFeature = features[0];
    for (const pref of preference) {
      const hit = features.find((f) => f.place_type?.includes(pref));
      if (hit) {
        areaFeature = hit;
        break;
      }
    }

    const areaName = String(areaFeature?.text ?? areaFeature?.place_name ?? '').trim();
    if (!areaName) return fallbackContext(closest);

    return {
      areaName,
      closestCityId: closest.id,
      closestCityNameKey: closest.nameKey,
    };
  } catch (e) {
    console.warn('[reverseGeocode] failed:', e);
    return fallbackContext(closest);
  }
}

function fallbackContext(closest: NonNullable<ReturnType<typeof closestMarketplaceCity>>) {
  return {
    areaName: '',
    closestCityId: closest.id,
    closestCityNameKey: closest.nameKey,
  };
}

/** Build the readable location line prepended to mission descriptions. */
export function formatPinLocationTag(
  ctx: PinLocationContext,
  translateCity: (nameKey: string) => string,
  locationLabel: string
): string {
  const cityLabel = translateCity(ctx.closestCityNameKey);
  const areaLabel = ctx.areaName.trim();
  if (!areaLabel || areaLabel === ctx.closestCityNameKey) {
    return `📍 ${locationLabel}: near ${cityLabel}`;
  }
  return `📍 ${locationLabel}: ${areaLabel}, near ${cityLabel}`;
}
