/**
 * Bridge: public storefront → map mission draft.
 * StorefrontPage lives on a separate route (MapPicker unmounted), so we
 * queue the request in sessionStorage and/or fire APP_EVENT_CREATE_MISSION
 * with the same detail payload.
 */
import { APP_EVENT_CREATE_MISSION } from './brand';
import {
  findServiceOption,
  missionSector,
  type FormTrigger,
  type ServiceType,
} from './serviceSectors';
import type { StoreServiceSku } from './contractorStore';

const STORAGE_KEY = 'garbagin:pending-store-mission';

export type StoreMissionRequestDetail = {
  serviceType: string;
  expectedPrice: number;
  storeOwnerId?: string;
  storeName?: string | null;
};

export function formTriggerForServiceId(serviceId: string): FormTrigger {
  return missionSector(serviceId) === 'home' ? 'sponge' : 'mop';
}

export function isKnownServiceType(id: string): id is ServiceType {
  return Boolean(findServiceOption(id));
}

/** Prefer a priced SKU; otherwise first catalog entry. */
export function pickDefaultStoreSku(
  skus: StoreServiceSku[]
): StoreServiceSku | null {
  if (!skus.length) return null;
  const priced = skus.find((s) => s.base_price > 0);
  return priced ?? skus[0];
}

export function queueStoreMissionRequest(
  detail: StoreMissionRequestDetail
): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(detail));
  } catch {
    /* private mode / quota */
  }
}

export function consumeStoreMissionRequest(): StoreMissionRequestDetail | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    const parsed = JSON.parse(raw) as StoreMissionRequestDetail;
    if (!parsed?.serviceType) return null;
    const price = Number(parsed.expectedPrice);
    return {
      serviceType: String(parsed.serviceType),
      expectedPrice: Number.isFinite(price) && price > 0 ? Math.floor(price) : 0,
      storeOwnerId: parsed.storeOwnerId
        ? String(parsed.storeOwnerId)
        : undefined,
      storeName: parsed.storeName ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * From an overlay that still has MapPicker mounted: queue + dispatch.
 * From StorefrontPage: queue + navigate('/'); MapPicker consumes on mount.
 */
export function dispatchStoreMissionRequest(
  detail: StoreMissionRequestDetail
): void {
  queueStoreMissionRequest(detail);
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(APP_EVENT_CREATE_MISSION, { detail })
  );
}
