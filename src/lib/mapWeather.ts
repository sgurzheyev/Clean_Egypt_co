/**
 * [[Architecture_Overview.md]]
 * Lightweight simulated weather for Mapbox (debug / visual prototype).
 */

export type MapWeatherMode = 'clear' | 'sandstorm' | 'rain';

export const MAP_WEATHER_MODES: readonly MapWeatherMode[] = [
  'clear',
  'sandstorm',
  'rain',
] as const;

export const MAP_WEATHER_LABELS: Record<MapWeatherMode, string> = {
  clear: 'Clear',
  sandstorm: 'Sandstorm (High Wind)',
  rain: 'Rain',
};

const WEATHER_DEBUG_KEY = 'ce_weather_debug';

/** Dev builds always allow the panel; production needs localStorage or ?weatherDebug=1. */
export function isWeatherDebugEnabled(): boolean {
  if (typeof window === 'undefined') return !!import.meta.env.DEV;
  if (import.meta.env.DEV) return true;
  try {
    if (localStorage.getItem(WEATHER_DEBUG_KEY) === '1') return true;
  } catch {
    /* ignore */
  }
  try {
    return new URLSearchParams(window.location.search).get('weatherDebug') === '1';
  } catch {
    return false;
  }
}

export function setWeatherDebugEnabled(on: boolean) {
  try {
    if (on) localStorage.setItem(WEATHER_DEBUG_KEY, '1');
    else localStorage.removeItem(WEATHER_DEBUG_KEY);
  } catch {
    /* ignore */
  }
}

/** Dense dusty fog — distant extrusions dissolve into haze. */
export const SANDSTORM_FOG: Record<string, unknown> = {
  range: [0.15, 3.2],
  color: '#D8D0C1',
  'high-color': '#E1DACB',
  'horizon-blend': 0.42,
  'space-color': '#C5BFA9',
  'star-intensity': 0.04,
};

/** Cooler, slightly denser fog for rain without killing night stars entirely. */
export function rainFogFromBase(base: Record<string, unknown>): Record<string, unknown> {
  return {
    ...base,
    range: [0.45, 5.5],
    color: '#1e293b',
    'high-color': '#334155',
    'horizon-blend': 0.28,
    'space-color': base['space-color'] ?? '#0f172a',
    'star-intensity':
      typeof base['star-intensity'] === 'number'
        ? Math.min(0.35, Number(base['star-intensity']))
        : base['star-intensity'],
  };
}

export function applyWeatherFog(
  mode: MapWeatherMode,
  baseFog: Record<string, unknown>
): Record<string, unknown> {
  if (mode === 'sandstorm') return { ...SANDSTORM_FOG };
  if (mode === 'rain') return rainFogFromBase(baseFog);
  return baseFog;
}
