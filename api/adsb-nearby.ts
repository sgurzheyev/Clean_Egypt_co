import type { VercelRequest, VercelResponse } from '@vercel/node';

const ADSB_BASE = 'https://api.adsb.lol/v2/lat';
const CACHE_MS = 10_000;

type CacheEntry = { at: number; status: number; body: unknown };
const cache = new Map<string, CacheEntry>();

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const q = req.query || {};
  const pick = (k: string) => num(Array.isArray(q[k]) ? q[k][0] : q[k]);
  const lat = pick('lat');
  const lon = pick('lon');
  let dist = pick('dist') ?? 80;
  if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json({ error: 'lat,lon required' });
  }
  dist = Math.max(15, Math.min(220, Math.round(dist)));

  const key = `${lat.toFixed(3)}:${lon.toFixed(3)}:${dist}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    res.setHeader('Cache-Control', 'public, max-age=8');
    res.setHeader('X-Live-Flights-Cache', 'hit');
    return res.status(hit.status).json(hit.body);
  }

  const url = `${ADSB_BASE}/${lat}/lon/${lon}/dist/${dist}`;
  try {
    const upstream = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    const text = await upstream.text();
    let body: unknown = { ac: [] };
    try {
      body = text ? JSON.parse(text) : { ac: [] };
    } catch {
      body = { error: 'adsb.lol returned non-JSON', ac: [] };
    }
    cache.set(key, { at: Date.now(), status: upstream.status, body });
    res.setHeader('Cache-Control', 'public, max-age=8');
    res.setHeader('X-Live-Flights-Source', 'adsb.lol');
    return res.status(upstream.ok ? 200 : upstream.status).json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'adsb.lol unreachable';
    return res.status(502).json({ error: message, ac: [] });
  }
}
