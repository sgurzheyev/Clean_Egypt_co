/**
 * Same-origin AISStream proxy. Self-contained: do not import `./_lib/*`.
 *
 * AISStream blocks browser WebSockets. The map polls this lambda instead.
 * Frames are **binary UTF-8 JSON**. Since September 2026, uncompressed
 * connections are bandwidth-limited and frames are dropped — the official
 * client is the `ws` package with `{ perMessageDeflate: true }`.
 * Global/undici `WebSocket` cannot negotiate that extension, so Vercel
 * collected 0 ships in ~3s (`error: empty`) even with a valid key.
 *
 * Prefer server env `AISSTREAM_API_KEY` (not inlined). Falls back to
 * `VITE_AISSTREAM_API_KEY`. Never 500: always `{ ships, error? }`.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Ws from 'ws';

export const config = { maxDuration: 15 };

const AISSTREAM_WS_URL = 'wss://stream.aisstream.io/v0/stream';
const CACHE_MS = 8_000;
const EMPTY_CACHE_MS = 2_000;
const COLLECT_MS = 5_000;
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

type CacheEntry = { at: number; status: number; body: unknown; source: string; frames: number };
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

export type AisClientSocket = {
  readyState: number;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  addEventListener?(event: string, listener: (ev?: { data?: unknown }) => void): void;
  send(data: string): void;
  close(): void;
};

export type QueryAisNearbyResult = {
  ships: AisShip[];
  error?: string;
  source: string;
  frames: number;
  confirmed: boolean;
};

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

/** Decode a binary (or text) AISStream frame to UTF-8 JSON text. */
export function decodeAisProxyFrame(data: unknown): unknown | null {
  try {
    let text = '';
    if (typeof data === 'string') text = data;
    else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) text = data.toString('utf8');
    else if (Array.isArray(data) && data.length > 0 && typeof Buffer !== 'undefined' && data.every((p) => Buffer.isBuffer(p))) {
      text = Buffer.concat(data as Buffer[]).toString('utf8');
    } else if (data instanceof ArrayBuffer) text = new TextDecoder().decode(data);
    else if (ArrayBuffer.isView(data)) {
      text = new TextDecoder().decode(data as ArrayBufferView);
    } else if (data && typeof data === 'object' && 'type' in data && (data as { type?: string }).type === 'Buffer' && Array.isArray((data as { data?: unknown }).data)) {
      text = Buffer.from((data as { data: number[] }).data).toString('utf8');
    } else {
      text = '';
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

function defaultCreateSocket(url: string): AisClientSocket {
  return new Ws(url, { perMessageDeflate: true }) as unknown as AisClientSocket;
}

function listen(socket: AisClientSocket, event: string, fn: (...args: unknown[]) => void): void {
  if (typeof socket.on === 'function') {
    socket.on(event, fn);
    return;
  }
  if (typeof socket.addEventListener === 'function') {
    socket.addEventListener(event, (ev) => {
      fn(event === 'message' ? ev?.data : ev);
    });
  }
}

export async function queryAisNearby(
  bbox: { lamin: number; lomin: number; lamax: number; lomax: number },
  apiKey: string,
  collectMs = COLLECT_MS,
  createSocket: (url: string) => AisClientSocket = defaultCreateSocket
): Promise<QueryAisNearbyResult> {
  if (!usableKey(apiKey)) {
    return { ships: [], error: 'need-key', source: 'none', frames: 0, confirmed: false };
  }

  const waitMs = Number(collectMs);
  const collectFor = Number.isFinite(waitMs) && waitMs > 0 ? waitMs : COLLECT_MS;

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
  let frames = 0;
  let confirmed = false;

  await new Promise<void>((resolve) => {
    let settled = false;
    let ws: AisClientSocket;
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
      ws = createSocket(AISSTREAM_WS_URL);
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'ws';
      resolve();
      return;
    }

    openTimer = setTimeout(() => {
      if (ws.readyState !== 1) {
        lastError = lastError || 'ws';
        finish();
      }
    }, OPEN_TIMEOUT_MS);

    collectTimer = setTimeout(finish, collectFor);

    listen(ws, 'open', () => {
      try {
        ws.send(sub);
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'ws';
        finish();
      }
    });

    listen(ws, 'message', (data) => {
      frames += 1;
      const parsed = decodeAisProxyFrame(data);
      if (!parsed || typeof parsed !== 'object') return;
      const rec = parsed as { error?: unknown; Error?: unknown; MessageType?: string };
      if (rec.MessageType === 'SubscriptionConfirmation') {
        confirmed = true;
        return;
      }
      const errText = rec.error ?? rec.Error;
      if (errText) {
        lastError = String(errText).slice(0, 80);
        return;
      }
      const ship = parseShip(parsed);
      if (ship) merged.set(ship.mmsi, ship);
    });

    listen(ws, 'error', () => {
      lastError = lastError || 'ws';
    });

    listen(ws, 'close', () => {
      if (!settled && merged.size === 0 && !confirmed) {
        lastError = lastError || 'ws';
      }
      finish();
    });
  });

  const ships = [...merged.values()];
  if (ships.length > 0) {
    return { ships, source: 'aisstream', frames, confirmed };
  }
  // Opened + confirmed but no vessels in the box → honest empty.
  // No frames at all (typical when deflate is missing) → `ws` so the chip
  // does not look like "Bosphorus has 0 ships".
  const error = lastError || (confirmed ? 'empty' : frames > 0 ? 'ws' : 'ws');
  return { ships: [], error, source: 'none', frames, confirmed };
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
    const ttl = hit && hit.source === 'aisstream' ? CACHE_MS : EMPTY_CACHE_MS;
    if (hit && Date.now() - hit.at < ttl) {
      res.setHeader('Cache-Control', 'public, max-age=6');
      res.setHeader('X-Live-Ships-Cache', 'hit');
      res.setHeader('X-Live-Ships-Source', hit.source);
      res.setHeader('X-Live-Ships-Frames', String(hit.frames));
      return res.status(hit.status).json(hit.body);
    }

    const result = await queryAisNearby({ lamin, lomin, lamax, lomax }, readAisKey());
    const body =
      result.ships.length > 0
        ? { ships: result.ships }
        : { ships: [] as AisShip[], error: result.error || 'empty' };
    cache.set(key, {
      at: Date.now(),
      status: 200,
      body,
      source: result.source,
      frames: result.frames,
    });
    res.setHeader('Cache-Control', result.ships.length > 0 ? 'public, max-age=6' : 'public, max-age=3');
    res.setHeader('X-Live-Ships-Source', result.source);
    res.setHeader('X-Live-Ships-Frames', String(result.frames));
    return res.status(200).json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ais proxy failed';
    res.setHeader('Cache-Control', 'public, max-age=3');
    res.setHeader('X-Live-Ships-Source', 'none');
    res.setHeader('X-Live-Ships-Frames', '0');
    return res.status(200).json({ ships: [], error: message });
  }
}
