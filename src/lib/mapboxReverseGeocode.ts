import { closestMarketplaceCity } from './egyptMarketplace';

export type PinLocationContext = {
  areaName: string;
  closestCityId: string;
  closestCityNameKey: string;
};

/** Reverse-geocode coordinates via Mapbox; returns a local area label + nearest hub city. */
export async function reverseGeocodePinLocation(
  lat: number,
  lng: number,
  accessToken: string | undefined
): Promise<PinLocationContext | null> {
  if (!accessToken || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const closest = closestMarketplaceCity(lat, lng);
  if (!closest) return null;

  try {
    const url = new URL(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json`
    );
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('language', 'en');
    url.searchParams.set('types', 'neighborhood,locality,place,village');
    url.searchParams.set('limit', '5');

    const res = await fetch(url.toString());
    if (!res.ok) return fallbackContext(closest);

    const data = (await res.json()) as {
      features?: Array<{ text?: string; place_name?: string; place_type?: string[] }>;
    };

    const features = data.features ?? [];
    const areaFeature =
      features.find((f) =>
        f.place_type?.some((t) =>
          ['neighborhood', 'locality', 'place', 'village'].includes(t)
        )
      ) ?? features[0];

    const areaName = String(areaFeature?.text ?? areaFeature?.place_name ?? '').trim();
    if (!areaName) return fallbackContext(closest);

    return {
      areaName,
      closestCityId: closest.id,
      closestCityNameKey: closest.nameKey,
    };
  } catch {
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
