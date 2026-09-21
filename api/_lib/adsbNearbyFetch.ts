/**
 * ADSB nearby upstreams for `/api/adsb-nearby`.
 * adsb.lol often returns Cloudflare HTML 403 from Vercel datacenter IPs;
 * opendata.adsb.fi uses `{ aircraft: [] }` instead of `{ ac: [] }`.
 * Always normalize to `{ ac }` for the browser client.
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

type AdsbHost = {
  id: string;
  buildUrl: (lat: number, lon: number, dist: number) => string;
};

export const ADSB_NEARBY_HOSTS: AdsbHost[] = [
  {
    id: 'adsb.lol',
    buildUrl: (lat, lon, dist) =>
      `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${dist}`,
  },
  {
    id: 'adsb.fi',
    buildUrl: (lat, lon, dist) =>
      `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${dist}`,
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
