/**
 * Same-origin ADSB proxy. Self-contained on purpose: do not import `./_lib/*`.
 *
 * Vercel compiles `api/*.ts` → `*.js` (`renameTStoJS`) but does not rewrite
 * ESM specifiers. With package.json `"type": "module"`, Node then fails
 * `import … from './_lib/adsbNearbyFetch'` at boot → FUNCTION_INVOCATION_FAILED.
 * `/api/opensky-states` works because it has no relative runtime imports.
 *
 * Always prefer HTTP 200 `{ ac, error? }` over 500 so the map can keep polling.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

const CACHE_MS = 10_000;
const UPSTREAM_TIMEOUT_MS = 6_000;

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

type AdsbHost = {
  id: string;
  buildUrl: (lat: number, lon: number, dist: number) => string;
};

type CacheEntry = { at: number; status: number; body: unknown; source: string };
const cache = new Map<string, CacheEntry>();

const ADSB_NEARBY_HOSTS: AdsbHost[] = [
  {
    id: 'adsb.lol',
    buildUrl: (lat, lon, dist) =>
      `https://api.adsb.lol/v2/lat/${encodeURIComponent(String(lat))}/lon/${encodeURIComponent(String(lon))}/dist/${encodeURIComponent(String(dist))}`,
  },
  {
    id: 'adsb.fi',
    buildUrl: (lat, lon, dist) =>
      `https://opendata.adsb.fi/api/v2/lat/${encodeURIComponent(String(lat))}/lon/${encodeURIComponent(String(lon))}/dist/${encodeURIComponent(String(dist))}`,
  },
];

const ADSB_FETCH_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'GarbaGin/1.0 (+https://garbagin.com)',
};

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickAdsbAircraftList(body: unknown): AdsbAircraft[] {
  if (!body || typeof body !== 'object') return [];
  const rec = body as { ac?: unknown; aircraft?: unknown };
  if (Array.isArray(rec.ac)) return rec.ac as AdsbAircraft[];
  if (Array.isArray(rec.aircraft)) return rec.aircraft as AdsbAircraft[];
  return [];
}

function isJsonContentType(contentType: string | null | undefined): boolean {
  return String(contentType || '').toLowerCase().includes('json');
}

function mergeAdsbAircraft(lists: AdsbAircraft[][]): AdsbAircraft[] {
  const merged = new Map<string, AdsbAircraft>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const craft of list) {
      if (!craft || typeof craft !== 'object') continue;
      const hex = String(craft.hex || '').trim().toLowerCase();
      if (hex) merged.set(hex, craft);
    }
  }
  return [...merged.values()];
}

function timeoutSignal(ms: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try {
      controller.abort();
    } catch {
      /* ignore */
    }
  }, ms);
  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timer),
  };
}

function softEmpty(error: string): { ac: AdsbAircraft[]; error: string } {
  return { ac: [], error };
}

export async function queryAdsbNearby(
  lat: number,
  lon: number,
  dist: number,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = UPSTREAM_TIMEOUT_MS
): Promise<{ ac: AdsbAircraft[]; error?: string; source: string }> {
  const settled = await Promise.all(
    ADSB_NEARBY_HOSTS.map(async (host) => {
      const url = host.buildUrl(lat, lon, dist);
      const t = timeoutSignal(timeoutMs);
      try {
        const upstream = await fetchImpl(url, {
          headers: ADSB_FETCH_HEADERS,
          signal: t.signal,
        });
        const contentType = upstream.headers.get('content-type');
        const text = await upstream.text();
        if (!upstream.ok || !isJsonContentType(contentType)) {
          return { id: host.id, ac: [] as AdsbAircraft[], error: `${host.id} ${upstream.status}` };
        }
        let parsed: unknown;
        try {
          parsed = text ? JSON.parse(text) : {};
        } catch {
          return { id: host.id, ac: [] as AdsbAircraft[], error: `${host.id} non-JSON` };
        }
        const ac = pickAdsbAircraftList(parsed);
        return {
          id: host.id,
          ac,
          error: ac.length === 0 ? `${host.id} empty` : null,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unreachable';
        return { id: host.id, ac: [] as AdsbAircraft[], error: `${host.id} ${message}` };
      } finally {
        t.dispose();
      }
    })
  );

  const errors: string[] = [];
  const sources: string[] = [];
  const lists: AdsbAircraft[][] = [];
  for (const row of settled) {
    if (row.error) errors.push(row.error);
    if (row.ac.length === 0) continue;
    sources.push(row.id);
    lists.push(row.ac);
  }

  const ac = mergeAdsbAircraft(lists);
  if (ac.length > 0) {
    return { ac, source: sources.join('+') };
  }
  return {
    ac: [],
    error: errors.join('; ') || 'adsb unreachable',
    source: 'none',
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'OPTIONS') {
      res.setHeader('Allow', 'GET, OPTIONS');
      return res.status(204).end();
    }
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed', ac: [] });
    }

    const q = req.query || {};
    const pick = (k: string) => num(Array.isArray(q[k]) ? q[k][0] : q[k]);
    const lat = pick('lat');
    const lon = pick('lon');
    let dist = pick('dist') ?? 80;
    if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ error: 'lat,lon required', ac: [] });
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

    const result = await queryAdsbNearby(lat, lon, dist);
    const body =
      result.ac.length > 0
        ? { ac: result.ac }
        : { ac: [] as AdsbAircraft[], error: result.error || 'adsb unreachable' };
    cache.set(key, {
      at: Date.now(),
      status: 200,
      body,
      source: result.source,
    });
    res.setHeader('Cache-Control', result.ac.length > 0 ? 'public, max-age=8' : 'public, max-age=4');
    res.setHeader('X-Live-Flights-Source', result.source);
    return res.status(200).json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'adsb proxy failed';
    res.setHeader('Cache-Control', 'public, max-age=4');
    res.setHeader('X-Live-Flights-Source', 'none');
    return res.status(200).json(softEmpty(message));
  }
}
