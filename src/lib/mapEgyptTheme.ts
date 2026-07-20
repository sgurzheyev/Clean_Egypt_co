/**
 * [[Architecture_Overview.md]] · [[Stripe_USD_Flow]]
 * Programmatic Mapbox “Egypt / Orient” restyle — sandstone extrusions + sandy roads.
 */

/** Muted dusty-desert palette for 3D buildings (chameleon over satellite). */
export const EGYPT_BUILDING_COLORS = [
  '#D8D0C1', // dusty bone
  '#C5BFA9', // dry khaki
  '#B8AD9A', // muted clay
  '#E1DACB', // pale sand
  '#CBC4B4', // limestone dust
  '#B0A796', // dry ash clay
  '#D4CCBC', // bleached khaki
  '#A89F8E', // shadow limestone
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

/** Fallback when height is missing: type-based dusty tones (no red/peach). */
export const egyptBuildingColorByTypeExpr: unknown[] = [
  'match',
  ['downcase', ['to-string', ['coalesce', ['get', 'type'], '']]],
  'residential',
  '#D8D0C1',
  'apartments',
  '#C5BFA9',
  'house',
  '#E1DACB',
  'commercial',
  '#B8AD9A',
  'retail',
  '#CBC4B4',
  'industrial',
  '#A89F8E',
  'mosque',
  '#D4CCBC',
  'church',
  '#D4CCBC',
  'hotel',
  '#C5BFA9',
  '#D8D0C1',
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
  // Semi-transparent so satellite (desert / green) tints the walls naturally.
  'fill-extrusion-opacity': 0.5,
  'fill-extrusion-vertical-gradient': true,
  'fill-extrusion-ambient-occlusion-intensity': 0.35,
  'fill-extrusion-ambient-occlusion-radius': 2.8,
} as const;

/** Sandy / amber road colors (desert complementary). */
export const EGYPT_ROAD_COLOR = '#EDC9AF';
export const EGYPT_ROAD_MAJOR_COLOR = '#C2B280';
export const EGYPT_ROAD_GLOW_COLOR = '#E8C39E';

export const egyptRoadLineColorExpr: unknown[] = [
  'match',
  ['get', 'class'],
  'motorway',
  EGYPT_ROAD_MAJOR_COLOR,
  'trunk',
  EGYPT_ROAD_MAJOR_COLOR,
  'primary',
  '#D4C4A8',
  'secondary',
  EGYPT_ROAD_COLOR,
  'tertiary',
  EGYPT_ROAD_COLOR,
  'street',
  '#E6D5C3',
  'path',
  '#E8D5B7',
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
  safePaint(map, '3d-buildings', 'fill-extrusion-base-color', '#A89F8E');

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
        safePaint(map, id, 'line-opacity', 0.28);
      } else if (idLower === 'neon-roads' || idLower.includes('motorway') || idLower.includes('trunk')) {
        safePaint(map, id, 'line-color', EGYPT_ROAD_MAJOR_COLOR);
        safePaint(map, id, 'line-opacity', 0.75);
      } else {
        safePaint(map, id, 'line-color', egyptRoadLineColorExpr);
        safePaint(map, id, 'line-opacity', 0.85);
      }
    } else if (isAdminBorder) {
      safePaint(map, id, 'line-color', '#C2B280');
      safePaint(map, id, 'line-opacity', 0.45);
    }
  }
}
