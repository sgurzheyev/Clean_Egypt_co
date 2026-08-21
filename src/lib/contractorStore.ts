/**
 * Contractor / business storefront — types + Supabase CRUD helpers.
 * Backed by public.contractor_stores + store_supplies
 * (see 20260726_contractor_stores.sql, 20260726_store_supplies_bundles_recurrence.sql).
 *
 * Service catalog: `store_service_skus` (JSONB) is the source of truth for priced
 * SKUs. Legacy `offered_services text[]` is kept in sync as service ids for map
 * filters and older clients.
 */
import { supabase } from '../../services/supabase';
import type { ServiceType } from './serviceSectors';
import { findServiceOption } from './serviceSectors';
import { DEFAULT_STORE_COLOR, normalizeStoreColor } from './mapboxStandardTheme';

export { DEFAULT_STORE_COLOR, normalizeStoreColor };
/** GeoJSON Polygon coordinates: outer ring first, then holes. */
export type GeoJsonPosition = [number, number]; // [lng, lat]

export type ServiceRadiusPolygon = {
  type: 'Polygon';
  coordinates: GeoJsonPosition[][];
};

/** Subscribe & Save cadence (missions + store availability). */
export type RecurrenceType = 'one_time' | 'weekly' | 'bi_weekly' | 'monthly';

export const RECURRENCE_TYPES: RecurrenceType[] = [
  'one_time',
  'weekly',
  'bi_weekly',
  'monthly',
];

export type SupplyCategory =
  | 'Eco-Chemical'
  | 'Heavy Equipment'
  | 'Hygiene Supply';

export const SUPPLY_CATEGORIES: SupplyCategory[] = [
  'Eco-Chemical',
  'Heavy Equipment',
  'Hygiene Supply',
];

export type StoreSupply = {
  id: string;
  store_id: string;
  name: string;
  brand: string | null;
  category: SupplyCategory;
  image_url: string | null;
  is_included_in_service: boolean;
  extra_price: number | null;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
};

export type StoreSupplyDraft = {
  name: string;
  brand: string;
  category: SupplyCategory;
  image_url: string | null;
  is_included_in_service: boolean;
  extra_price: number | '';
};

export const EMPTY_SUPPLY_DRAFT: StoreSupplyDraft = {
  name: '',
  brand: '',
  category: 'Hygiene Supply',
  image_url: null,
  is_included_in_service: true,
  extra_price: '',
};

export type ServiceBundle = {
  id: string;
  title: string;
  description: string;
  service_ids: string[];
  starting_price: number;
};

/** Price unit for a storefront service SKU (floor price display). */
export type StoreServiceUnit = 'job' | 'hour' | 'sqm';

export const STORE_SERVICE_UNITS: StoreServiceUnit[] = ['job', 'hour', 'sqm'];

/**
 * Priced service card on a contractor storefront.
 * `id` matches `missions.service_type` / sector catalog (e.g. junk_removal).
 */
export type StoreServiceSku = {
  id: string;
  name: string;
  /** Floor / starting price in USD (integer dollars, same as bundles). */
  base_price: number;
  unit: StoreServiceUnit;
};

export type ContractorStore = {
  id: string;
  owner_id: string;
  office_lat: number | null;
  office_lng: number | null;
  office_address: string | null;
  service_radius_polygon: ServiceRadiusPolygon | null;
  /**
   * Legacy service-id tags. Kept in sync with `store_service_skus[].id`
   * for map filters and older readers.
   */
  offered_services: string[];
  /** Priced service catalog (JSONB). Source of truth for SKU UI. */
  store_service_skus: StoreServiceSku[];
  materials_and_chemicals: string[];
  store_photos: string[];
  store_name: string | null;
  store_bio: string | null;
  is_published: boolean;
  /** HEX `#rrggbb` for map coverage + pin. */
  color: string;
  service_bundles: ServiceBundle[];
  recurrence_type: RecurrenceType;
  supported_recurrence_types: RecurrenceType[];
  created_at?: string;
  updated_at?: string;
};

export type ContractorStoreDraft = {
  office_lat: number | null;
  office_lng: number | null;
  office_address: string;
  service_radius_polygon: ServiceRadiusPolygon | null;
  /**
   * @deprecated Prefer `store_service_skus`. Still accepted on upsert and
   * hydrated into SKUs when the catalog array is empty (old panel saves).
   */
  offered_services: ServiceType[] | string[];
  store_service_skus: StoreServiceSku[];
  materials_and_chemicals: string[];
  store_photos: string[];
  store_name: string;
  store_bio: string;
  is_published: boolean;
  color: string;
  service_bundles: ServiceBundle[];
  recurrence_type: RecurrenceType;
  supported_recurrence_types: RecurrenceType[];
};

