/**
 * Live aircraft: OpenSky Network `/states/all` (primary, anonymous + bbox)
 * with ADSB.lol fallback when OpenSky is CORS/AWS blocked or rate-limited.
 * Always same-origin `/api/*` so the browser never hits those hosts directly.
 */

import {
  bboxCenter,
  bboxRadiusNm,
  capTrafficEntities,
  type GeoBbox,
  type LiveTrafficEntity,
} from './mapLiveTraffic';

export const OPENSKY_STATES_PATH = '/api/opensky-states';
export const ADSB_NEARBY_PATH = '/api/adsb-nearby';

type OpenSkyResponse = {
  time?: number;
  states?: unknown[] | null;
};

type AdsbAircraft = {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | 'ground';
  alt_geom?: number;
  track?: number;
  gs?: number;
};

type AdsbResponse = {
  ac?: AdsbAircraft[] | null;
  aircraft?: AdsbAircraft[] | null;
};

function finiteNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseOpenSkyStates(
  payload: OpenSkyResponse | null | undefined
): LiveTrafficEntity[] {
  const rows = Array.isArray(payload?.states) ? payload!.states! : [];
  const out: LiveTrafficEntity[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 8) continue;
    const lng = finiteNum(row[5]);
    const lat = finiteNum(row[6]);
    if (lat == null || lng == null) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    const icao = String(row[0] || '').trim().toLowerCase();
    if (!icao) continue;
    const callsign = String(row[1] || '').trim() || icao.toUpperCase();
    const baro = finiteNum(row[7]);
    const geo = finiteNum(row[13]);
    const heading = finiteNum(row[10]);
    const velocityMs = finiteNum(row[9]);
    const onGround = row[8] === true;
    out.push({
      id: `flt-${icao}`,
      kind: 'flight',
      lat,
      lng,
      heading,
      callsign,
      altitudeM: geo ?? baro,
      speedKn: velocityMs == null ? null : velocityMs * 1.94384,
      onGround,
    });
  }
  return out;
}

export function parseAdsbNearby(payload: AdsbResponse | null | undefined): LiveTrafficEntity[] {
  const rows = Array.isArray(payload?.ac)
    ? payload!.ac!
    : Array.isArray(payload?.aircraft)
      ? payload!.aircraft!
      : [];
  const out: LiveTrafficEntity[] = [];
  for (const row of rows) {
    const lat = finiteNum(row.lat);
    const lng = finiteNum(row.lon);
    if (lat == null || lng == null) continue;
    const hex = String(row.hex || '').trim().toLowerCase();
    if (!hex) continue;
    const flight = String(row.flight || '').trim();
    const altBaro = row.alt_baro === 'ground' ? 0 : finiteNum(row.alt_baro);
    const altGeom = finiteNum(row.alt_geom);
    const altFt = altGeom ?? altBaro;
    out.push({
      id: `flt-${hex}`,
      kind: 'flight',
      lat,
      lng,
      heading: finiteNum(row.track),
      callsign: flight || hex.toUpperCase(),
      altitudeM: altFt == null ? null : altFt / 3.28084,
      speedKn: finiteNum(row.gs),
      onGround: row.alt_baro === 'ground',
    });
  }
  return out;
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, {
    method: 'GET',
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`live-flights ${res.status}`);
  }
  return res.json();
}

export async function fetchOpenSkyViewport(
  bbox: GeoBbox,
  signal?: AbortSignal
): Promise<LiveTrafficEntity[]> {
  const qs = new URLSearchParams({
    lamin: bbox.lamin.toFixed(4),
    lomin: bbox.lomin.toFixed(4),
    lamax: bbox.lamax.toFixed(4),
    lomax: bbox.lomax.toFixed(4),
  });
  const payload = (await fetchJson(`${OPENSKY_STATES_PATH}?${qs}`, signal)) as OpenSkyResponse;
  return parseOpenSkyStates(payload);
}

export async function fetchAdsbViewport(
  bbox: GeoBbox,
  signal?: AbortSignal
): Promise<LiveTrafficEntity[]> {
  const center = bboxCenter(bbox);
  const dist = bboxRadiusNm(bbox);
  const qs = new URLSearchParams({
    lat: center.lat.toFixed(4),
    lon: center.lng.toFixed(4),
    dist: String(dist),
  });
  const payload = (await fetchJson(`${ADSB_NEARBY_PATH}?${qs}`, signal)) as AdsbResponse;
  return parseAdsbNearby(payload);
}

export type FlightFetchMeta = {
  source: 'opensky' | 'adsb' | 'merged' | 'none';
  error: string | null;
};

function mergeFlights(
  primary: LiveTrafficEntity[],
  secondary: LiveTrafficEntity[]
): LiveTrafficEntity[] {
  if (primary.length === 0) return secondary;
  if (secondary.length === 0) return primary;
  const byId = new Map<string, LiveTrafficEntity>();
  for (const e of secondary) byId.set(e.id, e);
  for (const e of primary) byId.set(e.id, e);
  return [...byId.values()];
}

export async function fetchViewportFlights(
  bbox: GeoBbox,
  zoom: number,
  signal?: AbortSignal
): Promise<{ entities: LiveTrafficEntity[]; meta: FlightFetchMeta }> {
  const [openSkySettled, adsbSettled] = await Promise.allSettled([
    fetchOpenSkyViewport(bbox, signal),
    fetchAdsbViewport(bbox, signal),
  ]);

  if (signal?.aborted) {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    throw abortErr;
  }

  const openSky = openSkySettled.status === 'fulfilled' ? openSkySettled.value : [];
  const adsb = adsbSettled.status === 'fulfilled' ? adsbSettled.value : [];
  const openSkyErr =
    openSkySettled.status === 'rejected' && !signal?.aborted
      ? openSkySettled.reason instanceof Error
        ? openSkySettled.reason.message
        : 'opensky failed'
      : null;
  const adsbErr =
    adsbSettled.status === 'rejected' && !signal?.aborted
      ? adsbSettled.reason instanceof Error
        ? adsbSettled.reason.message
        : 'adsb failed'
      : null;

  const merged = mergeFlights(openSky, adsb);
  if (merged.length > 0) {
    const source: FlightFetchMeta['source'] =
      openSky.length > 0 && adsb.length > 0
        ? 'merged'
        : openSky.length > 0
          ? 'opensky'
          : 'adsb';
    return {
      entities: capTrafficEntities(merged, zoom, 'flight'),
      meta: { source, error: null },
    };
  }

  const error =
    openSkyErr && adsbErr ? `${openSkyErr}; ${adsbErr}` : openSkyErr || adsbErr || null;
  return {
    entities: [],
    meta: { source: 'none', error },
  };
}
