/**
 * Mapbox Standard (v3) — realistic 3D facades + night lighting for GarbaGin.
 * Shared by MapPicker, StoreCoverageMap, and other embedded maps.
 *
 * CRITICAL: Standard loads asynchronously. Never call setConfigProperty / addSource /
 * addLayer until the style is fully loaded — use whenMapStyleReady() or guard with
 * map.isStyleLoaded().
 *
 * Do NOT add a manual fill-extrusion `3d-buildings` layer — Standard already
 * ships textured 3D buildings; a custom extrusion conflicts and hides facades.
 */

export const MAPBOX_STANDARD_STYLE = 'mapbox://styles/mapbox/standard' as const;

/** Neon store coverage / pin accents — high contrast on Standard night land. */
export const DEFAULT_STORE_COLOR = '#22d3ee';
/** @deprecated Prefer DEFAULT_STORE_COLOR / per-store `color` — kept as fallback paint. */
export const STORE_COVERAGE_FILL = DEFAULT_STORE_COLOR;
export const STORE_COVERAGE_FILL_OPACITY = 0.35;
export const STORE_COVERAGE_STROKE = DEFAULT_STORE_COLOR;
export const STORE_COVERAGE_STROKE_WIDTH = 3;
export const STORE_PIN_CORE = DEFAULT_STORE_COLOR;
export const STORE_PIN_GLOW = DEFAULT_STORE_COLOR;
export const STORE_PIN_STROKE = '#ffffff';

/** Curated neon palette for store zone customization. */
export const STORE_NEON_PALETTE = [
  { id: 'cyan', hex: '#22d3ee', labelKey: 'storeColorCyan' },
  { id: 'acid', hex: '#39ff14', labelKey: 'storeColorAcid' },
  { id: 'magenta', hex: '#ff00ff', labelKey: 'storeColorMagenta' },
  { id: 'violet', hex: '#c026ff', labelKey: 'storeColorViolet' },
  { id: 'yellow', hex: '#facc15', labelKey: 'storeColorYellow' },
  { id: 'hotpink', hex: '#ff2d55', labelKey: 'storeColorHotPink' },
  { id: 'orange', hex: '#ff6b00', labelKey: 'storeColorOrange' },
  { id: 'electric', hex: '#00ffff', labelKey: 'storeColorElectric' },
] as const;

export type StoreNeonPaletteId = (typeof STORE_NEON_PALETTE)[number]['id'];

/** Normalize / validate `#RRGGBB`; falls back to DEFAULT_STORE_COLOR. */
export function normalizeStoreColor(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^[0-9A-Fa-f]{6}$/.test(raw)) return `#${raw.toLowerCase()}`;
  return DEFAULT_STORE_COLOR;
}
export type MapboxLightPreset = 'dusk' | 'dawn' | 'day' | 'night';

/**
 * Clock-band fallback when sun position is not yet available
 * (first paint / embedded maps without atmosphere).
 * Bands: night 21–6, dawn 6–8, day 8–18, dusk 18–21 (local time).
 *
 * NOTE: With monochrome theme this is only used for first-paint before
 * updateAtmosphere fires and corrects it with real sun position.
 * Always returns 'night' as a safe dark fallback outside day hours.
 */
export function resolveMapboxLightPresetByClock(
  date: Date = new Date()
): MapboxLightPreset {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 21 || h < 6) return 'night';
  if (h < 8) return 'dawn';
  if (h < 18) return 'day';
  return 'dusk';
}

/**
 * Sun-driven Standard light — night unlocks glowing facade windows;
 * low sun / civil twilight → dawn (morning) or dusk (evening); midday → day.
 *
 * Prefer `sunAltDeg` when available. Civil twilight (−6°…0°) and golden hour
 * (0°…10°) map to warm dawn/dusk presets so sky + 3D buildings tint correctly.
 */
export function resolveMapboxLightPreset(opts: {
  isNight?: boolean;
  golden?: boolean;
  /** True before local solar noon (sunrise side → dawn). */
  isMorning?: boolean;
  /** Solar altitude in degrees (−90…90). */
  sunAltDeg?: number;
}): MapboxLightPreset {
  const morning = opts.isMorning === true;
  const alt = opts.sunAltDeg;

  if (typeof alt === 'number' && Number.isFinite(alt)) {
    if (alt < -6) return 'night';
    if (alt < 0) return morning ? 'dawn' : 'dusk';
    if (alt <= 10) return morning ? 'dawn' : 'dusk';
    return 'day';
  }

  if (opts.isNight) return 'night';
  if (opts.golden) return morning ? 'dawn' : 'dusk';
  return 'day';
}

/**
 * Standard Style configuration for GarbaGin.
 * - `theme: 'monochrome'` gives a dark, desaturated basemap that renders
 *   correctly dark buildings/roads under all lightPresets (esp. night/dusk).
 *   `theme: 'default'` (photoreal) causes white-road mismatch with dark fog/sky.
 * - `lightPreset` follows local clock on first paint; MapPicker atmosphere
 *   overrides with sun-accurate dawn/day/dusk/night.
 * - 3D objects/buildings/facades stay ON (built into Standard).
 */
