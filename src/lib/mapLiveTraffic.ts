/**
 * Viewport bbox helpers + GeoJSON for live flights / ships.
 * Caps entity counts by zoom so mobile stays near 60 FPS.
 *
 * Craft colors are lime (planes) vs amber (ships) so they stay readable
 * against cyan RUSH roads — not tiny cyan dots.
 */

export type GeoBbox = {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
};

export type LiveTrafficEntity = {
  id: string;
  kind: 'flight' | 'ship';
  lat: number;
  lng: number;
  heading: number | null;
  callsign: string;
  altitudeM: number | null;
  speedKn: number | null;
  onGround?: boolean;
};

export type LiveTrafficPointProps = {
  id: string;
  kind: 'flight' | 'ship';
  callsign: string;
  heading: number;
  altitude_m: number;
  speed_kn: number;
  on_ground: number;
  label: string;
};

export const LIVE_FLIGHTS_SOURCE_ID = 'live-flights';
export const LIVE_SHIPS_SOURCE_ID = 'live-ships';
export const LIVE_FLIGHTS_TRAILS_SOURCE_ID = 'live-flights-trails';
export const LIVE_SHIPS_TRAILS_SOURCE_ID = 'live-ships-trails';
export const LIVE_FLIGHTS_GLOW_LAYER_ID = 'live-flights-glow';
export const LIVE_FLIGHTS_CORE_LAYER_ID = 'live-flights-core';
export const LIVE_FLIGHTS_ICON_LAYER_ID = 'live-flights-icon';
export const LIVE_FLIGHTS_LABEL_LAYER_ID = 'live-flights-label';
export const LIVE_FLIGHTS_TRAIL_GLOW_LAYER_ID = 'live-flights-trail-glow';
export const LIVE_FLIGHTS_TRAIL_LAYER_ID = 'live-flights-trail';
export const LIVE_SHIPS_GLOW_LAYER_ID = 'live-ships-glow';
export const LIVE_SHIPS_CORE_LAYER_ID = 'live-ships-core';
export const LIVE_SHIPS_ICON_LAYER_ID = 'live-ships-icon';
export const LIVE_SHIPS_LABEL_LAYER_ID = 'live-ships-label';
export const LIVE_SHIPS_TRAIL_GLOW_LAYER_ID = 'live-ships-trail-glow';
export const LIVE_SHIPS_TRAIL_LAYER_ID = 'live-ships-trail';
export const LIVE_PLANE_IMAGE_ID = 'ce-live-plane';
export const LIVE_SHIP_IMAGE_ID = 'ce-live-ship';

/** Mapbox Standard slot so craft sit above 3D buildings / terrain. */
export const LIVE_TRAFFIC_SLOT = 'top';

export const FLIGHT_TRAIL_COLOR = '#4ade80';
export const FLIGHT_TRAIL_CORE_COLOR = '#bbf7d0';
export const SHIP_TRAIL_COLOR = '#f59e0b';
export const SHIP_TRAIL_CORE_COLOR = '#fdba74';
export const FLIGHT_MARKER_COLOR = '#86efac';
export const SHIP_MARKER_COLOR = '#fb923c';

export const OPENSKY_POLL_MS = 12_000;
export const TRAFFIC_BBOX_MAX_LAT_SPAN = 8;
export const TRAFFIC_BBOX_MAX_LNG_SPAN = 10;
/** Street-zoom viewports would otherwise miss HRG / Red Sea craft. */
export const TRAFFIC_BBOX_MIN_LAT_SPAN = 1.4;
export const TRAFFIC_BBOX_MIN_LNG_SPAN = 1.8;

export type TrafficGeoJSON = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id?: string;
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: LiveTrafficPointProps;
  }>;
};

export type TrafficTrailGeoJSON = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id?: string;
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    properties: { id: string; kind: 'flight' | 'ship' };
  }>;
};

const EMPTY_FC: TrafficGeoJSON = { type: 'FeatureCollection', features: [] };
const EMPTY_TRAILS: TrafficTrailGeoJSON = { type: 'FeatureCollection', features: [] };

