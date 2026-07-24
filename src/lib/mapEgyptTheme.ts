/**
 * Cyberpunk steel-grey Mapbox restyle — graphite land, deep steel water, chrome roads.
 * UI chrome / branding colors are intentionally untouched (map canvas only).
 */

/** Graphite building extrusions for 3D terminal look. */
export const EGYPT_BUILDING_COLORS = [
  '#2A2A30',
  '#323238',
  '#3A3A42',
  '#26262C',
  '#34343C',
  '#2E2E34',
  '#383840',
  '#242428',
] as const;

/**
 * Variety across buildings via height modulo (stable per feature, no random()).
 * Mapbox expression — use as fill-extrusion-color.
 */
export const egyptBuildingExtrusionColorExpr: unknown[] = [
  'match',
  [
    '%',
    ['to-number', ['coalesce', ['get', 'height'], ['get', 'min_height'], 0]],
    EGYPT_BUILDING_COLORS.length,
  ],
  0,
  EGYPT_BUILDING_COLORS[0],
  1,
  EGYPT_BUILDING_COLORS[1],
  2,
  EGYPT_BUILDING_COLORS[2],
  3,
  EGYPT_BUILDING_COLORS[3],
  4,
  EGYPT_BUILDING_COLORS[4],
  5,
  EGYPT_BUILDING_COLORS[5],
  6,
  EGYPT_BUILDING_COLORS[6],
  EGYPT_BUILDING_COLORS[7],
];

/** Fallback when height is missing: type-based graphite tones. */
export const egyptBuildingColorByTypeExpr: unknown[] = [
  'match',
  ['downcase', ['to-string', ['coalesce', ['get', 'type'], '']]],
  'residential',
  '#2A2A30',
  'apartments',
  '#323238',
  'house',
  '#2E2E34',
  'commercial',
  '#3A3A42',
  'retail',
  '#34343C',
  'industrial',
  '#242428',
  'mosque',
  '#303036',
  'church',
  '#303036',
  'hotel',
  '#323238',
  '#2A2A30',
];

export const egyptBuildingExtrusionPaint = {
  'fill-extrusion-color': [
    'case',
    ['>', ['to-number', ['coalesce', ['get', 'height'], 0]], 0],
    egyptBuildingExtrusionColorExpr,
    egyptBuildingColorByTypeExpr,
  ],
  'fill-extrusion-height': ['get', 'height'],
  'fill-extrusion-base': ['get', 'min_height'],
  'fill-extrusion-opacity': 0.72,
  'fill-extrusion-vertical-gradient': true,
  'fill-extrusion-ambient-occlusion-intensity': 0.45,
  'fill-extrusion-ambient-occlusion-radius': 2.8,
} as const;

/** Chrome / steel road colors. */
export const EGYPT_ROAD_COLOR = '#8B909A';
export const EGYPT_ROAD_MAJOR_COLOR = '#C5CAD3';
export const EGYPT_ROAD_GLOW_COLOR = '#A8ADB8';

/** Deep royal marine blue (far from coast / deep bathymetry). */
export const MAP_WATER_DEEP = '#1A1A2E';
/** Mid marine transition. */
export const MAP_WATER_MID = '#1E5A72';
/** Clear turquoise shallows / coastline. */
export const MAP_WATER_SHALLOW = '#40E0D0';
export const MAP_WATER_TURQUOISE = '#00CED1';

/** @deprecated alias — deep sea base. Prefer MAP_WATER_DEEP / depth exprs. */
export const MAP_STEEL_WATER = MAP_WATER_DEEP;
/** Brighter sheen used for the flickering metallic overlay. */
export const MAP_STEEL_WATER_SHEEN = '#2A3355';
export const MAP_STEEL_WATERWAY = '#3D6A7A';
export const MAP_STEEL_WATERWAY_GLOW = '#40E0D0';
export const MAP_GRAPHITE_LAND = '#202025';

