/**
 * Public Garba-Vortex heatmap.
 * Calm: live RPC, Cache-Control private/no-store.
 * Storm: averaged snapshot from get_garba_vortex_heatmap, public cache headers,
 * plus a short in-memory lambda cache so a warm isolate does not stampede Postgres.
 *
 * No user JWT. The map is world-readable. Missing Supabase env returns 503 so
 * the client can call the RPC with its own anon key.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

/**
 * Self-contained on purpose. Vercel compiles api/*.ts to api/*.js and does not
 * rewrite relative ESM specifiers, so this file must not import ../src or ./_lib.
 * Keep stormCacheControl / parseVortexHeatmapQuery in sync with src/lib/garbaVortex.ts.
 */

type VortexHeatmapQuery = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
  zoom: number;
  includeReports: boolean;
};

export function stormCacheControl(active: boolean, seconds: number): string {
  if (!active) return 'private, no-store';
  const raw = Number(seconds);
  const ttl = Number.isFinite(raw) ? Math.min(300, Math.max(5, Math.round(raw))) : 30;
  return `public, max-age=${ttl}, s-maxage=${ttl}, stale-while-revalidate=${ttl * 2}`;
}

function requiredQueryNumber(params: URLSearchParams, ...names: string[]): number {
  const raw = queryParam(params, ...names);
  if (raw == null) return Number.NaN;
  return Number(raw);
}

function queryParam(params: URLSearchParams, ...names: string[]): string | null {
  for (const name of names) {
    const value = params.get(name);
    if (value != null && value.trim() !== '') return value.trim();
  }
  return null;
}

export function parseVortexHeatmapQuery(
  params: URLSearchParams
): { ok: true; query: VortexHeatmapQuery } | { ok: false; error: string } {
  const minLng = requiredQueryNumber(params, 'minLng', 'min_lng');
  const minLat = requiredQueryNumber(params, 'minLat', 'min_lat');
  const maxLng = requiredQueryNumber(params, 'maxLng', 'max_lng');
  const maxLat = requiredQueryNumber(params, 'maxLat', 'max_lat');
  const zoomRaw = queryParam(params, 'zoom');
  const zoom = zoomRaw == null ? 4 : Number(zoomRaw);
  const includeRaw = (queryParam(params, 'includeReports', 'include_reports') || '1').toLowerCase();
  if (![minLng, minLat, maxLng, maxLat, zoom].every(Number.isFinite)) {
    return { ok: false, error: 'minLng, minLat, maxLng, maxLat, zoom required' };
  }
  if (minLat < -90 || minLat > 90 || maxLat < -90 || maxLat > 90 || minLat > maxLat) {
    return { ok: false, error: 'latitude out of range' };
  }
  if (minLng < -180 || minLng > 180 || maxLng < -180 || maxLng > 180) {
    return { ok: false, error: 'longitude out of range' };
  }
  if (zoom < 0 || zoom > 22) return { ok: false, error: 'zoom out of range' };
  return {
    ok: true,
    query: {
      minLng,
      minLat,
      maxLng,
      maxLat,
      zoom,
      includeReports: includeRaw !== '0' && includeRaw !== 'false',
    },
  };
}

export const config = { maxDuration: 15 };

type CacheEntry = { at: number; ttlMs: number; body: HeatmapBody; cacheControl: string };

type HeatmapBody = {
  storm: boolean;
  cache_seconds: number;
  cells: unknown[];
  error?: string;
};

const memory = new Map<string, CacheEntry>();

function envValue(name: string, extra?: Record<string, string | undefined>): string {
  const fromExtra = extra?.[name];
  if (fromExtra && fromExtra.trim()) return fromExtra.trim();
  return String(process.env[name] || '').trim();
}

export function heatmapMemoryKey(query: VortexHeatmapQuery): string {
  const q = (n: number) => Math.round(n * 20) / 20;
  return [
    q(query.minLng),
    q(query.minLat),
    q(query.maxLng),
    q(query.maxLat),
    Math.round(query.zoom * 2) / 2,
    query.includeReports ? '1' : '0',
  ].join(':');
}

