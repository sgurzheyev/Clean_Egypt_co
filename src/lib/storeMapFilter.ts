/**
 * Store-mode map chips — filter published contractor_stores before pins / coverage.
 */
import type { ContractorStore } from './contractorStore';

export type StoreMapFilterId =
  | 'all'
  | 'junk_removal'
  | 'subscribe'
  | 'eco_supplies'
  | 'deep_clean';

export type StoreMapFilterOption = {
  id: StoreMapFilterId;
  labelKey: string;
  defaultLabel: string;
};

export const STORE_MAP_FILTERS: StoreMapFilterOption[] = [
  { id: 'all', labelKey: 'storeFilterAll', defaultLabel: 'All' },
  {
    id: 'junk_removal',
    labelKey: 'storeFilterJunkRemoval',
    defaultLabel: 'Junk Removal',
  },
  {
    id: 'subscribe',
    labelKey: 'storeFilterSubscribe',
    defaultLabel: 'Subscribe & Save',
  },
  {
    id: 'eco_supplies',
    labelKey: 'storeFilterEcoSupplies',
    defaultLabel: 'Eco Supplies',
  },
  {
    id: 'deep_clean',
    labelKey: 'storeFilterDeepClean',
    defaultLabel: 'Deep Clean',
  },
];

const ECO_RE =
  /\b(eco|biodegrad|plant[- ]?based|green\s*clean|organic|non[- ]?toxic)|эко|биоразлаг/i;

const SUBSCRIBE_RE = /subscri|recurr|подписк|регуляр|save\s*&\s*subscri/i;

const DEEP_CLEAN_RE =
  /deep\s*clean|генеральн|general\s*clean|home\s*\/?\s*office|глубокая\s*убор/i;

const DEEP_CLEAN_SERVICES = new Set([
  'home_office',
  'carpets_mattresses',
  'kitchen_hoods_grease',
  'laundry_ironing',
]);

function storeServiceIds(store: ContractorStore): Set<string> {
  const ids = new Set<string>();
  for (const sku of store.store_service_skus || []) {
    if (sku?.id) ids.add(String(sku.id));
  }
  for (const id of store.offered_services) {
    if (id) ids.add(String(id));
  }
  for (const bundle of store.service_bundles) {
    for (const sid of bundle.service_ids || []) {
      if (sid) ids.add(String(sid));
    }
  }
  return ids;
}

function bundleText(store: ContractorStore): string {
  return store.service_bundles
    .map((b) => `${b.title || ''} ${b.description || ''}`)
    .join(' ');
}

export function storeOffersSubscription(store: ContractorStore): boolean {
  if (store.supported_recurrence_types.some((r) => r !== 'one_time')) return true;
  if (store.recurrence_type !== 'one_time') return true;
  return SUBSCRIBE_RE.test(bundleText(store));
}

export function storeHasEcoSupplies(
  store: ContractorStore,
  ecoStoreIds?: ReadonlySet<string> | null
): boolean {
  if (ecoStoreIds?.has(String(store.id))) return true;
  if (store.materials_and_chemicals.some((m) => ECO_RE.test(m))) return true;
  if (ECO_RE.test(store.store_bio || '')) return true;
  if (ECO_RE.test(store.store_name || '')) return true;
  return false;
}

export function storeMatchesMapFilter(
  store: ContractorStore,
  filter: StoreMapFilterId,
  opts?: { ecoStoreIds?: ReadonlySet<string> | null }
): boolean {
  if (filter === 'all') return true;

  const services = storeServiceIds(store);

  if (filter === 'junk_removal') {
    return services.has('junk_removal') || /junk|хлам|вывоз/i.test(bundleText(store));
  }

  if (filter === 'subscribe') {
    return storeOffersSubscription(store);
  }

  if (filter === 'eco_supplies') {
    return storeHasEcoSupplies(store, opts?.ecoStoreIds);
  }

  if (filter === 'deep_clean') {
    for (const id of DEEP_CLEAN_SERVICES) {
      if (services.has(id)) return true;
    }
    return DEEP_CLEAN_RE.test(bundleText(store));
  }

  return true;
}

export function filterStoresForMap(
  stores: ContractorStore[],
  filter: StoreMapFilterId,
  opts?: { ecoStoreIds?: ReadonlySet<string> | null }
): ContractorStore[] {
  if (filter === 'all') return stores;
  return stores.filter((s) => storeMatchesMapFilter(s, filter, opts));
}

/** True when a supply row counts as eco-friendly inventory. */
export function supplyLooksEco(row: {
  category?: string | null;
  name?: string | null;
  brand?: string | null;
}): boolean {
  if (row.category === 'Eco-Chemical') return true;
  return ECO_RE.test(String(row.name || '')) || ECO_RE.test(String(row.brand || ''));
}
