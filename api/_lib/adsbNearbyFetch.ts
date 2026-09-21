/**
 * ADSB nearby upstreams for `/api/adsb-nearby`.
 * adsb.lol often returns Cloudflare HTML 403 from Vercel datacenter IPs;
 * opendata.adsb.fi uses `{ aircraft: [] }` instead of `{ ac: [] }`.
 * Always normalize to `{ ac }` for the browser client.
 *
 * Production `/api/adsb-nearby.ts` inlines these helpers (do not import this
 * file from that handler). Vercel compiles `.ts` → `.js` but leaves ESM
 * specifiers extensionless, so Node  (`"type": "module"`) cannot resolve
 * `./_lib/adsbNearbyFetch` and the lambda dies with FUNCTION_INVOCATION_FAILED.
 */

export type AdsbAircraft = {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | 'ground';
  alt_geom?: number;
  track?: number;
  gs?: number;
};

export type AdsbHost = {
  id: string;
  buildUrl: (lat: number, lon: number, dist: number) => string;
};

export type AdsbNearbyResult = {
  ac: AdsbAircraft[];
  error?: string;
  source: string;
};

export const ADSB_NEARBY_HOSTS: AdsbHost[] = [
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

export const ADSB_FETCH_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'GarbaGin/1.0 (+https://garbagin.com)',
} as const;

export function pickAdsbAircraftList(body: unknown): AdsbAircraft[] {
  if (!body || typeof body !== 'object') return [];
  const rec = body as { ac?: unknown; aircraft?: unknown };
  if (Array.isArray(rec.ac)) return rec.ac as AdsbAircraft[];
  if (Array.isArray(rec.aircraft)) return rec.aircraft as AdsbAircraft[];
  return [];
}

export function isJsonContentType(contentType: string | null | undefined): boolean {
  return String(contentType || '').toLowerCase().includes('json');
}

export function mergeAdsbAircraft(lists: AdsbAircraft[][]): AdsbAircraft[] {
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

export function timeoutSignal(ms: number): { signal: AbortSignal; dispose: () => void } {
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

export async function queryAdsbNearby(
  lat: number,
  lon: number,
  dist: number,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 6_000
): Promise<AdsbNearbyResult> {
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
