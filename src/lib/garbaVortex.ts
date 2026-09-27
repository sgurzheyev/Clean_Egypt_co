/**
 * Garba-Vortex map math. Zoom fade lives here; meter / daily / sector
 * thresholds live in public.garba_vortex_config (see the migration).
 */

export const VORTEX_ZOOM_HEATMAP_FULL = 11;
export const VORTEX_ZOOM_PINS_FULL = 12;
export const VORTEX_HEATMAP_OPACITY = 0.9;
export const VORTEX_BLACK_HOLE_CAP = 48;

/** Mapbox heatmap-density stops: transparent/grey → neon green → orange → #1a0033 → #ff0055. */
export const VORTEX_HEATMAP_COLOR: unknown[] = [
  'interpolate',
  ['linear'],
  ['heatmap-density'],
  0,
  'rgba(0,0,0,0)',
  0.12,
  'rgba(140,140,150,0.18)',
  0.28,
  'rgba(90,90,100,0.35)',
  0.42,
  '#39ff14',
  0.58,
  '#ff9f1a',
  0.74,
  '#1a0033',
  0.88,
  '#7a0044',
  1,
  '#ff0055',
];

export type VortexLngLat = { lng: number; lat: number };

export type VortexHeatCell = VortexLngLat & {
  weight: number;
  pointCount: number;
  maxSeverity: number;
  isolated: boolean;
  blackHole: boolean;
};

export type VortexSector = {
  id: string;
  status: string;
  pinCount: number;
  severitySum: number;
  missionId: string | null;
  centerLng: number;
  centerLat: number;
  ring: number[][];
};

export type VortexFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id?: string;
    properties: Record<string, string | number | boolean | null>;
    geometry:
      | { type: 'Point'; coordinates: [number, number] }
      | { type: 'Polygon'; coordinates: number[][][] };
  }>;
};

const EMPTY: VortexFeatureCollection = { type: 'FeatureCollection', features: [] };

export function heatmapOpacityForZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= VORTEX_ZOOM_HEATMAP_FULL) return VORTEX_HEATMAP_OPACITY;
  if (zoom >= VORTEX_ZOOM_PINS_FULL) return 0;
  const t =
    (zoom - VORTEX_ZOOM_HEATMAP_FULL) / (VORTEX_ZOOM_PINS_FULL - VORTEX_ZOOM_HEATMAP_FULL);
  return VORTEX_HEATMAP_OPACITY * (1 - t);
}

/** 0 at macro zoom once the RPC is live; 1 when the overlay is unavailable so pins stay. */
export function pinFadeForZoom(zoom: number, vortexReady: boolean): number {
  if (!vortexReady) return 1;
  if (!Number.isFinite(zoom) || zoom <= VORTEX_ZOOM_HEATMAP_FULL) return 0;
  if (zoom >= VORTEX_ZOOM_PINS_FULL) return 1;
  return (zoom - VORTEX_ZOOM_HEATMAP_FULL) / (VORTEX_ZOOM_PINS_FULL - VORTEX_ZOOM_HEATMAP_FULL);
}

export function sectorFillOpacityForZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom < 8) return 0.28;
  if (zoom < VORTEX_ZOOM_PINS_FULL) return 0.42;
  return 0.62;
}

export function bboxFromView(lat: number, lng: number, zoom: number, pad = 1.25): {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
} {
  const z = Number.isFinite(zoom) ? Math.max(0, zoom) : 2;
  const halfLat = Math.min(80, (180 / Math.pow(2, z)) * pad);
  const cos = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const halfLng = Math.min(180, halfLat / cos);
  return {
    minLat: Math.max(-85, lat - halfLat),
    maxLat: Math.min(85, lat + halfLat),
    minLng: lng - halfLng,
    maxLng: lng + halfLng,
  };
}

export function squareRing(lng: number, lat: number, halfMeters = 100): number[][] {
  const dlat = halfMeters / 111320;
  const dlng = halfMeters / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return [
    [lng - dlng, lat - dlat],
    [lng + dlng, lat - dlat],
    [lng + dlng, lat + dlat],
    [lng - dlng, lat + dlat],
    [lng - dlng, lat - dlat],
  ];
}

/** Ray cast. Ring is GeoJSON [lng, lat] and may repeat the first vertex. */
export function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (xi == null || yi == null || xj == null || yj == null) continue;
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function isDissolvedMissionPin(
  missionId: string,
  lng: number,
  lat: number,
  sectors: VortexSector[],
  isFreeReport = false
): boolean {
  if (!isFreeReport) return false;
  for (const sector of sectors) {
    if (sector.status !== 'cleanup') continue;
    if (sector.missionId && sector.missionId === missionId) return false;
    if (pointInRing(lng, lat, sector.ring)) return true;
  }
  return false;
}

