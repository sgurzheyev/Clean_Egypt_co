import { supabase } from '../../services/supabase';
import {
  isMissingRpcError,
  type VortexHeatCell,
  type VortexSector,
} from './garbaVortex';

export type VortexBBox = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

export type VortexFetch<T> =
  | { ok: true; rows: T }
  | { ok: false; unavailable: boolean };

export function vortexFetchUnavailable<T>(result: VortexFetch<T> | null | undefined): boolean {
  return !!result && result.ok === false && result.unavailable;
}

function asRecord(row: unknown): Record<string, unknown> {
  return row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function fetchVortexHeatmap(
  bbox: VortexBBox,
  zoom: number,
  includeReports: boolean
): Promise<VortexFetch<VortexHeatCell[]>> {
  const { data, error } = await supabase.rpc('get_garba_vortex_heatmap', {
    p_min_lng: bbox.minLng,
    p_min_lat: bbox.minLat,
    p_max_lng: bbox.maxLng,
    p_max_lat: bbox.maxLat,
    p_zoom: zoom,
    p_include_reports: includeReports,
  });
  if (error) {
    return { ok: false, unavailable: isMissingRpcError(error) };
  }
  const rows = (Array.isArray(data) ? data : []).map((raw) => {
    const row = asRecord(raw);
    return {
      lng: num(row.lng),
      lat: num(row.lat),
      weight: num(row.weight),
      pointCount: num(row.point_count),
      maxSeverity: num(row.max_severity, 1),
      isolated: row.isolated === true || row.isolated === 'true',
      blackHole: row.black_hole === true || row.black_hole === 'true',
    };
  });
  return { ok: true, rows };
}

function ringFromGeoJSON(geojson: unknown): number[][] {
  const geom = typeof geojson === 'string' ? safeParse(geojson) : geojson;
  const obj = asRecord(geom);
  const coords = obj.coordinates;
  if (!Array.isArray(coords) || !Array.isArray(coords[0])) return [];
  return (coords[0] as unknown[]).map((pt) => {
    const pair = pt as unknown[];
    return [num(pair[0]), num(pair[1])];
  });
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function fetchVortexSectors(bbox: VortexBBox): Promise<VortexFetch<VortexSector[]>> {
  const { data, error } = await supabase.rpc('get_garba_vortex_sectors', {
    p_min_lng: bbox.minLng,
    p_min_lat: bbox.minLat,
    p_max_lng: bbox.maxLng,
    p_max_lat: bbox.maxLat,
  });
  if (error) {
    return { ok: false, unavailable: isMissingRpcError(error) };
  }
  const rows = (Array.isArray(data) ? data : []).map((raw) => {
    const row = asRecord(raw);
    return {
      id: String(row.id ?? ''),
      status: String(row.status ?? ''),
      pinCount: num(row.pin_count),
      severitySum: num(row.severity_sum),
      missionId: row.mission_id ? String(row.mission_id) : null,
      centerLng: num(row.center_lng),
      centerLat: num(row.center_lat),
      ring: ringFromGeoJSON(row.geojson),
    };
  });
  return { ok: true, rows: rows.filter((s) => s.id && s.ring.length >= 4) };
}

export type VortexPinPlan = {
  unavailable?: boolean;
  ok: boolean;
  action?: 'create' | 'bump' | 'bumped' | 'created';
  id?: string;
  code?: string;
  tokensSpent?: number;
};

export async function previewFreeVortexPin(lat: number, lng: number): Promise<VortexPinPlan> {
  const { data, error } = await supabase.rpc('place_free_vortex_pin', {
    p_location_lat: lat,
    p_location_lng: lng,
    p_description: '#GarbageZone',
    p_photo_urls: [],
    p_commit: false,
  });
  if (error) {
    if (isMissingRpcError(error)) return { ok: true, unavailable: true };
    return { ok: false, code: error.message };
  }
  const row = asRecord(data);
  return {
    ok: row.ok !== false,
    action: (row.action as VortexPinPlan['action']) || undefined,
    id: row.id ? String(row.id) : undefined,
    tokensSpent: num(row.tokens_spent),
  };
}

export async function placeFreeVortexPin(input: {
  lat: number;
  lng: number;
  description: string;
  photoUrls: string[];
  serviceType: string;
  country: string | null;
  city: string | null;
  videoProofUrl: string | null;
}): Promise<VortexPinPlan> {
  const { data, error } = await supabase.rpc('place_free_vortex_pin', {
    p_location_lat: input.lat,
    p_location_lng: input.lng,
    p_description: input.description,
    p_photo_urls: input.photoUrls,
    p_service_type: input.serviceType,
    p_country: input.country,
    p_city: input.city,
    p_video_proof_url: input.videoProofUrl,
    p_commit: true,
  });
  if (error) {
    return { ok: false, unavailable: isMissingRpcError(error), code: error.message };
  }
  const row = asRecord(data);
  return {
    ok: true,
    action: (row.action as VortexPinPlan['action']) || 'created',
    id: row.id ? String(row.id) : undefined,
    tokensSpent: num(row.tokens_spent),
  };
}
