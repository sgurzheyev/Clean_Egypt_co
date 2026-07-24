import { closestMarketplaceCity } from './egyptMarketplace';

export type PinLocationContext = {
  areaName: string;
  closestCityId: string;
  closestCityNameKey: string;
  /**
   * Free-form place/region/country from Mapbox (preferred for global pins).
   * When set, location tags use this instead of translating an Egypt hub key.
   */
  placeLabel?: string;
  /** Country display name from Mapbox (e.g. "United States"). */
  country?: string;
  /** City / place display name from Mapbox (e.g. "Santa Barbara"). */
  city?: string;
};

/**
 * Reverse-geocode coordinates via Mapbox Geocoding v5.
 * Accepts any valid WGS84 coordinate worldwide.
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
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  /** Soft Egypt hub only when the pin is near the marketplace network. */
  const closest = closestMarketplaceCity(lat, lng);

  try {
    // Path must be "lng,lat" (longitude first).
    const url = new URL(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(`${lng},${lat}`)}.json`
    );
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('language', 'en');
    // Valid v5 types — include region/country for international pins.
    url.searchParams.set('types', 'neighborhood,locality,place,district,region,country');

    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn('[reverseGeocode] Mapbox HTTP', res.status, await res.text().catch(() => ''));
      return fallbackContext(closest, lat, lng);
    }

    const data = (await res.json()) as {
      features?: Array<{ text?: string; place_name?: string; place_type?: string[] }>;
    };

    const features = data.features ?? [];
    const pick = (type: string) => features.find((f) => f.place_type?.includes(type));

    const areaPreference = ['neighborhood', 'locality', 'place', 'district'] as const;
    let areaFeature = features[0];
    for (const pref of areaPreference) {
      const hit = pick(pref);
      if (hit) {
        areaFeature = hit;
        break;
      }
    }

    const placeFeature = pick('place') ?? pick('locality') ?? pick('district');
    const regionFeature = pick('region');
    const countryFeature = pick('country');

    const areaName = String(areaFeature?.text ?? areaFeature?.place_name ?? '').trim();
    const cityName = String(placeFeature?.text ?? '').trim();
    const countryName = String(countryFeature?.text ?? '').trim();
    const placeParts = [cityName || placeFeature?.text, regionFeature?.text, countryName]
      .map((s) => String(s ?? '').trim())
      .filter(Boolean);
    // Deduplicate consecutive repeats (e.g. locality === place).
    const placeLabel = placeParts
      .filter((part, i, arr) => i === 0 || part.toLowerCase() !== arr[i - 1].toLowerCase())
      .join(', ');

    const country =
      countryName ||
      (closest ? 'Egypt' : '');
    const city =
      cityName ||
      (closest
        ? closest.id
            .split('_')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ')
        : areaName && areaName !== countryName
          ? areaName
          : '');

    if (!areaName && !placeLabel && !closest && !country) {
      return fallbackContext(null, lat, lng);
    }

    return {
      areaName: areaName || placeLabel,
      placeLabel: placeLabel || areaName || undefined,
      closestCityId: closest?.id ?? '',
      closestCityNameKey: closest?.nameKey ?? '',
      country: country || undefined,
      city: city || undefined,
    };
  } catch (e) {
    console.warn('[reverseGeocode] failed:', e);
    return fallbackContext(closest, lat, lng);
  }
}

function fallbackContext(
  closest: NonNullable<ReturnType<typeof closestMarketplaceCity>> | null,
  lat?: number,
  lng?: number
): PinLocationContext {
  if (closest) {
    const city = closest.id
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    return {
      areaName: '',
      closestCityId: closest.id,
      closestCityNameKey: closest.nameKey,
      country: 'Egypt',
      city,
    };
  }
  const coordLabel =
    lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
      ? `${lat.toFixed(4)}, ${lng.toFixed(4)}`
      : '';
  return {
    areaName: coordLabel,
    placeLabel: coordLabel || undefined,
    closestCityId: '',
    closestCityNameKey: '',
  };
}

/** Build the readable location line prepended to mission descriptions. */
export function formatPinLocationTag(
  ctx: PinLocationContext,
  translateCity: (nameKey: string) => string,
  locationLabel: string
): string {
  const placeFromMapbox = String(ctx.placeLabel ?? '').trim();
  const hubLabel = ctx.closestCityNameKey ? translateCity(ctx.closestCityNameKey) : '';
  const areaLabel = ctx.areaName.trim();

  if (placeFromMapbox) {
    if (!areaLabel || areaLabel === placeFromMapbox) {
      return `📍 ${locationLabel}: ${placeFromMapbox}`;
    }
    // Avoid duplicating when area is already the first segment of placeLabel.
    if (placeFromMapbox.toLowerCase().startsWith(areaLabel.toLowerCase())) {
      return `📍 ${locationLabel}: ${placeFromMapbox}`;
    }
    return `📍 ${locationLabel}: ${areaLabel}, ${placeFromMapbox}`;
  }

  if (!hubLabel && !areaLabel) {
    return `📍 ${locationLabel}`;
  }
  if (!hubLabel) {
    return `📍 ${locationLabel}: ${areaLabel}`;
  }
  if (!areaLabel || areaLabel === ctx.closestCityNameKey) {
    return `📍 ${locationLabel}: near ${hubLabel}`;
  }
  return `📍 ${locationLabel}: ${areaLabel}, near ${hubLabel}`;
}