/** Bottom-most style layer among mission pins. Vortex layers use it as beforeId. */
export function lowestOverlayAnchor(styleLayerIds: string[], candidates: readonly string[]): string | undefined {
  const want = new Set(candidates);
  for (const id of styleLayerIds) {
    if (want.has(id)) return id;
  }
  return undefined;
}

/**
 * Report pins and report-only clusters fade with the heatmap.
 * Paid / bounty pins (and any cluster that contains one) keep `full`.
 */
export function vortexPinPaintOpacity(full: number, fade: number): unknown[] {
  const faded = full * fade;
  return [
    'case',
    ['has', 'point_count'],
    ['case', ['>', ['to-number', ['coalesce', ['get', 'paid_count'], 0]], 0], full, faded],
    ['==', ['to-number', ['get', 'is_report']], 1],
    faded,
    full,
  ];
}

/** Pulse lives in feature-state so React paint props stay still. */
export function blackHolePulseRadius(): unknown[] {
  return ['+', 16, ['*', ['coalesce', ['feature-state', 'pulse'], 0.35], 26]];
}

export function blackHolePulseOpacity(strength: number): unknown[] {
  return ['*', strength, ['+', 0.28, ['*', ['coalesce', ['feature-state', 'pulse'], 0.35], 0.42]]];
}

function dist2(a: VortexLngLat, b: VortexLngLat): number {
  const dlat = a.lat - b.lat;
  const dlng = (a.lng - b.lng) * Math.max(0.2, Math.cos((b.lat * Math.PI) / 180));
  return dlat * dlat + dlng * dlng;
}

export function capBlackHoles<T extends VortexLngLat>(
  points: T[],
  center: VortexLngLat,
  max = VORTEX_BLACK_HOLE_CAP
): T[] {
  if (points.length <= max) return points;
  return [...points].sort((a, b) => dist2(a, center) - dist2(b, center)).slice(0, max);
}

export function cellsToHeatmap(cells: VortexHeatCell[]): VortexFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: cells
      .filter((c) => Number.isFinite(c.lng) && Number.isFinite(c.lat) && c.weight > 0)
      .map((c) => ({
        type: 'Feature' as const,
        properties: {
          weight: c.weight,
          point_count: c.pointCount,
          severity: c.maxSeverity,
        },
        geometry: { type: 'Point' as const, coordinates: [c.lng, c.lat] as [number, number] },
      })),
  };
}

export function cellsToBlackHoles(
  cells: VortexHeatCell[],
  center: VortexLngLat
): VortexFeatureCollection {
  const holes = capBlackHoles(
    cells.filter((c) => c.blackHole),
    center
  );
  return {
    type: 'FeatureCollection',
    features: holes.map((c) => ({
      type: 'Feature' as const,
      properties: {
        severity: c.maxSeverity,
        weight: c.weight,
      },
      id: `${c.lng.toFixed(5)}:${c.lat.toFixed(5)}`,
      geometry: { type: 'Point' as const, coordinates: [c.lng, c.lat] as [number, number] },
    })),
  };
}

export function sectorsToGeoJSON(sectors: VortexSector[]): VortexFeatureCollection {
  const features = sectors
    .filter((s) => s.status === 'cleanup' && s.ring.length >= 4)
    .map((s) => ({
      type: 'Feature' as const,
      id: s.id,
      properties: {
        sector_id: s.id,
        mission_id: s.missionId,
        pin_count: s.pinCount,
        severity_sum: s.severitySum,
        status: s.status,
      },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [s.ring],
      },
    }));
  return { type: 'FeatureCollection', features };
}

export function emptyVortexCollection(): VortexFeatureCollection {
  return EMPTY;
}

export function classifyVortexPinError(
  message: string
): 'storm_limit' | 'daily_limit' | 'sector_closed' | 'insufficient_tokens' | null {
  const text = message.toLowerCase();
  if (text.includes('free_pin_storm_limit')) return 'storm_limit';
  if (text.includes('free_pin_daily_limit')) return 'daily_limit';
  if (text.includes('cleanup_sector_closed')) return 'sector_closed';
  if (text.includes('insufficient_tokens')) return 'insufficient_tokens';
  return null;
}

/**
 * CDN / browser cache for /api/garba-vortex-heatmap.
 * Calm responses stay uncached. Storm responses are public for `seconds`.
 */
export function stormCacheControl(active: boolean, seconds: number): string {
  if (!active) return 'private, no-store';
  const raw = Number(seconds);
  const ttl = Number.isFinite(raw) ? Math.min(300, Math.max(5, Math.round(raw))) : 30;
  return `public, max-age=${ttl}, s-maxage=${ttl}, stale-while-revalidate=${ttl * 2}`;
}

