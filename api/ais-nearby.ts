/**
 * Same-origin AISStream proxy. Self-contained: do not import `./_lib/*`.
 *
 * AISStream blocks browser WebSockets (401 / CORS). The map must poll this
 * lambda instead of connecting to wss://stream.aisstream.io from the client.
 * Frames on the upstream socket are often binary — decode UTF-8 before JSON.parse.
 *
 * Prefer server env `AISSTREAM_API_KEY` (not inlined). Falls back to
 * `VITE_AISSTREAM_API_KEY` so an existing Vercel bake still works. Never 500:
 * always `{ ships, error? }`.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 15 };

const AISSTREAM_WS_URL = 'wss://stream.aisstream.io/v0/stream';
const CACHE_MS = 8_000;
const COLLECT_MS = 3_200;
const OPEN_TIMEOUT_MS = 3_000;

const POSITION_TYPES = [
  'PositionReport',
  'StandardClassBPositionReport',
  'ExtendedClassBPositionReport',
  'LongRangeAisBroadcastMessage',
] as const;

type AisShip = {
  mmsi: string;
  name: string;
  lat: number;
  lon: number;
  heading: number | null;
  sog: number | null;
};

type CacheEntry = { at: number; status: number; body: unknown };
const cache = new Map<string, CacheEntry>();

const KEY_PLACEHOLDERS = new Set([
  '',
  'undefined',
  'null',
  'none',
  'n/a',
  'na',
  'changeme',
  'your_api_key',
  'your-api-key',
  'vite_aisstream_api_key',
  'supabase_service_role_key',
  'service_role',
]);

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function usableKey(raw: string): boolean {
  const key = String(raw || '').trim();
  if (key.length < 16) return false;
  if (KEY_PLACEHOLDERS.has(key.toLowerCase())) return false;
  if (/^[A-Z][A-Z0-9_]{8,}$/.test(key)) return false;
  return true;
}

function readAisKey(): string {
  const a = String(process.env.AISSTREAM_API_KEY || '').trim();
  if (usableKey(a)) return a;
  const b = String(process.env.VITE_AISSTREAM_API_KEY || '').trim();
  if (usableKey(b)) return b;
  return '';
}

function decodeFrame(data: unknown): unknown | null {
  try {
    let text = '';
    if (typeof data === 'string') text = data;
    else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) text = data.toString('utf8');
    else if (data instanceof ArrayBuffer) text = new TextDecoder().decode(data);
    else if (ArrayBuffer.isView(data)) {
      const view = data as ArrayBufferView;
      text = new TextDecoder().decode(view);
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

function parseShip(raw: unknown): AisShip | null {
  if (!raw || typeof raw !== 'object') return null;
  const env = raw as {
    MessageType?: string;
    MetaData?: { MMSI?: number | string; ShipName?: string; latitude?: number; longitude?: number };
    Message?: Record<string, { UserID?: number; Latitude?: number; Longitude?: number; Cog?: number; Sog?: number; TrueHeading?: number }>;
    error?: unknown;
    Error?: unknown;
  };
  const err = env.error ?? env.Error;
  if (err) return null;
  const msg = env.Message || {};
  const report =
    msg.PositionReport ||
    msg.StandardClassBPositionReport ||
    msg.ExtendedClassBPositionReport ||
    msg.LongRangeAisBroadcastMessage;
  const meta = env.MetaData;
  const lat = num(report?.Latitude) ?? num(meta?.latitude);
  const lon = num(report?.Longitude) ?? num(meta?.longitude);
  if (lat == null || lon == null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001) return null;
  const mmsi = String(report?.UserID ?? meta?.MMSI ?? '').trim();
  if (!mmsi) return null;
  const heading = num(report?.TrueHeading);
  const cog = num(report?.Cog);
  const sog = num(report?.Sog);
  return {
    mmsi,
    name: String(meta?.ShipName || '').trim() || `MMSI ${mmsi}`,
    lat,
    lon,
    heading: heading != null && heading < 360 ? heading : cog,
    sog: sog != null && sog < 102.2 ? sog : null,
  };
}

export async function queryAisNearby(
  bbox: { lamin: number; lomin: number; lamax: number; lomax: number },
  apiKey: string,
  collectMs = COLLECT_MS
): Promise<{ ships: AisShip[]; error?: string; source: string }> {
  if (!usableKey(apiKey)) {
    return { ships: [], error: 'need-key', source: 'none' };
  }

  const box = [
    [bbox.lamin, bbox.lomin],
    [bbox.lamax, bbox.lomax],
  ];
  const sub = JSON.stringify({
    APIKey: apiKey,
    BoundingBoxes: [box],
    FilterMessageTypes: [...POSITION_TYPES],
  });

  const merged = new Map<string, AisShip>();
  let lastError: string | null = null;

  await new Promise<void>((resolve) => {
    let settled = false;
    let ws: WebSocket;
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    let collectTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (openTimer) clearTimeout(openTimer);
      if (collectTimer) clearTimeout(collectTimer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve();
    };

    try {
      ws = new WebSocket(AISSTREAM_WS_URL);
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'ws';
      resolve();
      return;
    }

    try {
      (ws as { binaryType?: string }).binaryType = 'arraybuffer';
    } catch {
      /* ignore */
    }

    openTimer = setTimeout(() => {
      if (ws.readyState !== 1) {
        lastError = lastError || 'ws';
        finish();
      }
    }, OPEN_TIMEOUT_MS);

    collectTimer = setTimeout(finish, collectMs);

    ws.addEventListener('open', () => {
      try {
        ws.send(sub);
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'ws';
        finish();
      }
    });

    ws.addEventListener('message', (ev) => {
      const parsed = decodeFrame((ev as MessageEvent).data);
      if (!parsed || typeof parsed !== 'object') return;
      const rec = parsed as { error?: unknown; Error?: unknown; MessageType?: string };
      const errText = rec.error ?? rec.Error;
      if (errText) {
        lastError = String(errText).slice(0, 80);
        return;
      }
      const ship = parseShip(parsed);
      if (ship) merged.set(ship.mmsi, ship);
    });

    ws.addEventListener('error', () => {
      lastError = lastError || 'ws';
    });

    ws.addEventListener('close', () => {
      if (!settled && merged.size === 0) {
        lastError = lastError || 'ws';
      }
      finish();
    });
  });

  const ships = [...merged.values()];
  if (ships.length > 0) return { ships, source: 'aisstream' };
  return { ships: [], error: lastError || 'empty', source: 'none' };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'OPTIONS') {
      res.setHeader('Allow', 'GET, OPTIONS');
      return res.status(204).end();
    }
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed', ships: [] });
    }

    const q = req.query || {};
    const pick = (k: string) => num(Array.isArray(q[k]) ? q[k][0] : q[k]);
    const lamin = pick('lamin');
    const lomin = pick('lomin');
    const lamax = pick('lamax');
    const lomax = pick('lomax');
    if (
      lamin == null ||
      lomin == null ||
      lamax == null ||
      lomax == null ||
      lamin < -90 ||
      lamax > 90 ||
      lamin >= lamax ||
      lomin < -180 ||
      lomax > 180
    ) {
      return res.status(400).json({ error: 'lamin,lomin,lamax,lomax required', ships: [] });
    }

    const key = `${lamin.toFixed(3)}:${lomin.toFixed(3)}:${lamax.toFixed(3)}:${lomax.toFixed(3)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      res.setHeader('Cache-Control', 'public, max-age=6');
      res.setHeader('X-Live-Ships-Cache', 'hit');
      return res.status(hit.status).json(hit.body);
    }

    const result = await queryAisNearby({ lamin, lomin, lamax, lomax }, readAisKey());
    const body =
      result.ships.length > 0
        ? { ships: result.ships }
        : { ships: [] as AisShip[], error: result.error || 'empty' };
    cache.set(key, { at: Date.now(), status: 200, body });
    res.setHeader('Cache-Control', result.ships.length > 0 ? 'public, max-age=6' : 'public, max-age=3');
    res.setHeader('X-Live-Ships-Source', result.source);
    return res.status(200).json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ais proxy failed';
    res.setHeader('Cache-Control', 'public, max-age=3');
    res.setHeader('X-Live-Ships-Source', 'none');
    return res.status(200).json({ ships: [], error: message });
  }
}