export function clampBbox(bbox: GeoBbox): GeoBbox {
  const lamin = clamp(bbox.lamin, -90, 90);
  const lamax = clamp(bbox.lamax, -90, 90);
  const lomin = clamp(bbox.lomin, -180, 180);
  const lomax = clamp(bbox.lomax, -180, 180);
  const south = Math.min(lamin, lamax);
  const north = Math.max(lamin, lamax);
  let west = lomin;
  let east = lomax;
  if (west > east) {
    west = lomin;
    east = lomax;
  }
  const latMid = (south + north) / 2;
  const lngMid = (west + east) / 2;
  const latSpan = clamp(
    north - south,
    TRAFFIC_BBOX_MIN_LAT_SPAN,
    TRAFFIC_BBOX_MAX_LAT_SPAN
  );
  const lngSpan = clamp(
    east - west,
    TRAFFIC_BBOX_MIN_LNG_SPAN,
    TRAFFIC_BBOX_MAX_LNG_SPAN
  );
  const halfLat = latSpan / 2;
  const halfLng = lngSpan / 2;
  return {
    lamin: clamp(latMid - halfLat, -90, 90),
    lamax: clamp(latMid + halfLat, -90, 90),
    lomin: clamp(lngMid - halfLng, -180, 180),
    lomax: clamp(lngMid + halfLng, -180, 180),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function padAndClampBbox(bbox: GeoBbox, padFrac = 0.08): GeoBbox {
  const latPad = (bbox.lamax - bbox.lamin) * padFrac;
  const lngPad = (bbox.lomax - bbox.lomin) * padFrac;
  return clampBbox({
    lamin: bbox.lamin - latPad,
    lamax: bbox.lamax + latPad,
    lomin: bbox.lomin - lngPad,
    lomax: bbox.lomax + lngPad,
  });
}

export function bboxFromMapBounds(bounds: {
  getSouth?: () => number;
  getWest?: () => number;
  getNorth?: () => number;
  getEast?: () => number;
} | null | undefined): GeoBbox | null {
  if (!bounds?.getSouth || !bounds.getWest || !bounds.getNorth || !bounds.getEast) {
    return null;
  }
  try {
    const south = Number(bounds.getSouth());
    const west = Number(bounds.getWest());
    const north = Number(bounds.getNorth());
    const east = Number(bounds.getEast());
    if (![south, west, north, east].every(Number.isFinite)) return null;
    return padAndClampBbox({ lamin: south, lomin: west, lamax: north, lomax: east });
  } catch {
    return null;
  }
}

/**
 * Camera-centered bbox. Globe + high pitch makes `map.getBounds()` span the
 * whole world; clamping that box recenters on (0,0) so ADSB queries the gulf
 * of Guinea instead of Istanbul/Port Said. Always pin the query to the camera.
 */
export function bboxFromCamera(opts: {
  lat: number;
  lng: number;
  zoom?: number;
  bounds?: {
    getSouth?: () => number;
    getWest?: () => number;
    getNorth?: () => number;
    getEast?: () => number;
  } | null;
}): GeoBbox | null {
  const lat = Number(opts.lat);
  const lng = Number(opts.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  let latSpan = TRAFFIC_BBOX_MIN_LAT_SPAN;
  let lngSpan = TRAFFIC_BBOX_MIN_LNG_SPAN;
  const zoom = Number(opts.zoom);
  if (Number.isFinite(zoom)) {
    const zSpan = 360 / 2 ** Math.max(1, Math.min(20, zoom));
    latSpan = Math.max(latSpan, zSpan);
    lngSpan = Math.max(lngSpan, zSpan / Math.max(0.35, Math.cos((lat * Math.PI) / 180)));
  }

  try {
    const b = opts.bounds;
    if (b?.getSouth && b.getWest && b.getNorth && b.getEast) {
      const south = Number(b.getSouth());
      const west = Number(b.getWest());
      const north = Number(b.getNorth());
      const east = Number(b.getEast());
      if ([south, west, north, east].every(Number.isFinite)) {
        const boundLat = Math.abs(north - south);
        const boundLng = Math.abs(east - west);
        // Ignore globe-wide "bounds" — they are not the viewport.
        if (boundLat > 0.05 && boundLat <= TRAFFIC_BBOX_MAX_LAT_SPAN + 4) {
          latSpan = Math.max(latSpan, boundLat);
        }
        if (boundLng > 0.05 && boundLng <= TRAFFIC_BBOX_MAX_LNG_SPAN + 4) {
          lngSpan = Math.max(lngSpan, boundLng);
        }
      }
    }
  } catch {
    /* globe getBounds can throw */
  }

  return clampBbox({
    lamin: lat - latSpan / 2,
    lamax: lat + latSpan / 2,
    lomin: lng - lngSpan / 2,
    lomax: lng + lngSpan / 2,
  });
}

/** Tiny RUSH FAB/peek chip: count when ADSB painted, else a short error. */
export function formatRushFlightChip(opts: {
  count: number;
  error: string | null;
  loading: boolean;
}): string {
  if (opts.count > 0) return String(opts.count);
  if (opts.loading) return '…';
  const err = String(opts.error || '').trim();
  if (!err) return '0';
  const short = err.replace(/^live-flights\s+/i, '').slice(0, 8);
  return short || 'err';
}

/** SHIP chip: count, or 0 / … / ws / need-key. */
export function formatRushShipChip(opts: {
  count: number;
  error: string | null;
  loading: boolean;
}): string {
  if (opts.count > 0) return String(opts.count);
  if (opts.loading) return '…';
  const err = String(opts.error || '').trim().toLowerCase();
  if (!err || err === 'empty') return '0';
  if (err.includes('need-key') || err.includes('no key') || err.includes('missing')) return 'need-key';
  if (
    err === 'ws' ||
    err === 'silent' ||
    err === 'parse' ||
    err.includes('socket') ||
    err.includes('401') ||
    err.includes('close') ||
    err.includes('deflate') ||
    err.includes('unreachable')
  ) {
    return 'ws';
  }
  return err.slice(0, 8);
}

export function bboxAreaSqDeg(bbox: GeoBbox): number {
  return Math.max(0, bbox.lamax - bbox.lamin) * Math.max(0, bbox.lomax - bbox.lomin);
}

export function bboxCenter(bbox: GeoBbox): { lat: number; lng: number } {
  return {
    lat: (bbox.lamin + bbox.lamax) / 2,
    lng: (bbox.lomin + bbox.lomax) / 2,
  };
}

/** Approx radius in nautical miles for ADSB.lol (capped at 250). */
export function bboxRadiusNm(bbox: GeoBbox): number {
  const latSpan = bbox.lamax - bbox.lamin;
  const lngSpan = bbox.lomax - bbox.lomin;
  const latMid = (bbox.lamin + bbox.lamax) / 2;
  const kmLat = latSpan * 111.32;
  const kmLng = lngSpan * 111.32 * Math.cos((latMid * Math.PI) / 180);
  const km = Math.max(kmLat, kmLng) / 2;
  const nm = km / 1.852;
  return clamp(Math.round(nm), 40, 220);
}

export function liveTrafficCap(zoom: number, kind: 'flight' | 'ship'): number {
  if (zoom < 6) return kind === 'flight' ? 28 : 16;
  if (zoom < 9) return kind === 'flight' ? 55 : 32;
  if (zoom < 12) return kind === 'flight' ? 90 : 55;
  return kind === 'flight' ? 120 : 80;
}

export function capTrafficEntities(
  entities: LiveTrafficEntity[],
  zoom: number,
  kind: 'flight' | 'ship'
): LiveTrafficEntity[] {
  const cap = liveTrafficCap(zoom, kind);
  if (entities.length <= cap) return entities;
  const midLat =
    entities.reduce((s, e) => s + e.lat, 0) / Math.max(1, entities.length);
  const midLng =
    entities.reduce((s, e) => s + e.lng, 0) / Math.max(1, entities.length);
  return [...entities]
    .sort((a, b) => {
      const da = (a.lat - midLat) ** 2 + (a.lng - midLng) ** 2;
      const db = (b.lat - midLat) ** 2 + (b.lng - midLng) ** 2;
      return da - db;
    })
    .slice(0, cap);
}

export function formatAltitudeLabel(altitudeM: number | null, onGround?: boolean): string {
  if (onGround) return 'GND';
  if (altitudeM == null || !Number.isFinite(altitudeM)) return '';
  const m = Math.round(altitudeM / 10) * 10;
  return `${m.toLocaleString('en-US')}m`;
}

export function formatSpeedKn(speedKn: number | null): string {
  if (speedKn == null || !Number.isFinite(speedKn)) return '';
  return `${Math.round(speedKn)} kn`;
}

export function formatSpeedKmh(speedKn: number | null): string {
  if (speedKn == null || !Number.isFinite(speedKn)) return '';
  return `${Math.round(speedKn * 1.852)} km/h`;
}

export function formatHeading(heading: number | null): string {
  if (heading == null || !Number.isFinite(heading)) return '';
  const deg = ((Math.round(heading) % 360) + 360) % 360;
  return `${deg}°`;
}

export function trafficTooltipLabel(entity: LiveTrafficEntity): string {
  if (entity.kind === 'flight') {
    const alt = formatAltitudeLabel(entity.altitudeM, entity.onGround);
    const spd = formatSpeedKmh(entity.speedKn);
    return [entity.callsign, alt, spd].filter(Boolean).join(' · ');
  }
  const hdg = formatHeading(entity.heading);
  const spd = formatSpeedKn(entity.speedKn);
  return [entity.callsign, hdg, spd].filter(Boolean).join(' · ');
}

export function entitiesToGeoJSON(entities: LiveTrafficEntity[]): TrafficGeoJSON {
  return {
    type: 'FeatureCollection',
    features: entities.map((e) => ({
      type: 'Feature',
      id: e.id,
      geometry: { type: 'Point', coordinates: [e.lng, e.lat] },
      properties: {
        id: e.id,
        kind: e.kind,
        callsign: e.callsign,
        heading: Number.isFinite(e.heading) ? Number(e.heading) : 0,
        altitude_m: e.altitudeM == null ? -1 : e.altitudeM,
        speed_kn: e.speedKn == null ? -1 : e.speedKn,
        on_ground: e.onGround ? 1 : 0,
        label: trafficTooltipLabel(e),
      },
    })),
  };
}

export function emptyTrafficGeoJSON(): TrafficGeoJSON {
  return EMPTY_FC;
}

export function emptyTrailGeoJSON(): TrafficTrailGeoJSON {
  return EMPTY_TRAILS;
}

export type TrafficTrailTracker = {
  sync: (entities: LiveTrafficEntity[], kind: 'flight' | 'ship') => TrafficTrailGeoJSON;
  clear: () => void;
};

export function createTrailTracker(opts?: {
  maxPoints?: number;
  minStepDeg?: number;
}): TrafficTrailTracker {
  const maxPoints = opts?.maxPoints ?? 12;
  const minStepDeg = opts?.minStepDeg ?? 0.00028;
  const byId = new Map<string, { kind: 'flight' | 'ship'; coords: [number, number][] }>();

  return {
    sync(entities, kind) {
      const seen = new Set<string>();
      for (const e of entities) {
        seen.add(e.id);
        const pt: [number, number] = [e.lng, e.lat];
        const prev = byId.get(e.id);
        if (!prev) {
          byId.set(e.id, { kind, coords: [pt] });
          continue;
        }
        const last = prev.coords[prev.coords.length - 1];
        if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) < minStepDeg) continue;
        prev.coords.push(pt);
        if (prev.coords.length > maxPoints) prev.coords.shift();
      }
      for (const [id, row] of byId) {
        if (row.kind === kind && !seen.has(id)) byId.delete(id);
      }
      return {
        type: 'FeatureCollection',
        features: [...byId.entries()]
          .filter(([, row]) => row.kind === kind && row.coords.length >= 2)
          .map(([id, row]) => ({
            type: 'Feature' as const,
            id,
            geometry: { type: 'LineString' as const, coordinates: row.coords },
            properties: { id, kind: row.kind },
          })),
      };
    },
    clear() {
      byId.clear();
    },
  };
}

/** AISStream wants [[lat, lon], [lat, lon]] corners. */
export function bboxToAisstreamBox(bbox: GeoBbox): [[number, number], [number, number]] {
  return [
    [bbox.lamin, bbox.lomin],
    [bbox.lamax, bbox.lomax],
  ];
}

export function bboxesDiffer(a: GeoBbox | null, b: GeoBbox | null, eps = 0.04): boolean {
  if (!a || !b) return true;
  return (
    Math.abs(a.lamin - b.lamin) > eps ||
    Math.abs(a.lamax - b.lamax) > eps ||
    Math.abs(a.lomin - b.lomin) > eps ||
    Math.abs(a.lomax - b.lomax) > eps
  );
}

export function featureToTrafficEntity(
  props: Record<string, unknown> | null | undefined,
  coords?: [number, number]
): LiveTrafficEntity | null {
  if (!props) return null;
  const kind = props.kind === 'ship' ? 'ship' : props.kind === 'flight' ? 'flight' : null;
  if (!kind) return null;
  const lat = coords?.[1];
  const lng = coords?.[0];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const altitudeM = Number(props.altitude_m);
  const speedKn = Number(props.speed_kn);
  return {
    id: String(props.id || ''),
    kind,
    lat: Number(lat),
    lng: Number(lng),
    heading: Number.isFinite(Number(props.heading)) ? Number(props.heading) : null,
    callsign: String(props.callsign || kind),
    altitudeM: Number.isFinite(altitudeM) && altitudeM >= 0 ? altitudeM : null,
    speedKn: Number.isFinite(speedKn) && speedKn >= 0 ? speedKn : null,
    onGround: Number(props.on_ground) === 1,
  };
}

export const LIVE_TRAFFIC_LAYER_ORDER = [
  LIVE_FLIGHTS_TRAIL_GLOW_LAYER_ID,
  LIVE_SHIPS_TRAIL_GLOW_LAYER_ID,
  LIVE_FLIGHTS_TRAIL_LAYER_ID,
  LIVE_SHIPS_TRAIL_LAYER_ID,
  LIVE_FLIGHTS_GLOW_LAYER_ID,
  LIVE_SHIPS_GLOW_LAYER_ID,
  LIVE_FLIGHTS_CORE_LAYER_ID,
  LIVE_SHIPS_CORE_LAYER_ID,
  LIVE_FLIGHTS_ICON_LAYER_ID,
  LIVE_SHIPS_ICON_LAYER_ID,
  LIVE_FLIGHTS_LABEL_LAYER_ID,
  LIVE_SHIPS_LABEL_LAYER_ID,
] as const;

type ImageMap = {
  hasImage?: (id: string) => boolean;
  addImage?: (
    id: string,
    image: { width: number; height: number; data: Uint8Array | Uint8ClampedArray },
    options?: { pixelRatio?: number }
  ) => void;
};

function setPx(
  data: Uint8Array,
  size: number,
  x: number,
  y: number,
  rgb: [number, number, number],
  a = 255
) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  data[i] = rgb[0];
  data[i + 1] = rgb[1];
  data[i + 2] = rgb[2];
  data[i + 3] = a;
}

