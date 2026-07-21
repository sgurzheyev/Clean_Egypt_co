/**
 * Open-Meteo current weather → visual MapWeatherMode mapping.
 * @see https://open-meteo.com/en/docs
 */
import type { MapWeatherMode } from './mapWeather';

export type WeatherControlMode = 'auto' | MapWeatherMode;

// UI-exposed controls: only Auto (Live) and Clear. Sandstorm/rain are still
// reachable automatically via Auto (Open-Meteo), just not as manual force buttons.
export const WEATHER_CONTROL_MODES: readonly WeatherControlMode[] = [
  'auto',
  'clear',
] as const;

export const WEATHER_CONTROL_LABELS: Record<WeatherControlMode, string> = {
  auto: 'Auto (Live)',
  clear: 'Clear',
  sandstorm: 'Sandstorm (High Wind)',
  rain: 'Rain',
};

/**
 * Map Open-Meteo current_weather fields to our visual modes.
 * - windspeed is km/h by default; 36 km/h ≈ 10 m/s high wind → sandstorm
 * - WMO codes 51–67 drizzle/rain, 80–82 rain showers → rain
 */
export function weatherModeFromOpenMeteo(
  windspeedKmh: number,
  weathercode: number
): MapWeatherMode {
  const wind = Number(windspeedKmh);
  const code = Math.floor(Number(weathercode));

  if (Number.isFinite(wind) && wind > 36) {
    return 'sandstorm';
  }

  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    return 'rain';
  }

  return 'clear';
}

export type OpenMeteoCurrentWeather = {
  temperature?: number;
  windspeed?: number;
  winddirection?: number;
  weathercode?: number;
  time?: string;
};

export async function fetchOpenMeteoCurrent(
  latitude: number,
  longitude: number,
  signal?: AbortSignal
): Promise<{ mode: MapWeatherMode; current: OpenMeteoCurrentWeather }> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set('current_weather', 'true');

  const res = await fetch(url.toString(), { signal });
  if (!res.ok) {
    throw new Error(`Open-Meteo HTTP ${res.status}`);
  }

  const data = (await res.json()) as { current_weather?: OpenMeteoCurrentWeather };
  const current = data.current_weather || {};
  const mode = weatherModeFromOpenMeteo(
    Number(current.windspeed ?? 0),
    Number(current.weathercode ?? 0)
  );
  return { mode, current };
}
