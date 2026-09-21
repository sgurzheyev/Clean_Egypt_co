/**
 * Viewport bbox helpers + GeoJSON for live flights / ships.
 * Caps entity counts by zoom so mobile stays near 60 FPS.
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
export const LIVE_FLIGHTS_GLOW_LAYER_ID = 'live-flights-glow';
export const LIVE_FLIGHTS_CORE_LAYER_ID = 'live-flights-core';
export const LIVE_FLIGHTS_ICON_LAYER_ID = 'live-flights-icon';
export const LIVE_SHIPS_GLOW_LAYER_ID = 'live-ships-glow';
export const LIVE_SHIPS_CORE_LAYER_ID = 'live-ships-core';
export const LIVE_SHIPS_ICON_LAYER_ID = 'live-ships-icon';
export const LIVE_PLANE_IMAGE_ID = 'ce-live-plane';
export const LIVE_SHIP_IMAGE_ID = 'ce-live-ship';

export const OPENSKY_POLL_MS = 12_000;
export const TRAFFIC_BBOX_MAX_LAT_SPAN = 8;
export const TRAFFIC_BBOX_MAX_LNG_SPAN = 10;

export type TrafficGeoJSON = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id?: string;
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: LiveTrafficPointProps;
  }>;
};

const EMPTY_FC: TrafficGeoJSON = { type: 'FeatureCollection', features: [] };

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
  const latSpan = north - south;
  const lngSpan = east - west;
  const latMid = (south + north) / 2;
  const lngMid = (west + east) / 2;
  const halfLat = Math.min(latSpan, TRAFFIC_BBOX_MAX_LAT_SPAN) / 2;
  const halfLng = Math.min(lngSpan, TRAFFIC_BBOX_MAX_LNG_SPAN) / 2;
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
  const south = Number(bounds.getSouth());
  const west = Number(bounds.getWest());
  const north = Number(bounds.getNorth());
  const east = Number(bounds.getEast());
  if (![south, west, north, east].every(Number.isFinite)) return null;
  return padAndClampBbox({ lamin: south, lomin: west, lamax: north, lomax: east });
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
  return clamp(Math.round(nm), 15, 220);
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
  if (onGround) return 'on ground';
  if (altitudeM == null || !Number.isFinite(altitudeM)) return 'alt —';
  const ft = Math.round((altitudeM * 3.28084) / 100) * 100;
  return `${ft.toLocaleString('en-US')} ft`;
}

export function formatSpeedKn(speedKn: number | null): string {
  if (speedKn == null || !Number.isFinite(speedKn)) return '';
  return `${Math.round(speedKn)} kn`;
}

export function trafficTooltipLabel(entity: LiveTrafficEntity): string {
  if (entity.kind === 'flight') {
    const alt = formatAltitudeLabel(entity.altitudeM, entity.onGround);
    return `${entity.callsign} · ${alt}`;
  }
  const spd = formatSpeedKn(entity.speedKn);
  return spd ? `${entity.callsign} · ${spd}` : entity.callsign;
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

type ImageMap = {
  hasImage?: (id: string) => boolean;
  addImage?: (
    id: string,
    image: { width: number; height: number; data: Uint8Array | Uint8ClampedArray },
    options?: { pixelRatio?: number }
  ) => void;
};

function paintTriangle(
  data: Uint8Array,
  size: number,
  rgb: [number, number, number]
): void {
  const cx = (size - 1) / 2;
  const top = 4;
  const bot = size - 6;
  const half = size * 0.28;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (y - top) / (bot - top);
      if (t < 0 || t > 1) continue;
      const hw = half * t + 1;
      if (Math.abs(x - cx) <= hw) {
        const i = (y * size + x) * 4;
        const edge = Math.abs(x - cx) > hw - 1.2 || y < top + 1.5;
        data[i] = rgb[0];
        data[i + 1] = rgb[1];
        data[i + 2] = rgb[2];
        data[i + 3] = edge ? 255 : 230;
      }
    }
  }
}

function paintDiamond(
  data: Uint8Array,
  size: number,
  rgb: [number, number, number]
): void {
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const rx = size * 0.22;
  const ry = size * 0.38;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = Math.abs(x - cx) / rx;
      const ny = Math.abs(y - cy) / ry;
      if (nx + ny <= 1.05) {
        const i = (y * size + x) * 4;
        data[i] = rgb[0];
        data[i + 1] = rgb[1];
        data[i + 2] = rgb[2];
        data[i + 3] = nx + ny > 0.88 ? 255 : 220;
      }
    }
  }
}

export function registerLiveTrafficImages(map: ImageMap | null | undefined): void {
  if (!map?.addImage) return;
  const size = 64;
  try {
    if (!map.hasImage?.(LIVE_PLANE_IMAGE_ID)) {
      const data = new Uint8Array(size * size * 4);
      paintTriangle(data, size, [34, 211, 238]);
      map.addImage(LIVE_PLANE_IMAGE_ID, { width: size, height: size, data }, { pixelRatio: 2 });
    }
  } catch {
    /* ignore */
  }
  try {
    if (!map.hasImage?.(LIVE_SHIP_IMAGE_ID)) {
      const data = new Uint8Array(size * size * 4);
      paintDiamond(data, size, [139, 92, 246]);
      map.addImage(LIVE_SHIP_IMAGE_ID, { width: size, height: size, data }, { pixelRatio: 2 });
    }
  } catch {
    /* ignore */
  }
}