/** Top-view airplane, nose-up so icon-rotate heading works. */
function paintPlane(data: Uint8Array, size: number, rgb: [number, number, number]): void {
  const cx = (size - 1) / 2;
  for (let y = 6; y < size - 6; y++) {
    const t = (y - 6) / (size - 12);
    const fuse = t < 0.12 ? 1.6 + t * 8 : t > 0.82 ? 2.2 : 2.8;
    for (let x = Math.floor(cx - fuse); x <= Math.ceil(cx + fuse); x++) {
      setPx(data, size, x, y, rgb, 245);
    }
  }
  const wingY = Math.floor(size * 0.42);
  for (let y = wingY - 3; y <= wingY + 4; y++) {
    const spread = 4 + (y - (wingY - 3)) * 3.6;
    for (let x = Math.floor(cx - spread); x <= Math.ceil(cx + spread); x++) {
      setPx(data, size, x, y, rgb, 255);
    }
  }
  const tailY = Math.floor(size * 0.78);
  for (let y = tailY - 2; y <= tailY + 2; y++) {
    const spread = 6 + Math.abs(y - tailY);
    for (let x = Math.floor(cx - spread); x <= Math.ceil(cx + spread); x++) {
      setPx(data, size, x, y, rgb, 255);
    }
  }
}

