/**
 * GarbaGin fun / cartoon map mode — stylized land, neon roads, punchier glow.
 * Persisted in localStorage. Does NOT add property-price / real-estate HUD.
 */

import { isMapStyleReady, type MapboxStyleReadyMap } from './mapboxStandardTheme';

export const FUN_MAP_MODE_STORAGE_KEY = 'ce_fun_map_mode';
export const LIVE_MAP_TRAFFIC_STORAGE_KEY = 'ce_live_map_traffic';
export const RUSH_CRAFT_MODE_STORAGE_KEY = 'ce_rush_craft_mode';

/** Pink FAB cycle: off → ships → planes → off. */
export type RushCraftMode = 'off' | 'ships' | 'planes';

export function isRushCraftMode(value: unknown): value is RushCraftMode {
  return value === 'off' || value === 'ships' || value === 'planes';
}

export function cycleRushCraftMode(current: RushCraftMode): RushCraftMode {
  if (current === 'off') return 'ships';
  if (current === 'ships') return 'planes';
  return 'off';
}

export function isRushLandOn(mode: RushCraftMode): boolean {
  return mode !== 'off';
}

export const FUN_NEON_CYAN = '#22d3ee';
/** Motorways stay cyan-forward (H2H night) so they do not compete with amber ships. */
export const FUN_NEON_VIOLET = '#67e8f9';

export const FUN_STREETS_SOURCE_ID = 'fun-map-streets';
export const FUN_ROADS_GLOW_LAYER_ID = 'fun-roads-glow';
export const FUN_ROADS_CORE_LAYER_ID = 'fun-roads-core';
export const FUN_ROADS_MAJOR_LAYER_ID = 'fun-roads-major';

/**
 * RUSH / fun-mode land tokens — cinematic night (H2H Move): dark navy land,
 * muted mountain greens, cyan road glow. Off-mode uses Standard dark slate.
 */
export const MAPBOX_STANDARD_FUN_LAND_COLORS = {
  colorLand: '#0a1018',
  colorWater: '#050b12',
  colorGreenspace: '#15241c',
  colorCommercial: '#121820',
  colorEducation: '#121820',
  colorMedical: '#16141c',
  colorIndustrial: '#0e141c',
  colorRoads: FUN_NEON_CYAN,
  colorMotorways: FUN_NEON_VIOLET,
  colorTrunks: '#38bdf8',
  colorRoadLabels: '#e0f2fe',
} as const;

function readFlag(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw !== '0' && raw !== 'false';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* private mode / quota */
  }
}

export function readFunMapMode(): boolean {
  return isRushLandOn(readRushCraftMode());
}

export function writeFunMapMode(on: boolean): void {
  writeFlag(FUN_MAP_MODE_STORAGE_KEY, on);
}

export function readLiveMapTraffic(): boolean {
  return isRushLandOn(readRushCraftMode());
}

export function writeLiveMapTraffic(on: boolean): void {
  writeFlag(LIVE_MAP_TRAFFIC_STORAGE_KEY, on);
}

function readStoredString(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readRushCraftMode(): RushCraftMode {
  const stored = readStoredString(RUSH_CRAFT_MODE_STORAGE_KEY);
  if (isRushCraftMode(stored)) return stored;
  // Pre-cycle RUSH used two booleans; treat "on" as ships (first step).
  if (readFlag(FUN_MAP_MODE_STORAGE_KEY, false) || readFlag(LIVE_MAP_TRAFFIC_STORAGE_KEY, false)) {
    return 'ships';
  }
  return 'off';
}

export function writeRushCraftMode(mode: RushCraftMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RUSH_CRAFT_MODE_STORAGE_KEY, mode);
  } catch {
    /* private mode / quota */
  }
  writeFunMapMode(isRushLandOn(mode));
  writeLiveMapTraffic(isRushLandOn(mode));
}

type FunRoadMap = MapboxStyleReadyMap & {
  getSource?: (id: string) => unknown;
  addSource?: (id: string, source: Record<string, unknown>) => void;
  addLayer?: (layer: Record<string, unknown>) => void;
  setLayoutProperty?: (layerId: string, name: string, value: unknown) => void;
  setPaintProperty?: (layerId: string, name: string, value: unknown) => void;
  getLayer?: (id: string) => unknown;
};

function safePaint(map: FunRoadMap, layerId: string, prop: string, value: unknown) {
  try {
    map.setPaintProperty?.(layerId, prop, value);
  } catch {
    /* ignore */
  }
}

function safeLayout(map: FunRoadMap, layerId: string, prop: string, value: unknown) {
  try {
    map.setLayoutProperty?.(layerId, prop, value);
  } catch {
    /* ignore */
  }
}

const MAJOR_ROAD_FILTER: unknown[] = [
  'in',
  ['get', 'class'],
  ['literal', ['motorway', 'trunk', 'primary', 'motorway_link', 'trunk_link']],
];

const MINOR_ROAD_FILTER: unknown[] = [
  'all',
  ['!=', ['get', 'class'], 'ferry'],
  ['!=', ['get', 'class'], 'aerialway'],
  ['!=', ['get', 'class'], 'path'],
];

function roadColorExpr(major: boolean): unknown[] {
  return [
    'match',
    ['get', 'class'],
    'motorway',
    FUN_NEON_VIOLET,
    'motorway_link',
    FUN_NEON_VIOLET,
    'trunk',
    '#38bdf8',
    'trunk_link',
    '#38bdf8',
    'primary',
    FUN_NEON_CYAN,
    major ? FUN_NEON_VIOLET : FUN_NEON_CYAN,
  ];
}