/**
 * True depth gradient from Mapbox Bathymetry v2 (`min_depth`, meters).
 * Shallows → turquoise; abyss → deep royal marine.
 */
export const mapBathymetryColorExpr: unknown[] = [
  'interpolate',
  ['cubic-bezier', 0, 0.45, 0.55, 1],
  ['to-number', ['coalesce', ['get', 'min_depth'], 7000]],
  0,
  MAP_WATER_SHALLOW,
  25,
  MAP_WATER_TURQUOISE,
  80,
  '#2AA8B8',
  200,
  '#1E7A92',
  500,
  MAP_WATER_MID,
  1200,
  '#1A4560',
  3000,
  '#1A3048',
  7000,
  MAP_WATER_DEEP,
];

/**
 * Zoom proxy for Streets `water` polygons (bathymetry tiles end ~z7).
 * Stays marine-deep offshore; lifts toward turquoise at coastal working zooms.
 */
export const mapWaterZoomColorExpr: unknown[] = [
  'interpolate',
  ['linear'],
  ['zoom'],
  4,
  MAP_WATER_DEEP,
  7,
  '#1A2740',
  10,
  '#1A3A55',
  12,
  '#1C4F68',
  14,
  '#1E6A80',
  16,
  '#228FA0',
  18,
  '#2AB0BE',
];

/** Soft turquoise wash — kept light so satellite reefs stay readable under glass water. */
export const mapWaterShallowsOpacityExpr: unknown[] = [
  'interpolate',
  ['linear'],
  ['zoom'],
  8,
  0.02,
  10,
  0.06,
  12,
  0.1,
  14,
  0.14,
  16,
  0.18,
  18,
  0.22,
];

/**
 * Glass water body opacity — semi-transparent so desaturated satellite
 * (coral / shallows) can ghost through, while deep gunmetal still reads.
 * Target band: ~0.60–0.75.
 */
export const mapWaterGlassOpacityExpr: unknown[] = [
  'interpolate',
  ['linear'],
  ['zoom'],
  5,
  0.75,
  9,
  0.72,
  12,
  0.68,
  14,
  0.64,
  16,
  0.62,
  18,
  0.6,
];

/**
 * Bathymetry opacity by depth: shallows more transparent (reef peek),
 * abyss richer / darker.
 */
export const mapBathymetryGlassOpacityExpr: unknown[] = [
  'interpolate',
  ['linear'],
  ['to-number', ['coalesce', ['get', 'min_depth'], 7000]],
  0,
  0.42,
  50,
  0.55,
  200,
  0.65,
  1000,
  0.72,
  4000,
  0.78,
  7000,
  0.82,
];

/** Satellite underlay — slightly stronger at coastal zooms for ghost-coral read. */
export const mapSatelliteGlassOpacityExpr: unknown[] = [
  'interpolate',
  ['linear'],
  ['zoom'],
  8,
  0.28,
  11,
  0.36,
  13,
  0.44,
  15,
  0.52,
  17,
  0.58,
];

/**
 * Geolocate / report-mode cinematic camera.
 * `essential: true` keeps the animation running under Mapbox's reduced-motion
 * policies so mobile Chrome doesn't skip frames mid-gesture.
 */
export const MAP_CINEMATIC_FLY = {
  zoom: 17,
  pitch: 60,
  duration: 1600,
  essential: true,
  curve: 1.42,
  speed: 1.15,
  maxDuration: 2200,
} as const;

/** Shorter fly used when opening a mission / feed pin. */
export const MAP_QUICK_FLY = {
  zoom: 16,
  pitch: 60,
  duration: 1100,
  essential: true,
  curve: 1.4,
  speed: 1.2,
  maxDuration: 1600,
} as const;

type FlyableMap = {
  flyTo?: (options: Record<string, unknown>) => void;
  easeTo?: (options: Record<string, unknown>) => void;
};

