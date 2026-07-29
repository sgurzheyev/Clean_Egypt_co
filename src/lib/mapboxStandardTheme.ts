/**
 * Mapbox Standard (v3) — monochrome dusk basemap for cyberpunk / dark-steel UI.
 * Shared by MapPicker, StoreCoverageMap, and other embedded maps.
 *
 * CRITICAL: Standard loads asynchronously. Never call setConfigProperty / addSource /
 * addLayer until the style is fully loaded — use whenMapStyleReady() or guard with
 * map.isStyleLoaded().
 */

export const MAPBOX_STANDARD_STYLE = 'mapbox://styles/mapbox/standard' as const;

/** Neon store coverage / pin accents — high contrast on dusk monochrome land. */
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
 * Dynamic Standard light — never lock to pitch-black `night` (store overlays vanish).
 * Night → dusk (readable amber noir); golden hour → dawn; midday → day.
 */
export function resolveMapboxLightPreset(opts: {
  isNight: boolean;
  golden: boolean;
}): MapboxLightPreset {
  if (opts.isNight) return 'dusk';
  if (opts.golden) return 'dawn';
  return 'day';
}

/** Dark steel & silver noir overrides + 3D / cleanliness toggles. */
export const MAPBOX_STANDARD_BASEMAP_CONFIG = {
  theme: 'monochrome',
  /** Default until sun-driven atmosphere overrides — dusk keeps land readable. */
  lightPreset: 'dusk' as MapboxLightPreset,
  colorLand: '#141416',
  colorWater: '#1a1f24',
  colorGreenspace: '#111416',
  colorBuildings: '#2a2e33',
  colorMotorways: '#c0c5cc',
  colorTrunks: '#a8aeb6',
  colorRoads: '#8a9099',
  colorPlaceLabels: '#e0e4e8',
  colorRoadLabels: '#b8bec6',
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
 * Apply steel-noir Standard basemap config.
 * Pass `lightPreset` to restore sun-driven dawn/day/dusk without flashing pitch-black night.
 * Returns false if the style is not ready yet (caller should retry via whenMapStyleReady).
 */
export function applyMapboxStandardBasemapConfig(
  map: MapboxStyleReadyMap | null | undefined,
  overrides?: { lightPreset?: MapboxLightPreset }
): boolean {
  if (!map?.setConfigProperty) return false;
  if (!isMapStyleReady(map)) return false;

  const config = {
    ...MAPBOX_STANDARD_BASEMAP_CONFIG,
    ...(overrides?.lightPreset ? { lightPreset: overrides.lightPreset } : null),
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
 * Prefer the plain Standard URL + whenMapStyleReady config application.
 * Kept for callers that still reference the import wrapper; prefer MAPBOX_STANDARD_STYLE.
 */
export const MAPBOX_STANDARD_STYLE_WITH_CONFIG = {
  version: 8 as const,
  imports: [
    {
      id: 'basemap',
      url: MAPBOX_STANDARD_STYLE,
      config: { ...MAPBOX_STANDARD_BASEMAP_CONFIG },
    },
  ],
  sources: {},
  layers: [],
};