/** Storm snapshots must not paint isolated spikes or black-hole rings. */
export function suppressStormSpikes(cells: VortexHeatCell[], storm: boolean): VortexHeatCell[] {
  if (!storm) return cells;
  return cells.map((cell) =>
    cell.isolated || cell.blackHole ? { ...cell, isolated: false, blackHole: false } : cell
  );
}

export type VortexHeatmapQuery = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
  zoom: number;
  includeReports: boolean;
};

function requiredQueryNumber(params: URLSearchParams, ...names: string[]): number {
  const raw = queryParam(params, ...names);
  if (raw == null) return Number.NaN;
  return Number(raw);
}

function queryParam(params: URLSearchParams, ...names: string[]): string | null {
  for (const name of names) {
    const value = params.get(name);
    if (value != null && value.trim() !== '') return value.trim();
  }
  return null;
}

/** Shared by the Vercel route and the Vite dev proxy. */
export function parseVortexHeatmapQuery(
  params: URLSearchParams
): { ok: true; query: VortexHeatmapQuery } | { ok: false; error: string } {
  const minLng = requiredQueryNumber(params, 'minLng', 'min_lng');
  const minLat = requiredQueryNumber(params, 'minLat', 'min_lat');
  const maxLng = requiredQueryNumber(params, 'maxLng', 'max_lng');
  const maxLat = requiredQueryNumber(params, 'maxLat', 'max_lat');
  const zoomRaw = queryParam(params, 'zoom');
  const zoom = zoomRaw == null ? 4 : Number(zoomRaw);
  const includeRaw = (queryParam(params, 'includeReports', 'include_reports') || '1').toLowerCase();
  if (![minLng, minLat, maxLng, maxLat, zoom].every(Number.isFinite)) {
    return { ok: false, error: 'minLng, minLat, maxLng, maxLat, zoom required' };
  }
  if (minLat < -90 || minLat > 90 || maxLat < -90 || maxLat > 90 || minLat > maxLat) {
    return { ok: false, error: 'latitude out of range' };
  }
  if (minLng < -180 || minLng > 180 || maxLng < -180 || maxLng > 180) {
    return { ok: false, error: 'longitude out of range' };
  }
  if (zoom < 0 || zoom > 22) return { ok: false, error: 'zoom out of range' };
  return {
    ok: true,
    query: {
      minLng,
      minLat,
      maxLng,
      maxLat,
      zoom,
      includeReports: includeRaw !== '0' && includeRaw !== 'false',
    },
  };
}

/** PGRST202 / 42883 only. Other "does not exist" text is a different failure. */
export function isMissingRpcError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  if (code === 'PGRST202' || code === '42883') return true;
  const message = String(error.message || '').toLowerCase();
  return message.includes('pgrst202') || message.includes('42883');
}

export function isVortexLowEndDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  if (nav.connection?.saveData) return true;
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0 && nav.deviceMemory <= 2) {
    return true;
  }
  if (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 2) {
    return true;
  }
  return false;
}

/** Pulsing ring. Static rings still draw unless the flag is explicitly off. */
export function blackHolePulseAllowed(): boolean {
  const flag = readBlackHoleFlag();
  if (flag === 'off') return false;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return false;
  }
  return !isVortexLowEndDevice();
}

/** 'off' hides the ring layers. 'static' keeps a still gravity well. */
export function blackHoleVisualMode(): 'pulse' | 'static' | 'off' {
  if (readBlackHoleFlag() === 'off') return 'off';
  return blackHolePulseAllowed() ? 'pulse' : 'static';
}

function readBlackHoleFlag(): 'off' | 'on' | null {
  try {
    const fromEnv = (import.meta as { env?: Record<string, string | undefined> }).env
      ?.VITE_GARBA_VORTEX_BLACK_HOLE;
    if (fromEnv === '0' || fromEnv === 'false') return 'off';
  } catch {
    /* import.meta may be absent under plain node test runners */
  }
  if (typeof localStorage === 'undefined') return null;
  try {
    const stored = localStorage.getItem('garba_vortex_black_hole');
    if (stored === '0' || stored === 'off') return 'off';
  } catch {
    /* private mode */
  }
  return null;
}

export function readVortexDemoCamera(
  search?: string
): { latitude: number; longitude: number; zoom: number } | null {
  const raw =
    search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const q = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
  if (q.get('vortexDemo') !== '1') return null;
  const zoom = Number(q.get('vortexZoom') ?? '4.2');
  const latitude = Number(q.get('vortexLat') ?? '28.2');
  const longitude = Number(q.get('vortexLng') ?? '30.2');
  return {
    latitude: Number.isFinite(latitude) ? latitude : 28.2,
    longitude: Number.isFinite(longitude) ? longitude : 30.2,
    zoom: Number.isFinite(zoom) ? Math.min(18, Math.max(0, zoom)) : 4.2,
  };
}
