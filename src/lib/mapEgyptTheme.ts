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

/** Deep metallic gunmetal-blue water (map canvas only — not flat black). */
export const MAP_STEEL_WATER = '#1A1A2E';
/** Brighter sheen used for the flickering metallic overlay. */
export const MAP_STEEL_WATER_SHEEN = '#2A3355';
export const MAP_STEEL_WATERWAY = '#3D4A6A';
export const MAP_STEEL_WATERWAY_GLOW = '#2A3558';
export const MAP_GRAPHITE_LAND = '#202025';

/** Geolocate / report-mode cinematic camera. */
export const MAP_CINEMATIC_FLY = {
  zoom: 17,
  pitch: 60,
  duration: 1800,
  essential: true,
} as const;

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
  getCanvas?: () => HTMLCanvasElement | undefined;
};

const WATER_NOISE_IMAGE_ID = 'ce-water-metal-noise';
const WATER_FLICKER_LAYER_ID = 'water-metallic-flicker';
const WATER_TEXTURE_LAYER_ID = 'water-metallic-texture';

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
 * Ensure metallic water texture + sheen layers exist, then run a slow opacity
 * flicker so the surface reads as living gunmetal metal (not flat black oil).
 * Returns a cancel function for cleanup.
 */
export function ensureMetallicWaterEffect(map: WaterFlickerMap): () => void {
  try {
    if (!map.hasImage?.(WATER_NOISE_IMAGE_ID)) {
      map.addImage?.(WATER_NOISE_IMAGE_ID, buildWaterMetalNoiseImage(), { pixelRatio: 2 });
    }
  } catch (e) {
    console.warn('[ensureMetallicWaterEffect] addImage failed', e);
  }

  const beforeId = map.getLayer?.('place_label') ? 'place_label' : undefined;
  // Keep texture under the animated sheen (and under labels/roads when possible).
  const textureBefore = map.getLayer?.(WATER_FLICKER_LAYER_ID)
    ? WATER_FLICKER_LAYER_ID
    : beforeId;

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
              'fill-opacity': 0.32,
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
            'fill-opacity': 0.18,
          },
        },
        beforeId
      );
    } catch (e) {
      console.warn('[ensureMetallicWaterEffect] flicker layer failed', e);
    }
  }

  // Base water + waterways — keep gunmetal (never re-blacken).
  safePaint(map, 'water', 'fill-color', MAP_STEEL_WATER);
  safePaint(map, 'water', 'fill-opacity', 0.96);
  safePaint(map, 'waterway-glow', 'line-color', MAP_STEEL_WATERWAY_GLOW);
  safePaint(map, 'waterway-core', 'line-color', MAP_STEEL_WATERWAY);
  safePaint(map, WATER_FLICKER_LAYER_ID, 'fill-color', MAP_STEEL_WATER_SHEEN);

  let raf = 0;
  let cancelled = false;
  const tick = (t: number) => {
    if (cancelled) return;
    // Slow dual-frequency shimmer (~2.4s + ~5.1s) — subtle metallic flicker.
    const a = 0.5 + 0.5 * Math.sin(t / 2400);
    const b = 0.5 + 0.5 * Math.sin(t / 5100 + 1.2);
    const sheenOpacity = 0.1 + 0.16 * a + 0.06 * b;
    const textureOpacity = 0.22 + 0.16 * b;
    safePaint(map, WATER_FLICKER_LAYER_ID, 'fill-opacity', sheenOpacity);
    safePaint(map, WATER_TEXTURE_LAYER_ID, 'fill-opacity', textureOpacity);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    cancelled = true;
    if (raf) cancelAnimationFrame(raf);
  };
}