export function readHeatmapMemory(key: string, now = Date.now()): CacheEntry | null {
  const hit = memory.get(key);
  if (!hit) return null;
  if (now - hit.at > hit.ttlMs) {
    memory.delete(key);
    return null;
  }
  return hit;
}

export function writeHeatmapMemory(key: string, body: HeatmapBody, cacheControl: string, now = Date.now()): void {
  if (!body.storm) return;
  const ttlMs = Math.min(300, Math.max(5, body.cache_seconds || 30)) * 1000;
  memory.set(key, { at: now, ttlMs, body, cacheControl });
  if (memory.size > 80) {
    const oldest = memory.keys().next().value;
    if (oldest) memory.delete(oldest);
  }
}

export async function queryGarbaVortexHeatmap(input: {
  searchParams: URLSearchParams;
  supabaseUrl?: string;
  anonKey?: string;
  now?: number;
}): Promise<{ status: number; cacheControl: string; body: HeatmapBody }> {
  const parsed = parseVortexHeatmapQuery(input.searchParams);
  if (parsed.ok === false) {
    return {
      status: 400,
      cacheControl: 'private, no-store',
      body: { storm: false, cache_seconds: 0, cells: [], error: parsed.error },
    };
  }

  const now = input.now ?? Date.now();
  const key = heatmapMemoryKey(parsed.query);
  const cached = readHeatmapMemory(key, now);
  if (cached) {
    return { status: 200, cacheControl: cached.cacheControl, body: cached.body };
  }

  const supabaseUrl = input.supabaseUrl || envValue('SUPABASE_URL') || envValue('VITE_SUPABASE_URL');
  const anonKey = input.anonKey || envValue('VITE_SUPABASE_ANON_KEY') || envValue('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) {
    return {
      status: 503,
      cacheControl: 'private, no-store',
      body: { storm: false, cache_seconds: 0, cells: [], error: 'supabase_unconfigured' },
    };
  }

  try {
    const client = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const q = parsed.query;
    const heat = await client.rpc('get_garba_vortex_heatmap', {
      p_min_lng: q.minLng,
      p_min_lat: q.minLat,
      p_max_lng: q.maxLng,
      p_max_lat: q.maxLat,
      p_zoom: q.zoom,
      p_include_reports: q.includeReports,
    });
    if (heat.error) {
      return {
        status: 503,
        cacheControl: 'private, no-store',
        body: { storm: false, cache_seconds: 0, cells: [], error: 'heatmap_unavailable' },
      };
    }
    const status = await client.rpc('get_garba_vortex_public_status');
    const statusRow =
      status.data && typeof status.data === 'object' ? (status.data as { storm?: boolean; cache_seconds?: number }) : null;
    const storm = statusRow?.storm === true;
    const cacheSeconds = storm ? Number(statusRow?.cache_seconds ?? 30) : 0;
    const cacheControl = stormCacheControl(storm, cacheSeconds);
    const body: HeatmapBody = {
      storm,
      cache_seconds: storm ? Math.min(300, Math.max(5, Math.round(cacheSeconds || 30))) : 0,
      cells: Array.isArray(heat.data) ? heat.data : [],
    };
    writeHeatmapMemory(key, body, cacheControl, now);
    return { status: 200, cacheControl, body };
  } catch {
    return {
      status: 503,
      cacheControl: 'private, no-store',
      body: { storm: false, cache_seconds: 0, cells: [], error: 'heatmap_unavailable' },
    };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const url = new URL(req.url || '/api/garba-vortex-heatmap', 'http://localhost');
  const result = await queryGarbaVortexHeatmap({ searchParams: url.searchParams });
  res.setHeader('Cache-Control', result.cacheControl);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'HEAD') {
    res.status(result.status).end();
    return;
  }
  res.status(result.status).json(result.body);
}