export const EMPTY_STORE_DRAFT: ContractorStoreDraft = {
  office_lat: null,
  office_lng: null,
  office_address: '',
  service_radius_polygon: null,
  offered_services: [],
  store_service_skus: [],
  materials_and_chemicals: [],
  store_photos: [],
  store_name: '',
  store_bio: '',
  is_published: false,
  color: DEFAULT_STORE_COLOR,
  service_bundles: [],
  recurrence_type: 'one_time',
  supported_recurrence_types: ['one_time'],
};

export const STORE_PHOTOS_MAX = 12;
export const STORE_MATERIALS_MAX = 48;
export const STORE_SUPPLIES_MAX = 48;
export const STORE_BUNDLES_MAX = 12;
export const STORE_SERVICE_SKUS_MAX = 32;

export function isRecurrenceType(value: unknown): value is RecurrenceType {
  return (
    value === 'one_time' ||
    value === 'weekly' ||
    value === 'bi_weekly' ||
    value === 'monthly'
  );
}

export function normalizeRecurrenceType(value: unknown): RecurrenceType {
  return isRecurrenceType(value) ? value : 'one_time';
}

function normalizeRecurrenceList(value: unknown): RecurrenceType[] {
  if (!Array.isArray(value) || value.length === 0) return ['one_time'];
  const out: RecurrenceType[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecurrenceType(raw) || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out.length > 0 ? out : ['one_time'];
}

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

function coercePolygonCandidate(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  return value;
}

function normalizePolygon(value: unknown): ServiceRadiusPolygon | null {
  let raw = coercePolygonCandidate(value);
  if (!raw || typeof raw !== 'object') return null;

  // Accept Feature / FeatureCollection wrappers from some clients.
  const asRec = raw as {
    type?: string;
    geometry?: unknown;
    features?: unknown[];
    coordinates?: unknown;
  };
  if (asRec.type === 'Feature' && asRec.geometry) {
    raw = asRec.geometry;
  } else if (
    asRec.type === 'FeatureCollection' &&
    Array.isArray(asRec.features) &&
    asRec.features[0] &&
    typeof asRec.features[0] === 'object'
  ) {
    const feat = asRec.features[0] as { geometry?: unknown };
    raw = feat.geometry ?? null;
  }

  if (!raw || typeof raw !== 'object') return null;
  const v = raw as { type?: string; coordinates?: unknown };
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

/** [[west, south], [east, north]] for Mapbox fitBounds, or null if empty. */
export function polygonLngLatBounds(
  polygon: ServiceRadiusPolygon | null | undefined
): [[number, number], [number, number]] | null {
  const ring = polygon?.coordinates?.[0];
  if (!ring || ring.length < 3) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const pt of ring) {
    const lng = Number(pt[0]);
    const lat = Number(pt[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    west = Math.min(west, lng);
    south = Math.min(south, lat);
    east = Math.max(east, lng);
    north = Math.max(north, lat);
  }
  if (
    !Number.isFinite(west) ||
    !Number.isFinite(south) ||
    !Number.isFinite(east) ||
    !Number.isFinite(north)
  ) {
    return null;
  }
  // Degenerate single-point rings — expand slightly so fitBounds still works.
  if (west === east) {
    west -= 0.002;
    east += 0.002;
  }
  if (south === north) {
    south -= 0.002;
    north += 0.002;
  }
  return [
    [west, south],
    [east, north],
  ];
}

function newBundleId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `bundle-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createEmptyBundle(): ServiceBundle {
  return {
    id: newBundleId(),
    title: '',
    description: '',
    service_ids: [],
    starting_price: 0,
  };
}

export function isStoreServiceUnit(value: unknown): value is StoreServiceUnit {
  return value === 'job' || value === 'hour' || value === 'sqm';
}

export function normalizeStoreServiceUnit(value: unknown): StoreServiceUnit {
  return isStoreServiceUnit(value) ? value : 'job';
}

/** Default display name for a sector service id (EN label key fallback = id). */
export function defaultSkuNameForServiceId(serviceId: string): string {
  const opt = findServiceOption(serviceId);
  if (!opt) return serviceId;
  // Persist a stable English-ish slug name; UI still translates via labelKey.
  return opt.id
    .split('_')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Build a SKU row when the contractor toggles a service chip on. */
export function createStoreServiceSku(
  serviceId: string,
  overrides?: Partial<Pick<StoreServiceSku, 'name' | 'base_price' | 'unit'>>
): StoreServiceSku {
  const id = String(serviceId ?? '').trim();
  return {
    id,
    name: (overrides?.name ?? defaultSkuNameForServiceId(id)).trim().slice(0, 80) || id,
    base_price:
      typeof overrides?.base_price === 'number' &&
      Number.isFinite(overrides.base_price) &&
      overrides.base_price >= 0
        ? Math.floor(overrides.base_price)
        : 0,
    unit: normalizeStoreServiceUnit(overrides?.unit),
  };
}

/**
 * Normalize JSONB / draft SKU arrays. Dedupes by service id (last wins).
 * Accepts legacy plain string ids and upgrades them to zero-price job SKUs.
 */
export function normalizeStoreServiceSkus(value: unknown): StoreServiceSku[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, StoreServiceSku>();

  for (const raw of value) {
    if (typeof raw === 'string') {
      const id = raw.trim();
      if (!id) continue;
      byId.set(id, createStoreServiceSku(id));
      if (byId.size >= STORE_SERVICE_SKUS_MAX) break;
      continue;
    }
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const id = String(row.id ?? '').trim();
    if (!id) continue;
    const price = Number(row.base_price);
    const nameRaw = String(row.name ?? '').trim();
    byId.set(id, {
      id,
      name: (nameRaw || defaultSkuNameForServiceId(id)).slice(0, 80),
      base_price:
        Number.isFinite(price) && price >= 0 ? Math.floor(price) : 0,
      unit: normalizeStoreServiceUnit(row.unit),
    });
    if (byId.size >= STORE_SERVICE_SKUS_MAX) break;
  }

  return Array.from(byId.values());
}

/** Merge priced SKUs with legacy offered_services ids (SKUs win on price/unit). */
export function resolveStoreServiceSkus(opts: {
  skus?: unknown;
  offeredServices?: unknown;
}): StoreServiceSku[] {
  const fromSkus = normalizeStoreServiceSkus(opts.skus);
  if (fromSkus.length > 0) return fromSkus;
  return normalizeStoreServiceSkus(opts.offeredServices);
}

export function skuIds(skus: StoreServiceSku[]): string[] {
  return skus.map((s) => s.id);
}

/**
 * Toggle a sector service on/off in the draft catalog.
 * Preserves base_price / unit when re-enabling is not needed (remove on off;
 * create default SKU on on).
 */
export function toggleStoreServiceInDraft(
  skus: StoreServiceSku[],
  serviceId: string
): StoreServiceSku[] {
  const id = String(serviceId ?? '').trim();
  if (!id) return skus;
  const exists = skus.some((s) => s.id === id);
  if (exists) return skus.filter((s) => s.id !== id);
  if (skus.length >= STORE_SERVICE_SKUS_MAX) return skus;
  return [...skus, createStoreServiceSku(id)];
}

/** Patch floor price / unit for an existing SKU (no-op if missing). */
export function updateStoreServiceSkuInDraft(
  skus: StoreServiceSku[],
  serviceId: string,
  patch: Partial<Pick<StoreServiceSku, 'base_price' | 'unit' | 'name'>>
): StoreServiceSku[] {
  const id = String(serviceId ?? '').trim();
  return skus.map((s) => {
    if (s.id !== id) return s;
    const next: StoreServiceSku = { ...s };
    if (patch.name != null) {
      next.name = String(patch.name).trim().slice(0, 80) || s.name;
    }
    if (patch.unit != null) {
      next.unit = normalizeStoreServiceUnit(patch.unit);
    }
    if (patch.base_price != null) {
      const price = Number(patch.base_price);
      next.base_price =
        Number.isFinite(price) && price >= 0 ? Math.floor(price) : 0;
    }
    return next;
  });
}

export function normalizeServiceBundles(value: unknown): ServiceBundle[] {
  if (!Array.isArray(value)) return [];
  const out: ServiceBundle[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const title = String(row.title ?? '').trim();
    if (!title) continue;
    const price = Number(row.starting_price);
    out.push({
      id: String(row.id ?? newBundleId()),
      title: title.slice(0, 80),
      description: String(row.description ?? '').trim().slice(0, 400),
      service_ids: normalizeStringList(row.service_ids, 8),
      starting_price:
        Number.isFinite(price) && price >= 0 ? Math.floor(price) : 0,
    });
    if (out.length >= STORE_BUNDLES_MAX) break;
  }
  return out;
}

function normalizeSupplyCategory(value: unknown): SupplyCategory {
  if (
    value === 'Eco-Chemical' ||
    value === 'Heavy Equipment' ||
    value === 'Hygiene Supply'
  ) {
    return value;
  }
  return 'Hygiene Supply';
}

export function rowToStoreSupply(row: Record<string, unknown>): StoreSupply {
  const extra =
    row.extra_price == null || row.extra_price === ''
      ? null
      : Number(row.extra_price);
  return {
    id: String(row.id),
    store_id: String(row.store_id),
    name: String(row.name ?? '').trim(),
    brand: (row.brand as string | null) ?? null,
    category: normalizeSupplyCategory(row.category),
    image_url: (row.image_url as string | null) ?? null,
    is_included_in_service: Boolean(row.is_included_in_service),
    extra_price: Number.isFinite(extra as number) ? (extra as number) : null,
    sort_order: Number.isFinite(Number(row.sort_order))
      ? Number(row.sort_order)
      : 0,
    created_at: row.created_at ? String(row.created_at) : undefined,
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export function rowToContractorStore(row: Record<string, unknown>): ContractorStore {
  const supported = normalizeRecurrenceList(row.supported_recurrence_types);
  const primary = normalizeRecurrenceType(row.recurrence_type);
  const store_service_skus = resolveStoreServiceSkus({
    skus: row.store_service_skus,
    offeredServices: row.offered_services,
  });
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
    offered_services: skuIds(store_service_skus),
    store_service_skus,
    materials_and_chemicals: normalizeStringList(
      row.materials_and_chemicals,
      STORE_MATERIALS_MAX
    ),
    store_photos: normalizeStringList(row.store_photos, STORE_PHOTOS_MAX),
    store_name: (row.store_name as string | null) ?? null,
    store_bio: (row.store_bio as string | null) ?? null,
    is_published: Boolean(row.is_published),
    color: normalizeStoreColor(row.color),
    service_bundles: normalizeServiceBundles(row.service_bundles),
    recurrence_type: supported.includes(primary) ? primary : supported[0],
    supported_recurrence_types: supported,
    created_at: row.created_at ? String(row.created_at) : undefined,
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export function storeToDraft(store: ContractorStore | null): ContractorStoreDraft {
  if (!store) {
    return { ...EMPTY_STORE_DRAFT, service_bundles: [], store_service_skus: [] };
  }
  const skus = store.store_service_skus.map((s) => ({ ...s }));
  return {
    office_lat: store.office_lat,
    office_lng: store.office_lng,
    office_address: store.office_address ?? '',
    service_radius_polygon: store.service_radius_polygon,
    offered_services: skuIds(skus),
    store_service_skus: skus,
    materials_and_chemicals: [...store.materials_and_chemicals],
    store_photos: [...store.store_photos],
    store_name: store.store_name ?? '',
    store_bio: store.store_bio ?? '',
    is_published: store.is_published,
    color: normalizeStoreColor(store.color),
    service_bundles: store.service_bundles.map((b) => ({ ...b })),
    recurrence_type: store.recurrence_type,
    supported_recurrence_types: [...store.supported_recurrence_types],
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

/** All published storefronts with a valid office pin (map Store mode). */
export async function fetchPublishedContractorStores(): Promise<ContractorStore[]> {
  const { data, error } = await supabase
    .from('contractor_stores')
    .select('*')
    .eq('is_published', true)
    .not('office_lat', 'is', null)
    .not('office_lng', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(500);

  if (error) throw error;
  return (data || [])
    .map((row) => rowToContractorStore(row as Record<string, unknown>))
    .filter(
      (s) =>
        typeof s.office_lat === 'number' &&
        typeof s.office_lng === 'number' &&
        Number.isFinite(s.office_lat) &&
        Number.isFinite(s.office_lng)
    );
}

export async function upsertContractorStore(
  ownerId: string,
  draft: ContractorStoreDraft
): Promise<ContractorStore> {
  const supported = normalizeRecurrenceList(draft.supported_recurrence_types);
  const primary = supported.includes(draft.recurrence_type)
    ? draft.recurrence_type
    : supported.find((r) => r !== 'one_time') ?? supported[0];

  // SKUs are authoritative; fall back to legacy offered_services chips if empty.
  const store_service_skus = resolveStoreServiceSkus({
    skus: draft.store_service_skus,
    offeredServices: draft.offered_services,
  });
  const offered_services = skuIds(store_service_skus);

  const payload = {
    owner_id: ownerId,
    office_lat: draft.office_lat,
    office_lng: draft.office_lng,
    office_address: draft.office_address.trim() || null,
    service_radius_polygon: draft.service_radius_polygon,
    offered_services,
    store_service_skus,
    materials_and_chemicals: normalizeStringList(
      draft.materials_and_chemicals,
      STORE_MATERIALS_MAX
    ),
    store_photos: normalizeStringList(draft.store_photos, STORE_PHOTOS_MAX),
    store_name: draft.store_name.trim() || null,
    store_bio: draft.store_bio.trim() || null,
    is_published: Boolean(draft.is_published),
    color: normalizeStoreColor(draft.color),
    service_bundles: normalizeServiceBundles(draft.service_bundles),
    recurrence_type: primary,
    supported_recurrence_types: supported,
  };

  const { data, error } = await supabase
    .from('contractor_stores')
    .upsert(payload, { onConflict: 'owner_id' })
    .select('*')
    .single();

  if (error) throw error;
  return rowToContractorStore(data as Record<string, unknown>);
}

/** Permanently remove the contractor storefront (cascades store_supplies via FK). */
export async function deleteContractorStore(ownerId: string): Promise<void> {
  const { error } = await supabase
    .from('contractor_stores')
    .delete()
    .eq('owner_id', ownerId);
  if (error) throw error;
}

export async function fetchStoreSupplies(storeId: string): Promise<StoreSupply[]> {
  const { data, error } = await supabase
    .from('store_supplies')
    .select('*')
    .eq('store_id', storeId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(STORE_SUPPLIES_MAX);

  if (error) throw error;
  return (data || []).map((row) => rowToStoreSupply(row as Record<string, unknown>));
}

export async function insertStoreSupply(
  storeId: string,
  draft: StoreSupplyDraft,
  sortOrder = 0
): Promise<StoreSupply> {
  const extra =
    draft.extra_price === '' || draft.extra_price == null
      ? null
      : Number(draft.extra_price);
  const payload = {
    store_id: storeId,
    name: draft.name.trim().slice(0, 120),
    brand: draft.brand.trim().slice(0, 80) || null,
    category: draft.category,
    image_url: draft.image_url,
    is_included_in_service: Boolean(draft.is_included_in_service),
    extra_price:
      draft.is_included_in_service || !Number.isFinite(extra as number)
        ? null
        : (extra as number),
    sort_order: sortOrder,
  };
  const { data, error } = await supabase
    .from('store_supplies')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return rowToStoreSupply(data as Record<string, unknown>);
}

export async function updateStoreSupply(
  id: string,
  patch: Partial<StoreSupplyDraft> & { sort_order?: number }
): Promise<StoreSupply> {
  const payload: Record<string, unknown> = {};
  if (patch.name != null) payload.name = patch.name.trim().slice(0, 120);
  if (patch.brand != null) payload.brand = patch.brand.trim().slice(0, 80) || null;
  if (patch.category != null) payload.category = patch.category;
  if (patch.image_url !== undefined) payload.image_url = patch.image_url;
  if (patch.is_included_in_service != null) {
    payload.is_included_in_service = Boolean(patch.is_included_in_service);
  }
  if (patch.extra_price !== undefined) {
    const extra =
      patch.extra_price === '' || patch.extra_price == null
        ? null
        : Number(patch.extra_price);
    payload.extra_price = Number.isFinite(extra as number) ? extra : null;
  }
  if (patch.sort_order != null) payload.sort_order = patch.sort_order;

  const { data, error } = await supabase
    .from('store_supplies')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return rowToStoreSupply(data as Record<string, unknown>);
}

export async function deleteStoreSupply(id: string): Promise<void> {
  const { error } = await supabase.from('store_supplies').delete().eq('id', id);
  if (error) throw error;
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

/** Upload a supply product image under order-photos/stores/{userId}/supplies/… */
export async function uploadSupplyPhoto(
  userId: string,
  file: File
): Promise<string> {
  const path = `stores/${userId}/supplies/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
  const { error } = await supabase.storage
    .from('order-photos')
    .upload(path, file, { upsert: false, contentType: 'image/jpeg' });
  if (error) throw error;
  const {
    data: { publicUrl },
  } = supabase.storage.from('order-photos').getPublicUrl(path);
  return publicUrl;
}