/** Unified flyTo / easeTo with mobile-safe duration curves. */
export function flyMapTo(
  map: FlyableMap | null | undefined,
  center: [number, number],
  options?: Record<string, unknown> & { ease?: boolean }
) {
  if (!map) return;
  const { ease, ...rest } = options || {};
  const payload = {
    ...MAP_CINEMATIC_FLY,
    ...rest,
    center,
    essential: true,
  };
  try {
    if (ease && typeof map.easeTo === 'function') {
      map.easeTo(payload);
    } else {
      map.flyTo?.(payload);
    }
  } catch {
    /* map disposing */
  }
}

export const egyptRoadLineColorExpr: unknown[] = [
  'match',
  ['get', 'class'],
  'motorway',
  EGYPT_ROAD_MAJOR_COLOR,
  'trunk',
  EGYPT_ROAD_MAJOR_COLOR,
  'primary',
  '#B4B9C4',
  'secondary',
  EGYPT_ROAD_COLOR,
  'tertiary',
  EGYPT_ROAD_COLOR,
  'street',
  '#7A7F88',
  'path',
  '#6E737C',
  EGYPT_ROAD_COLOR,
];

type MapLike = {
  getLayer?: (id: string) => unknown;
  getStyle?: () => { layers?: Array<{ id?: string; type?: string; 'source-layer'?: string }> };
  setPaintProperty?: (layerId: string, name: string, value: unknown) => void;
  addLayer?: (layer: Record<string, unknown>, beforeId?: string) => void;
};

function safePaint(map: MapLike, layerId: string, prop: string, value: unknown) {
  try {
    map.setPaintProperty?.(layerId, prop, value);
  } catch {
    /* property unsupported on this runtime */
  }
}

/**
 * Apply Egypt/Orient paint after style load (buildings + road/line layers).
 * Safe to call multiple times; creates `3d-buildings` if missing.
 */
export function applyEgyptMapTheme(map: MapLike, options?: { beforeLayerId?: string }) {
  const beforeId = options?.beforeLayerId ?? 'place_label';

  // --- 3D building extrusions ---
  if (!map.getLayer?.('3d-buildings')) {
    try {
      map.addLayer?.(
        {
          id: '3d-buildings',
          source: 'composite',
          'source-layer': 'building',
          filter: ['==', 'extrude', 'true'],
          type: 'fill-extrusion',
          minzoom: 13,
          paint: { ...egyptBuildingExtrusionPaint },
        },
        beforeId
      );
    } catch (e) {
      console.warn('[applyEgyptMapTheme] add 3d-buildings failed', e);
    }
  } else {
    for (const [prop, value] of Object.entries(egyptBuildingExtrusionPaint)) {
      safePaint(map, '3d-buildings', prop, value);
    }
  }

  // Optional foundation tint (supported on newer Mapbox GL only).
  safePaint(map, '3d-buildings', 'fill-extrusion-base-color', '#1E1E22');

  // --- Road / border / admin lines ---
  const style = map.getStyle?.();
  const layers = style?.layers || [];

  for (const layer of layers) {
    const id = layer?.id;
    if (!id || typeof id !== 'string') continue;
    if (layer.type !== 'line') continue;

    const sourceLayer = String(layer['source-layer'] || '');
    const idLower = id.toLowerCase();

    const isRoad =
      sourceLayer === 'road' ||
      idLower.includes('road') ||
      idLower.includes('bridge') ||
      idLower.includes('tunnel') ||
      idLower === 'neon-roads' ||
      idLower === 'neon-roads-glow';

    const isAdminBorder =
      sourceLayer === 'admin' ||
      idLower.includes('admin') ||
      idLower.includes('boundary') ||
      idLower.includes('border');

    if (isRoad) {
      if (idLower.includes('glow')) {
        safePaint(map, id, 'line-color', EGYPT_ROAD_GLOW_COLOR);
        safePaint(map, id, 'line-opacity', 0.22);
      } else if (idLower === 'neon-roads' || idLower.includes('motorway') || idLower.includes('trunk')) {
        safePaint(map, id, 'line-color', EGYPT_ROAD_MAJOR_COLOR);
        safePaint(map, id, 'line-opacity', 0.8);
      } else {
        safePaint(map, id, 'line-color', egyptRoadLineColorExpr);
        safePaint(map, id, 'line-opacity', 0.82);
      }
    } else if (isAdminBorder) {
      safePaint(map, id, 'line-color', '#6E737C');
      safePaint(map, id, 'line-opacity', 0.4);
    }
  }
}

