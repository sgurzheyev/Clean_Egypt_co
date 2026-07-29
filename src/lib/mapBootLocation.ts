/**
 * Resolve the first-paint map center before Mapbox mounts.
 * Prefers GPS; falls back to Cairo (Egypt marketplace hub).
 */
import { MAP_FALLBACK_CENTER } from './mapEgyptTheme';

export type BootMapOrigin = {
  lat: number;
  lng: number;
  fromGps: boolean;
  accuracy?: number;
};

const GPS_TIMEOUT_MS = 9000;
const GPS_MAX_AGE_MS = 120_000;

export function resolveBootMapLocation(): Promise<BootMapOrigin> {
  const fallback: BootMapOrigin = {
    lat: MAP_FALLBACK_CENTER.lat,
    lng: MAP_FALLBACK_CENTER.lng,
    fromGps: false,
  };

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(fallback);
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          resolve(fallback);
          return;
        }
        resolve({
          lat,
          lng,
          fromGps: true,
          accuracy: Number.isFinite(pos.coords.accuracy)
            ? pos.coords.accuracy
            : undefined,
        });
      },
      (err) => {
        console.info(
          '[map-boot] geolocation unavailable — Cairo fallback',
          err?.code
        );
        resolve(fallback);
      },
      {
        enableHighAccuracy: false,
        timeout: GPS_TIMEOUT_MS,
        maximumAge: GPS_MAX_AGE_MS,
      }
    );
  });
}