/**
 * Overlay emissive violet/cyan roads from Streets v8 (sits in Standard `middle` slot).
 * Safe to call repeatedly; no-ops if the style is not ready.
 */
export function ensureFunNeonRoadLayers(map: FunRoadMap | null | undefined): boolean {
  if (!map || !isMapStyleReady(map)) return false;

  try {
    if (!map.getSource?.(FUN_STREETS_SOURCE_ID)) {
      map.addSource?.(FUN_STREETS_SOURCE_ID, {
        type: 'vector',
        url: 'mapbox://mapbox.mapbox-streets-v8',
      });
    }
  } catch (e) {
    console.warn('[fun-map] streets source failed', e);
    return false;
  }

  const glowPaint = {
    'line-color': roadColorExpr(false),
    'line-width': [
      'interpolate',
      ['linear'],
      ['zoom'],
      6,
      1.2,
      10,
      4,
      14,
      10,
      17,
      16,
    ],
    'line-opacity': 0.42,
    'line-blur': 2.4,
  };

  const corePaint = {
    'line-color': roadColorExpr(false),
    'line-width': [
      'interpolate',
      ['linear'],
      ['zoom'],
      6,
      0.4,
      10,
      1.2,
      14,
      2.4,
      17,
      3.6,
    ],
    'line-opacity': 0.88,
    'line-blur': 0.15,
  };

  const majorPaint = {
    'line-color': roadColorExpr(true),
    'line-width': [
      'interpolate',
      ['linear'],
      ['zoom'],
      5,
      1.4,
      10,
      3.2,
      14,
      5.5,
      17,
      8,
    ],
    'line-opacity': 0.95,
    'line-blur': 0.2,
  };

  const addLine = (
    id: string,
    filter: unknown,
    paint: Record<string, unknown>,
    minzoom: number
  ) => {
    if (map.getLayer?.(id)) return;
    try {
      map.addLayer?.({
        id,
        type: 'line',
        source: FUN_STREETS_SOURCE_ID,
        'source-layer': 'road',
        slot: 'middle',
        minzoom,
        filter,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
          visibility: 'none',
        },
        paint,
      });
    } catch (e) {
      console.warn(`[fun-map] layer ${id} failed`, e);
    }
  };

  addLine(FUN_ROADS_GLOW_LAYER_ID, MINOR_ROAD_FILTER, glowPaint, 7);
  addLine(FUN_ROADS_CORE_LAYER_ID, MINOR_ROAD_FILTER, corePaint, 10);
  addLine(FUN_ROADS_MAJOR_LAYER_ID, MAJOR_ROAD_FILTER, majorPaint, 5);
  return true;
}

export function setFunNeonRoadLayersVisible(
  map: FunRoadMap | null | undefined,
  visible: boolean
): void {
  if (!map) return;
  const vis = visible ? 'visible' : 'none';
  for (const id of [
    FUN_ROADS_GLOW_LAYER_ID,
    FUN_ROADS_CORE_LAYER_ID,
    FUN_ROADS_MAJOR_LAYER_ID,
  ]) {
    safeLayout(map, id, 'visibility', vis);
  }
}

/** Collapse expensive glow blur while the camera is moving. */
export function setFunNeonRoadLayersBusy(
  map: FunRoadMap | null | undefined,
  busy: boolean
): void {
  if (!map) return;
  if (busy) {
    safePaint(map, FUN_ROADS_GLOW_LAYER_ID, 'line-blur', 0);
    safePaint(map, FUN_ROADS_GLOW_LAYER_ID, 'line-opacity', 0.16);
    safePaint(map, FUN_ROADS_CORE_LAYER_ID, 'line-opacity', 0.55);
  } else {
    safePaint(map, FUN_ROADS_GLOW_LAYER_ID, 'line-blur', 2.4);
    safePaint(map, FUN_ROADS_GLOW_LAYER_ID, 'line-opacity', 0.42);
    safePaint(map, FUN_ROADS_CORE_LAYER_ID, 'line-opacity', 0.88);
  }
}

/** Env-var names / dummy values accidentally baked as VITE_AISSTREAM_API_KEY. */
const AISSTREAM_KEY_PLACEHOLDERS = new Set([
  '',
  'undefined',
  'null',
  'none',
  'n/a',
  'na',
  'changeme',
  'your_api_key',
  'your-api-key',
  'vite_aisstream_api_key',
  'supabase_service_role_key',
  'service_role',
  'sk_live',
  'sk_test',
]);

/**
 * True when a baked AISStream value is a real key, not an empty string or a
 * placeholder name (e.g. `SUPABASE_SERVICE_ROLE_KEY` pasted into Vercel).
 */
export function isUsableAisstreamApiKey(raw: string): boolean {
  const key = String(raw || '').trim();
  if (key.length < 16) return false;
  if (AISSTREAM_KEY_PLACEHOLDERS.has(key.toLowerCase())) return false;
  // ALL_CAPS_SNAKE env names pasted as the value (not a UUID/token).
  if (/^[A-Z][A-Z0-9_]{8,}$/.test(key)) return false;
  return true;
}

export function readAisstreamApiKey(): string {
  try {
    const env = (import.meta as { env?: Record<string, unknown> }).env;
    return String(env?.VITE_AISSTREAM_API_KEY || '').trim();
  } catch {
    return '';
  }
}

export function hasAisstreamApiKey(): boolean {
  return isUsableAisstreamApiKey(readAisstreamApiKey());
}
