/**
 * Contractor / business storefront — types + Supabase CRUD helpers.
 * Backed by public.contractor_stores (see 20260726_contractor_stores.sql).
 */
import { supabase } from '../../services/supabase';
import type { ServiceType } from './serviceSectors';

/** GeoJSON Polygon coordinates: outer ring first, then holes. */
export type GeoJsonPosition = [number, number]; // [lng, lat]

export type ServiceRadiusPolygon = {
  type: 'Polygon';
  coordinates: GeoJsonPosition[][];
};

export type ContractorStore = {
  id: string;
  owner_id: string;
  office_lat: number | null;
  office_lng: number | null;
  office_address: string | null;
  service_radius_polygon: ServiceRadiusPolygon | null;
  offered_services: string[];
  materials_and_chemicals: string[];
  store_photos: string[];
  store_name: string | null;
  store_bio: string | null;
  is_published: boolean;
  created_at?: string;
  updated_at?: string;
};

export type ContractorStoreDraft = {
  office_lat: number | null;
  office_lng: number | null;
  office_address: string;
  service_radius_polygon: ServiceRadiusPolygon | null;
  offered_services: ServiceType[] | string[];
  materials_and_chemicals: string[];
  store_photos: string[];
  store_name: string;
  store_bio: string;
  is_published: boolean;
};

export const EMPTY_STORE_DRAFT: ContractorStoreDraft = {
  office_lat: null,
  office_lng: null,
  office_address: '',
  service_radius_polygon: null,
  offered_services: [],
  materials_and_chemicals: [],
  store_photos: [],
  store_name: '',
  store_bio: '',
  is_published: false,
};

export const STORE_PHOTOS_MAX = 12;
export const STORE_MATERIALS_MAX = 48;

function normalizeStringList(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const s = String(raw ?? '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

function normalizePolygon(value: unknown): ServiceRadiusPolygon | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { type?: string; coordinates?: unknown };
  if (v.type !== 'Polygon' || !Array.isArray(v.coordinates)) return null;
  const rings = v.coordinates as unknown[];
  if (rings.length === 0) return null;
  const normalized: GeoJsonPosition[][] = [];
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 3) continue;
    const pts: GeoJsonPosition[] = [];
    for (const p of ring) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const lng = Number(p[0]);
      const lat = Number(p[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      pts.push([lng, lat]);
    }
    if (pts.length >= 3) {
      // Close the ring if needed.
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        pts.push([first[0], first[1]]);
      }
      normalized.push(pts);
    }
  }
  if (normalized.length === 0) return null;
  return { type: 'Polygon', coordinates: normalized };
}

export function rowToContractorStore(row: Record<string, unknown>): ContractorStore {
  return {
    id: String(row.id),
    owner_id: String(row.owner_id),
    office_lat:
      row.office_lat == null || !Number.isFinite(Number(row.office_lat))
        ? null
        : Number(row.office_lat),
    office_lng:
      row.office_lng == null || !Number.isFinite(Number(row.office_lng))
        ? null
        : Number(row.office_lng),
    office_address: (row.office_address as string | null) ?? null,
    service_radius_polygon: normalizePolygon(row.service_radius_polygon),
    offered_services: normalizeStringList(row.offered_services, 32),
    materials_and_chemicals: normalizeStringList(row.materials_and_chemicals, STORE_MATERIALS_MAX),
    store_photos: normalizeStringList(row.store_photos, STORE_PHOTOS_MAX),
    store_name: (row.store_name as string | null) ?? null,
    store_bio: (row.store_bio as string | null) ?? null,
    is_published: Boolean(row.is_published),
    created_at: row.created_at ? String(row.created_at) : undefined,
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export function storeToDraft(store: ContractorStore | null): ContractorStoreDraft {
  if (!store) return { ...EMPTY_STORE_DRAFT };
  return {
    office_lat: store.office_lat,
    office_lng: store.office_lng,
    office_address: store.office_address ?? '',
    service_radius_polygon: store.service_radius_polygon,
    offered_services: [...store.offered_services],
    materials_and_chemicals: [...store.materials_and_chemicals],
    store_photos: [...store.store_photos],
    store_name: store.store_name ?? '',
    store_bio: store.store_bio ?? '',
    is_published: store.is_published,
  };
}

/** Build a closed GeoJSON polygon from an open ring of [lng, lat] vertices. */
export function polygonFromRing(ring: GeoJsonPosition[]): ServiceRadiusPolygon | null {
  if (ring.length < 3) return null;
  const closed = [...ring];
  const first = closed[0];
  const last = closed[closed.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    closed.push([first[0], first[1]]);
  }
  return { type: 'Polygon', coordinates: [closed] };
}

export async function fetchContractorStore(
  ownerId: string
): Promise<ContractorStore | null> {
  const { data, error } = await supabase.rpc('get_contractor_store', {
    p_owner_id: ownerId,
  });
  if (error) {
    // Fallback to direct select (e.g. migration not yet applied on a local DB).
    const { data: rows, error: selErr } = await supabase
      .from('contractor_stores')
      .select('*')
      .eq('owner_id', ownerId)
      .maybeSingle();
    if (selErr) throw selErr;
    return rows ? rowToContractorStore(rows as Record<string, unknown>) : null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row ? rowToContractorStore(row as Record<string, unknown>) : null;
}

export async function upsertContractorStore(
  ownerId: string,
  draft: ContractorStoreDraft
): Promise<ContractorStore> {
  const payload = {
    owner_id: ownerId,
    office_lat: draft.office_lat,
    office_lng: draft.office_lng,
    office_address: draft.office_address.trim() || null,
    service_radius_polygon: draft.service_radius_polygon,
    offered_services: normalizeStringList(draft.offered_services, 32),
    materials_and_chemicals: normalizeStringList(
      draft.materials_and_chemicals,
      STORE_MATERIALS_MAX
    ),
    store_photos: normalizeStringList(draft.store_photos, STORE_PHOTOS_MAX),
    store_name: draft.store_name.trim() || null,
    store_bio: draft.store_bio.trim() || null,
    is_published: Boolean(draft.is_published),
  };

  const { data, error } = await supabase
    .from('contractor_stores')
    .upsert(payload, { onConflict: 'owner_id' })
    .select('*')
    .single();

  if (error) throw error;
  return rowToContractorStore(data as Record<string, unknown>);
}

/** Upload a store gallery image under order-photos/stores/{userId}/… */
export async function uploadStorePhoto(
  userId: string,
  file: File
): Promise<string> {
  const path = `stores/${userId}/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
  const { error } = await supabase.storage
    .from('order-photos')
    .upload(path, file, { upsert: false, contentType: 'image/jpeg' });
  if (error) throw error;
  const {
    data: { publicUrl },
  } = supabase.storage.from('order-photos').getPublicUrl(path);
  return publicUrl;
}