type WaterFlickerMap = MapLike & {
  hasImage?: (id: string) => boolean;
  addImage?: (
    id: string,
    image:
      | HTMLCanvasElement
      | ImageData
      | ImageBitmap
      | { width: number; height: number; data: Uint8Array | Uint8ClampedArray },
    options?: { pixelRatio?: number }
  ) => void;
  getSource?: (id: string) => unknown;
  addSource?: (id: string, source: Record<string, unknown>) => void;
  getCanvas?: () => HTMLCanvasElement | undefined;
  setLayoutProperty?: (layerId: string, name: string, value: unknown) => void;
  on?: (type: string, listener: (...args: unknown[]) => void) => void;
  off?: (type: string, listener: (...args: unknown[]) => void) => void;
  isMoving?: () => boolean;
  isZooming?: () => boolean;
  isRotating?: () => boolean;
};

function safeLayout(map: WaterFlickerMap, layerId: string, prop: string, value: unknown) {
  try {
    map.setLayoutProperty?.(layerId, prop, value);
  } catch {
    /* ignore */
  }
}

export type MetallicWaterController = {
  cancel: () => void;
  /** Pause sheen/noise RAF + hide costly water overlays while the camera moves. */
  setCameraBusy: (busy: boolean) => void;
};

const WATER_NOISE_IMAGE_ID = 'ce-water-metal-noise';
const WATER_FLICKER_LAYER_ID = 'water-metallic-flicker';
const WATER_TEXTURE_LAYER_ID = 'water-metallic-texture';
const WATER_BATHYMETRY_SOURCE_ID = 'mapbox-bathymetry';
const WATER_BATHYMETRY_LAYER_ID = 'water-bathymetry';
const WATER_SHALLOWS_LAYER_ID = 'water-shallows';
const WATER_SHORE_GLOW_LAYER_ID = 'water-shore-glow';

/** Procedural gunmetal noise tile for Mapbox `fill-pattern`. */
function buildWaterMetalNoiseImage(): {
  width: number;
  height: number;
  data: Uint8Array;
} {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    const n = Math.random();
    const cool = n > 0.82;
    data[i] = cool ? 70 + Math.floor(n * 40) : 22 + Math.floor(n * 28);
    data[i + 1] = cool ? 80 + Math.floor(n * 35) : 26 + Math.floor(n * 30);
    data[i + 2] = cool ? 120 + Math.floor(n * 50) : 48 + Math.floor(n * 42);
    data[i + 3] = cool ? 90 + Math.floor(n * 80) : 40 + Math.floor(n * 50);
  }
  return { width: size, height: size, data };
}

/**
 * Depth-based water gradient (bathymetry + zoom/shallows/shore) plus the
 * existing metallic sheen/noise flicker. Sheen/noise paint updates are deferred
 * while the camera is busy so flyTo stays near 60 FPS on mobile.
 */
