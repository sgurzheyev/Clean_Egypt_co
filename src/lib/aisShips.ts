/**
 * AIS ships: same-origin `/api/ais-nearby` (server holds AISSTREAM_API_KEY).
 * AISStream blocks browser WebSockets — do not connect from the client.
 * Upstream frames are often binary; the proxy UTF-8-decodes before JSON.parse.
 *
 * Get a free key: https://aisstream.io/ (GitHub → API Keys). Never commit it.
 * Docs: https://aisstream.io/documentation
 */

import {
  bboxToAisstreamBox,
  capTrafficEntities,
  type GeoBbox,
  type LiveTrafficEntity,
} from './mapLiveTraffic';

export const AIS_NEARBY_PATH = '/api/ais-nearby';
export const AISSTREAM_WS_URL = 'wss://stream.aisstream.io/v0/stream';
export const AIS_STALE_MS = 90_000;
export const AIS_POLL_MS = 8_000;

type AisPositionFields = {
  UserID?: number;
  Latitude?: number;
  Longitude?: number;
  Cog?: number;
  Sog?: number;
  TrueHeading?: number;
};

export type AisstreamEnvelope = {
  MessageType?: string;
  MetaData?: {
    MMSI?: number | string;
    ShipName?: string;
    latitude?: number;
    longitude?: number;
  };
  Message?: {
    PositionReport?: AisPositionFields;
    StandardClassBPositionReport?: AisPositionFields;
    ExtendedClassBPositionReport?: AisPositionFields;
    LongRangeAisBroadcastMessage?: AisPositionFields;
  };
};

export const AIS_POSITION_MESSAGE_TYPES = [
  'PositionReport',
  'StandardClassBPositionReport',
  'ExtendedClassBPositionReport',
  'LongRangeAisBroadcastMessage',
] as const;

function finiteNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pickAisPosition(env: AisstreamEnvelope): AisPositionFields | undefined {
  const msg = env.Message;
  return (
    msg?.PositionReport ||
    msg?.StandardClassBPositionReport ||
    msg?.ExtendedClassBPositionReport ||
    msg?.LongRangeAisBroadcastMessage
  );
}

