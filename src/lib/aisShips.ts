/**
 * Free AIS via AISStream WebSocket (requires VITE_AISSTREAM_API_KEY).
 * No key → ships stay off. Never invent vessel positions.
 *
 * Get a free key: https://aisstream.io/ (sign in with GitHub → API Keys).
 * Docs: https://aisstream.io/documentation
 */

import {
  bboxToAisstreamBox,
  capTrafficEntities,
  type GeoBbox,
  type LiveTrafficEntity,
} from './mapLiveTraffic';

export const AISSTREAM_WS_URL = 'wss://stream.aisstream.io/v0/stream';
export const AIS_STALE_MS = 90_000;

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