export function ensureMetallicWaterEffect(map: WaterFlickerMap): MetallicWaterController {
  try {
    if (!map.hasImage?.(WATER_NOISE_IMAGE_ID)) {
      map.addImage?.(WATER_NOISE_IMAGE_ID, buildWaterMetalNoiseImage(), { pixelRatio: 2 });
    }
  } catch (e) {
    console.warn('[ensureMetallicWaterEffect] addImage failed', e);
  }

  // Bathymetry source — true ocean depth (available ~z0–7).
  try {
    if (!map.getSource?.(WATER_BATHYMETRY_SOURCE_ID)) {
      map.addSource?.(WATER_BATHYMETRY_SOURCE_ID, {
        type: 'vector',
        url: 'mapbox://mapbox.mapbox-bathymetry-v2',
      });
    }
  } catch (e) {
    console.warn('[ensureMetallicWaterEffect] bathymetry source failed', e);
  }

  const beforeWater = map.getLayer?.('water') ? 'water' : undefined;
  const beforeId = map.getLayer?.('place_label') ? 'place_label' : undefined;
  const textureBefore = map.getLayer?.(WATER_FLICKER_LAYER_ID)
    ? WATER_FLICKER_LAYER_ID
    : beforeId;

  if (!map.getLayer?.(WATER_BATHYMETRY_LAYER_ID) && map.getSource?.(WATER_BATHYMETRY_SOURCE_ID)) {
    try {
      map.addLayer?.(
        {
          id: WATER_BATHYMETRY_LAYER_ID,
          type: 'fill',
          source: WATER_BATHYMETRY_SOURCE_ID,
          'source-layer': 'depth',
          maxzoom: 8,
          paint: {
            'fill-color': mapBathymetryColorExpr,
            'fill-opacity': mapBathymetryGlassOpacityExpr,
          },
        },
        beforeWater
      );
    } catch (e) {
      console.warn('[ensureMetallicWaterEffect] bathymetry layer failed', e);
    }
  } else if (map.getLayer?.(WATER_BATHYMETRY_LAYER_ID)) {
    safePaint(map, WATER_BATHYMETRY_LAYER_ID, 'fill-color', mapBathymetryColorExpr);
    safePaint(map, WATER_BATHYMETRY_LAYER_ID, 'fill-opacity', mapBathymetryGlassOpacityExpr);
  }

  // Streets water — zoom proxy gradient + glass opacity for coral peek-through.
  safePaint(map, 'water', 'fill-color', mapWaterZoomColorExpr);
  safePaint(map, 'water', 'fill-opacity', mapWaterGlassOpacityExpr);
  safePaint(map, 'satellite-base', 'raster-opacity', mapSatelliteGlassOpacityExpr);

  if (!map.getLayer?.(WATER_SHALLOWS_LAYER_ID)) {
    try {
      map.addLayer?.(
        {
          id: WATER_SHALLOWS_LAYER_ID,
          type: 'fill',
          source: 'composite',
          'source-layer': 'water',
          paint: {
            'fill-color': MAP_WATER_SHALLOW,
            'fill-opacity': mapWaterShallowsOpacityExpr,
          },
        },
        map.getLayer?.(WATER_TEXTURE_LAYER_ID)
          ? WATER_TEXTURE_LAYER_ID
          : map.getLayer?.(WATER_FLICKER_LAYER_ID)
            ? WATER_FLICKER_LAYER_ID
            : beforeId
      );
    } catch (e) {
      console.warn('[ensureMetallicWaterEffect] shallows layer failed', e);
    }
  } else {
    safePaint(map, WATER_SHALLOWS_LAYER_ID, 'fill-color', MAP_WATER_SHALLOW);
    safePaint(map, WATER_SHALLOWS_LAYER_ID, 'fill-opacity', mapWaterShallowsOpacityExpr);
  }

  // Turquoise shoreline band — reads as shallow water hugging the coast.
  if (!map.getLayer?.(WATER_SHORE_GLOW_LAYER_ID)) {
    try {
      map.addLayer?.(
        {
          id: WATER_SHORE_GLOW_LAYER_ID,
          type: 'line',
          source: 'composite',
          'source-layer': 'water',
          paint: {
            'line-color': MAP_WATER_TURQUOISE,
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              8,
              1.5,
              12,
              6,
              16,
              14,
            ],
            'line-opacity': [
              'interpolate',
              ['linear'],
              ['zoom'],
              8,
              0.15,
              12,
              0.35,
              16,
              0.55,
            ],
            'line-blur': [
              'interpolate',
              ['linear'],
              ['zoom'],
              8,
              1,
              12,
              4,
              16,
              8,
            ],
          },
        },
        map.getLayer?.(WATER_FLICKER_LAYER_ID) ? WATER_FLICKER_LAYER_ID : beforeId
      );
    } catch (e) {
      console.warn('[ensureMetallicWaterEffect] shore glow failed', e);
    }
  }

  if (!map.getLayer?.(WATER_TEXTURE_LAYER_ID)) {
    try {
      if (map.hasImage?.(WATER_NOISE_IMAGE_ID)) {
        map.addLayer?.(
          {
            id: WATER_TEXTURE_LAYER_ID,
            type: 'fill',
            source: 'composite',
            'source-layer': 'water',
            paint: {
              'fill-pattern': WATER_NOISE_IMAGE_ID,
              'fill-opacity': 0.12,
            },
          },
          textureBefore
        );
      }
    } catch (e) {
      console.warn('[ensureMetallicWaterEffect] texture layer failed', e);
    }
  }

  if (!map.getLayer?.(WATER_FLICKER_LAYER_ID)) {
    try {
      map.addLayer?.(
        {
          id: WATER_FLICKER_LAYER_ID,
          type: 'fill',
          source: 'composite',
          'source-layer': 'water',
          paint: {
            'fill-color': MAP_STEEL_WATER_SHEEN,
            'fill-opacity': 0.08,
          },
        },
        beforeId
      );
    } catch (e) {
      console.warn('[ensureMetallicWaterEffect] flicker layer failed', e);
    }
  }

  safePaint(map, 'waterway-glow', 'line-color', MAP_STEEL_WATERWAY_GLOW);
  safePaint(map, 'waterway-core', 'line-color', MAP_STEEL_WATERWAY);
  safePaint(map, WATER_FLICKER_LAYER_ID, 'fill-color', MAP_STEEL_WATER_SHEEN);

  let raf = 0;
  let cancelled = false;
  let cameraBusy = false;
  let frameSkip = 0;
  /** Idle sheen updates ~12 Hz — enough shimmer, far cheaper than every paint frame. */
  const IDLE_FRAME_STRIDE = 5;

  const applySheen = (t: number) => {
    const a = 0.5 + 0.5 * Math.sin(t / 2400);
    const b = 0.5 + 0.5 * Math.sin(t / 5100 + 1.2);
    const sheenOpacity = 0.04 + 0.06 * a + 0.03 * b;
    const textureOpacity = 0.08 + 0.06 * b;
    safePaint(map, WATER_FLICKER_LAYER_ID, 'fill-opacity', sheenOpacity);
    safePaint(map, WATER_TEXTURE_LAYER_ID, 'fill-opacity', textureOpacity);
  };

  const tick = (t: number) => {
    if (cancelled) return;
    if (cameraBusy) {
      raf = requestAnimationFrame(tick);
      return;
    }
    frameSkip = (frameSkip + 1) % IDLE_FRAME_STRIDE;
    if (frameSkip === 0) applySheen(t);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const setCameraBusy = (busy: boolean) => {
    if (cameraBusy === busy) return;
    cameraBusy = busy;
    if (busy) {
      // Hide pattern/sheen fills and collapse expensive shoreline blur during fly/pan.
      safeLayout(map, WATER_TEXTURE_LAYER_ID, 'visibility', 'none');
      safeLayout(map, WATER_FLICKER_LAYER_ID, 'visibility', 'none');
      safePaint(map, WATER_SHORE_GLOW_LAYER_ID, 'line-blur', 0);
      safePaint(map, WATER_SHORE_GLOW_LAYER_ID, 'line-opacity', 0.12);
      safePaint(map, 'neon-roads-glow', 'line-blur', 0);
      safePaint(map, 'neon-roads-glow', 'line-opacity', 0.08);
      safePaint(map, 'terrain-hillshade', 'hillshade-exaggeration', 0.15);
    } else {
      safeLayout(map, WATER_TEXTURE_LAYER_ID, 'visibility', 'visible');
      safeLayout(map, WATER_FLICKER_LAYER_ID, 'visibility', 'visible');
      safePaint(map, WATER_SHORE_GLOW_LAYER_ID, 'line-blur', [
        'interpolate',
        ['linear'],
        ['zoom'],
        8,
        1,
        12,
        4,
        16,
        8,
      ]);
      safePaint(map, WATER_SHORE_GLOW_LAYER_ID, 'line-opacity', [
        'interpolate',
        ['linear'],
        ['zoom'],
        8,
        0.15,
        12,
        0.35,
        16,
        0.55,
      ]);
      safePaint(map, 'neon-roads-glow', 'line-blur', 1.5);
      safePaint(map, 'neon-roads-glow', 'line-opacity', 0.22);
      safePaint(map, 'terrain-hillshade', 'hillshade-exaggeration', [
        'interpolate',
        ['linear'],
        ['zoom'],
        8,
        0.25,
        14,
        0.65,
      ]);
      applySheen(performance.now());
    }
  };

  return {
    cancel: () => {
      cancelled = true;
      cameraBusy = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    setCameraBusy,
  };
}

type PerfBudgetMap = WaterFlickerMap & {
  once?: (type: string, listener: (...args: unknown[]) => void) => void;
};

/**
 * Pause heavy water / glow work for the duration of camera motion, then restore
 * on the next idle tick. Returns an unsubscribe that must run on unmount.
 */
export function bindMapRenderBudget(
  map: PerfBudgetMap,
  getWater: () => MetallicWaterController | null | undefined,
  onBusyChange?: (busy: boolean) => void
): () => void {
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let busy = false;

  const setBusy = (next: boolean) => {
    if (busy === next) return;
    busy = next;
    getWater()?.setCameraBusy(next);
    onBusyChange?.(next);
  };

  const markBusy = () => {
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    setBusy(true);
  };

  const markSettling = () => {
    if (settleTimer) clearTimeout(settleTimer);
    // Wait past Mapbox's ease curve / coalesced zoom+move end events.
    settleTimer = setTimeout(() => {
      settleTimer = null;
      const stillMoving =
        Boolean(map.isMoving?.()) || Boolean(map.isZooming?.()) || Boolean(map.isRotating?.());
      if (!stillMoving) setBusy(false);
    }, 100);
  };

  const onMoveStart = () => markBusy();
  const onZoomStart = () => markBusy();
  const onRotateStart = () => markBusy();
  const onPitchStart = () => markBusy();
  const onMoveEnd = () => markSettling();
  const onZoomEnd = () => markSettling();
  const onRotateEnd = () => markSettling();
  const onPitchEnd = () => markSettling();
  const onIdle = () => {
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    const stillMoving =
      Boolean(map.isMoving?.()) || Boolean(map.isZooming?.()) || Boolean(map.isRotating?.());
    if (!stillMoving) setBusy(false);
  };

  map.on?.('movestart', onMoveStart);
  map.on?.('zoomstart', onZoomStart);
  map.on?.('rotatestart', onRotateStart);
  map.on?.('pitchstart', onPitchStart);
  map.on?.('moveend', onMoveEnd);
  map.on?.('zoomend', onZoomEnd);
  map.on?.('rotateend', onRotateEnd);
  map.on?.('pitchend', onPitchEnd);
  map.on?.('idle', onIdle);

  return () => {
    if (settleTimer) clearTimeout(settleTimer);
    map.off?.('movestart', onMoveStart);
    map.off?.('zoomstart', onZoomStart);
    map.off?.('rotatestart', onRotateStart);
    map.off?.('pitchstart', onPitchStart);
    map.off?.('moveend', onMoveEnd);
    map.off?.('zoomend', onZoomEnd);
    map.off?.('rotateend', onRotateEnd);
    map.off?.('pitchend', onPitchEnd);
    map.off?.('idle', onIdle);
    setBusy(false);
  };
}
