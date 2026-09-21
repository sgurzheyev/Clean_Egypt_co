import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  ADSB_FETCH_HEADERS,
  ADSB_NEARBY_HOSTS,
  isJsonContentType,
  pickAdsbAircraftList,
} from './_lib/adsbNearbyFetch';

const CACHE_MS = 10_000;
const UPSTREAM_TIMEOUT_MS = 6_000;

type CacheEntry = { at: number; status: number; body: unknown; source: string };
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
    res.setHeader('X-Live-Flights-Source', hit.source);
    return res.status(hit.status).json(hit.body);
  }

  const settled = await Promise.all(
    ADSB_NEARBY_HOSTS.map(async (host) => {
      const url = host.buildUrl(lat, lon, dist);
      try {
        const upstream = await fetch(url, {
          headers: ADSB_FETCH_HEADERS,
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
        const contentType = upstream.headers.get('content-type');
        const text = await upstream.text();
        if (!upstream.ok || !isJsonContentType(contentType)) {
          return { id: host.id, ac: [] as ReturnType<typeof pickAdsbAircraftList>, error: `${host.id} ${upstream.status}` };
        }
        let parsed: unknown;
        try {
          parsed = text ? JSON.parse(text) : {};
        } catch {
          return { id: host.id, ac: [] as ReturnType<typeof pickAdsbAircraftList>, error: `${host.id} non-JSON` };
        }
        const ac = pickAdsbAircraftList(parsed);
        return {
          id: host.id,
          ac,
          error: ac.length === 0 ? `${host.id} empty` : null,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unreachable';
        return { id: host.id, ac: [] as ReturnType<typeof pickAdsbAircraftList>, error: `${host.id} ${message}` };
      }
    })
  );

  const errors: string[] = [];
  const merged = new Map<string, ReturnType<typeof pickAdsbAircraftList>[number]>();
  const sources: string[] = [];
  for (const row of settled) {
    if (row.error) errors.push(row.error);
    if (row.ac.length === 0) continue;
    sources.push(row.id);
    for (const craft of row.ac) {
      const hex = String(craft.hex || '').trim().toLowerCase();
      if (hex) merged.set(hex, craft);
    }
  }

  if (merged.size > 0) {
    const body = { ac: [...merged.values()] };
    const source = sources.join('+');
    cache.set(key, { at: Date.now(), status: 200, body, source });
    res.setHeader('Cache-Control', 'public, max-age=8');
    res.setHeader('X-Live-Flights-Source', source);
    return res.status(200).json(body);
  }

  const body = { error: errors.join('; ') || 'adsb unreachable', ac: [] };
  res.setHeader('Cache-Control', 'public, max-age=4');
  res.setHeader('X-Live-Flights-Source', 'none');
  return res.status(200).json(body);
}