export function parseAisstreamMessage(raw: unknown): LiveTrafficEntity | null {
  if (!raw || typeof raw !== 'object') return null;
  const env = raw as AisstreamEnvelope;
  const report = pickAisPosition(env);
  const meta = env.MetaData;
  const lat = finiteNum(report?.Latitude) ?? finiteNum(meta?.latitude);
  const lng = finiteNum(report?.Longitude) ?? finiteNum(meta?.longitude);
  if (lat == null || lng == null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return null;

  const mmsi = String(report?.UserID ?? meta?.MMSI ?? '').trim();
  if (!mmsi) return null;
  const name = String(meta?.ShipName || '').trim();
  const heading = finiteNum(report?.TrueHeading);
  const cog = finiteNum(report?.Cog);
  const sog = finiteNum(report?.Sog);
  return {
    id: `shp-${mmsi}`,
    kind: 'ship',
    lat,
    lng,
    heading: heading != null && heading < 360 ? heading : cog,
    callsign: name || `MMSI ${mmsi}`,
    altitudeM: null,
    speedKn: sog != null && sog < 102.2 ? sog : null,
  };
}

export function buildAisstreamSubscribeMessage(apiKey: string, bbox: GeoBbox): string {
  return JSON.stringify({
    APIKey: apiKey,
    BoundingBoxes: [bboxToAisstreamBox(bbox)],
    FilterMessageTypes: [...AIS_POSITION_MESSAGE_TYPES],
  });
}

/** UTF-8-decode a WS frame (string | Buffer | ArrayBuffer | TypedArray | Blob). */
export async function decodeAisstreamFrame(data: unknown): Promise<unknown | null> {
  try {
    let text = '';
    if (typeof data === 'string') text = data;
    else if (typeof Buffer !== 'undefined' && typeof Buffer.isBuffer === 'function' && Buffer.isBuffer(data)) {
      text = data.toString('utf8');
    } else if (data instanceof ArrayBuffer) {
      text = new TextDecoder().decode(data);
    } else if (ArrayBuffer.isView(data)) {
      text = new TextDecoder().decode(data);
    } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
      text = await data.text();
    } else {
      text = String(data ?? '');
    }
    if (!text || text === '[object Blob]' || text === '[object ArrayBuffer]') return null;
    const trimmed = text.trim();
    if (!trimmed) return null;
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export type AisNearbyShip = {
  mmsi?: string;
  name?: string;
  lat?: number;
  lon?: number;
  lng?: number;
  heading?: number | null;
  sog?: number | null;
};

export function parseAisNearby(payload: { ships?: unknown } | null | undefined): LiveTrafficEntity[] {
  const rows = Array.isArray(payload?.ships) ? payload!.ships! : [];
  const out: LiveTrafficEntity[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const parsed = parseAisstreamMessage({
      MessageType: 'PositionReport',
      MetaData: {
        MMSI: (row as AisNearbyShip).mmsi,
        ShipName: (row as AisNearbyShip).name,
        latitude: (row as AisNearbyShip).lat,
        longitude: (row as AisNearbyShip).lon ?? (row as AisNearbyShip).lng,
      },
      Message: {
        PositionReport: {
          UserID: Number((row as AisNearbyShip).mmsi) || undefined,
          Latitude: (row as AisNearbyShip).lat,
          Longitude: (row as AisNearbyShip).lon ?? (row as AisNearbyShip).lng,
          TrueHeading: (row as AisNearbyShip).heading ?? undefined,
          Sog: (row as AisNearbyShip).sog ?? undefined,
          Cog: (row as AisNearbyShip).heading ?? undefined,
        },
      },
    });
    if (parsed) out.push(parsed);
  }
  return out;
}

export type ShipFetchMeta = {
  source: 'aisstream' | 'none';
  error: string | null;
};

export async function fetchViewportShips(
  bbox: GeoBbox,
  zoom: number,
  signal?: AbortSignal
): Promise<{ entities: LiveTrafficEntity[]; meta: ShipFetchMeta }> {
  const qs = new URLSearchParams({
    lamin: bbox.lamin.toFixed(4),
    lomin: bbox.lomin.toFixed(4),
    lamax: bbox.lamax.toFixed(4),
    lomax: bbox.lomax.toFixed(4),
  });
  const res = await fetch(`${AIS_NEARBY_PATH}?${qs}`, {
    method: 'GET',
    signal,
    headers: { Accept: 'application/json' },
  });
  let payload: { ships?: unknown; error?: string; source?: string } = { ships: [] };
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    payload = { ships: [], error: 'ais non-JSON' };
  }
  const entities = parseAisNearby(payload);
  if (entities.length > 0) {
    return {
      entities: capTrafficEntities(entities, zoom, 'ship'),
      meta: { source: 'aisstream', error: null },
    };
  }
  const err =
    payload.error ||
    (!res.ok ? `ais ${res.status}` : null);
  return { entities: [], meta: { source: 'none', error: err } };
}

export type AisShipTracker = {
  upsert: (entity: LiveTrafficEntity, now?: number) => void;
  prune: (now?: number) => LiveTrafficEntity[];
  list: (zoom: number, now?: number) => LiveTrafficEntity[];
  clear: () => void;
  size: () => number;
};

export function createAisShipTracker(): AisShipTracker {
  const byId = new Map<string, { entity: LiveTrafficEntity; at: number }>();

  const prune = (now = Date.now()): LiveTrafficEntity[] => {
    for (const [id, row] of byId) {
      if (now - row.at > AIS_STALE_MS) byId.delete(id);
    }
    return [...byId.values()].map((r) => r.entity);
  };

  return {
    upsert(entity, now = Date.now()) {
      byId.set(entity.id, { entity, at: now });
    },
    prune,
    list(zoom, now = Date.now()) {
      return capTrafficEntities(prune(now), zoom, 'ship');
    },
    clear() {
      byId.clear();
    },
    size() {
      return byId.size;
    },
  };
}
