import type { VercelRequest, VercelResponse } from '@vercel/node';

const OPENSKY_URL = 'https://opensky-network.org/api/states/all';
const MAX_LAT_SPAN = 8;
const MAX_LNG_SPAN = 10;
const CACHE_MS = 10_000;
const UPSTREAM_TIMEOUT_MS = 5_000;

type CacheEntry = { at: number; status: number; body: unknown };
const cache = new Map<string, CacheEntry>();

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseBbox(query: VercelRequest['query']): {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
} | null {
  const q = query || {};
  const pick = (k: string) => {
    const raw = q[k];
    return num(Array.isArray(raw) ? raw[0] : raw);
  };
  const lamin = pick('lamin');
  const lomin = pick('lomin');
  const lamax = pick('lamax');
  const lomax = pick('lomax');
  if (lamin == null || lomin == null || lamax == null || lomax == null) return null;
  if (lamin < -90 || lamax > 90 || lamin >= lamax) return null;
  if (lomin < -180 || lomax > 180 || lomin >= lomax) return null;
  if (lamax - lamin > MAX_LAT_SPAN + 0.01) return null;
  if (lomax - lomin > MAX_LNG_SPAN + 0.01) return null;
  return { lamin, lomin, lamax, lomax };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const bbox = parseBbox(req.query);
  if (!bbox) {
    return res.status(400).json({ error: 'lamin,lomin,lamax,lomax required' });
  }

  const key = `${bbox.lamin.toFixed(3)}:${bbox.lomin.toFixed(3)}:${bbox.lamax.toFixed(3)}:${bbox.lomax.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    res.setHeader('Cache-Control', 'public, max-age=8');
    res.setHeader('X-Live-Flights-Cache', 'hit');
    return res.status(hit.status).json(hit.body);
  }

  const url = `${OPENSKY_URL}?lamin=${bbox.lamin}&lomin=${bbox.lomin}&lamax=${bbox.lamax}&lomax=${bbox.lomax}`;
  try {
    const upstream = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'GarbaGin/1.0 (+https://garbagin.com)',
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const text = await upstream.text();
    let body: unknown = { states: [] };
    try {
      body = text ? JSON.parse(text) : { states: [] };
    } catch {
      body = { error: 'OpenSky returned non-JSON', states: [] };
    }
    if (!upstream.ok) {
      res.setHeader('X-Live-Flights-Source', 'opensky');
      return res.status(200).json({
        error: `OpenSky ${upstream.status}`,
        states: Array.isArray((body as { states?: unknown }).states)
          ? (body as { states: unknown[] }).states
          : [],
      });
    }
    cache.set(key, { at: Date.now(), status: 200, body });
    res.setHeader('Cache-Control', 'public, max-age=8');
    res.setHeader('X-Live-Flights-Source', 'opensky');
    return res.status(200).json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OpenSky unreachable';
    // Soft 200 so the client can still merge ADSB without treating this as a hard abort.
    return res.status(200).json({ error: message, states: [] });
  }
}