/** Bow-up hull so heading/COG rotate the ship. */
function paintShip(data: Uint8Array, size: number, rgb: [number, number, number]): void {
  const cx = (size - 1) / 2;
  const top = 8;
  const bot = size - 8;
  for (let y = top; y <= bot; y++) {
    const t = (y - top) / (bot - top);
    const half = t < 0.28 ? 2 + t * 18 : 7.2;
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
      const edge = Math.abs(x - cx) > half - 1.1 || y < top + 1.5;
      setPx(data, size, x, y, rgb, edge ? 255 : 230);
    }
  }
}

export function registerLiveTrafficImages(map: ImageMap | null | undefined): void {
  if (!map?.addImage) return;
  const size = 80;
  try {
    if (!map.hasImage?.(LIVE_PLANE_IMAGE_ID)) {
      const data = new Uint8Array(size * size * 4);
      paintPlane(data, size, [134, 239, 172]);
      map.addImage(LIVE_PLANE_IMAGE_ID, { width: size, height: size, data }, { pixelRatio: 2 });
    }
  } catch {
    /* ignore */
  }
  try {
    if (!map.hasImage?.(LIVE_SHIP_IMAGE_ID)) {
      const data = new Uint8Array(size * size * 4);
      paintShip(data, size, [251, 146, 60]);
      map.addImage(LIVE_SHIP_IMAGE_ID, { width: size, height: size, data }, { pixelRatio: 2 });
    }
  } catch {
    /* ignore */
  }
}