export const MAPBOX_STANDARD_BASEMAP_CONFIG = {
  theme: 'monochrome',
  lightPreset: resolveMapboxLightPresetByClock() as MapboxLightPreset,
  show3dObjects: true,
  show3dBuildings: true,
  show3dTrees: true,
  show3dLandmarks: true,
  show3dFacades: true,
  showPointOfInterestLabels: false,
  showTransitLabels: false,
  showPedestrianRoads: true,
} as const;

export type MapboxStyleReadyMap = {
  isStyleLoaded?: () => boolean;
  once?: (type: string, listener: (...args: unknown[]) => void) => unknown;
  on?: (type: string, listener: (...args: unknown[]) => void) => unknown;
  off?: (type: string, listener: (...args: unknown[]) => void) => unknown;
  setConfigProperty?: (importId: string, property: string, value: unknown) => void;
  getLayer?: (id: string) => unknown;
  removeLayer?: (id: string) => void;
};

/** True when the map style (incl. Standard imports) is ready for mutations. */
export function isMapStyleReady(map: MapboxStyleReadyMap | null | undefined): boolean {
  if (!map) return false;
  try {
    // When isStyleLoaded is missing, be conservative and treat as not ready.
    if (typeof map.isStyleLoaded !== 'function') return false;
    return map.isStyleLoaded() === true;
  } catch {
    return false;
  }
}

/**
 * Run `callback` only after the style has fully loaded.
 * Returns an unsubscribe/cancel function.
 */
export function whenMapStyleReady(
  map: MapboxStyleReadyMap | null | undefined,
  callback: (map: MapboxStyleReadyMap) => void
): () => void {
  if (!map) return () => undefined;

  let cancelled = false;
  let ran = false;

  const run = () => {
    if (cancelled || ran) return;
    if (!isMapStyleReady(map)) return;
    ran = true;
    try {
      callback(map);
    } catch (err) {
      console.warn('[mapbox] style-ready callback failed:', err);
    }
  };

  const onStyleLoad = () => {
    // Standard imports often need a frame after style.load before isStyleLoaded() is true.
    requestAnimationFrame(() => {
      if (cancelled) return;
      if (isMapStyleReady(map)) {
        run();
        return;
      }
      try {
        map.once?.('idle', run);
      } catch {
        /* ignore */
      }
    });
  };

  if (isMapStyleReady(map)) {
    queueMicrotask(run);
  } else {
    try {
      map.once?.('style.load', onStyleLoad);
    } catch {
      /* ignore */
    }
    try {
      // Fallback if style.load already fired before we subscribed.
      map.once?.('idle', run);
      map.once?.('load', onStyleLoad);
    } catch {
      /* ignore */
    }
  }

  return () => {
    cancelled = true;
  };
}

/**
 * Strip legacy manual fill-extrusion buildings — they fight Standard facades.
 */
export function removeLegacy3dBuildingsLayer(
  map: MapboxStyleReadyMap | null | undefined
): void {
  if (!map?.getLayer || !map.removeLayer) return;
  try {
    if (map.getLayer('3d-buildings')) {
      map.removeLayer('3d-buildings');
    }
  } catch {
    /* style may be mid-transition */
  }
}

/**
 * Apply Standard basemap config (monochrome theme + 3D facades + time-of-day light).
 * Pass `lightPreset` for sun-driven dawn/day/dusk/night; otherwise uses local clock.
 * Returns false if the style is not ready yet (caller should retry via whenMapStyleReady).
 */
export function applyMapboxStandardBasemapConfig(
  map: MapboxStyleReadyMap | null | undefined,
  overrides?: { lightPreset?: MapboxLightPreset }
): boolean {
  if (!map?.setConfigProperty) return false;
  if (!isMapStyleReady(map)) return false;

  removeLegacy3dBuildingsLayer(map);

  const config = {
    ...MAPBOX_STANDARD_BASEMAP_CONFIG,
    lightPreset: overrides?.lightPreset ?? resolveMapboxLightPresetByClock(),
  };

  for (const [key, value] of Object.entries(config)) {
    try {
      map.setConfigProperty('basemap', key, value);
    } catch {
      /* Key unsupported on this GL build, or style briefly busy — skip. */
    }
  }
  return true;
}

/**
 * Bake current clock lightPreset into the style import for first paint.
 * MapPicker atmosphere then smoothly retunes via setConfigProperty.
 */
export const MAPBOX_STANDARD_STYLE_WITH_CONFIG = {
  version: 8 as const,
  imports: [
    {
      id: 'basemap',
      url: MAPBOX_STANDARD_STYLE,
      config: {
        ...MAPBOX_STANDARD_BASEMAP_CONFIG,
        lightPreset: resolveMapboxLightPresetByClock(),
      },
    },
  ],
  sources: {},
  layers: [],
};
