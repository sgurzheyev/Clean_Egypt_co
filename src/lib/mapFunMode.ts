/**
 * GarbaGin fun / cartoon map mode — stylized land, neon roads, punchier glow.
 * Persisted in localStorage. Does NOT add property-price / real-estate HUD.
 */

import { isMapStyleReady, type MapboxStyleReadyMap } from './mapboxStandardTheme';

export const FUN_MAP_MODE_STORAGE_KEY = 'ce_fun_map_mode';
export const LIVE_MAP_TRAFFIC_STORAGE_KEY = 'ce_live_map_traffic';

export const FUN_NEON_CYAN = '#22d3ee';
export const FUN_NEON_VIOLET = '#8b5cf6';

export const FUN_STREETS_SOURCE_ID = 'fun-map-streets';
export const FUN_ROADS_GLOW_LAYER_ID = 'fun-roads-glow';
export const FUN_ROADS_CORE_LAYER_ID = 'fun-roads-core';
export const FUN_ROADS_MAJOR_LAYER_ID = 'fun-roads-major';

/**
 * Simplified high-contrast land tokens for Mapbox Standard fun mode.
 * Roads are app-palette cyan / violet so they read as emissive against dark land.
 */
export const MAPBOX_STANDARD_FUN_LAND_COLORS = {
  colorLand: '#10241c',
  colorWater: '#063042',
  colorGreenspace: '#145c38',
  colorCommercial: '#1a2438',
  colorEducation: '#18243a',
  colorMedical: '#241830',
  colorIndustrial: '#141c28',
  colorRoads: FUN_NEON_CYAN,
  colorMotorways: FUN_NEON_VIOLET,
  colorTrunks: '#a78bfa',
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
  return readFlag(FUN_MAP_MODE_STORAGE_KEY, false);
}

export function writeFunMapMode(on: boolean): void {
  writeFlag(FUN_MAP_MODE_STORAGE_KEY, on);
}

export function readLiveMapTraffic(): boolean {
  return readFlag(LIVE_MAP_TRAFFIC_STORAGE_KEY, false);
}

export function writeLiveMapTraffic(on: boolean): void {
  writeFlag(LIVE_MAP_TRAFFIC_STORAGE_KEY, on);
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
    '#a78bfa',
    'trunk_link',
    '#a78bfa',
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

export function readAisstreamApiKey(): string {
  try {
    const env = (import.meta as { env?: Record<string, unknown> }).env;
    return String(env?.VITE_AISSTREAM_API_KEY || '').trim();
  } catch {
    return '';
  }
}

export function hasAisstreamApiKey(): boolean {
  return readAisstreamApiKey().length > 8;
}
