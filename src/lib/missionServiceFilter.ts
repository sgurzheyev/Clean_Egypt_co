/**
 * Exact service_type filter. Empty selection is All.
 * Shared by map pins, clusters (they are built from the filtered pins),
 * the service marketplace list, and store pins that offer one of the types.
 * Persists in localStorage and the `services` URL query.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ALL_SECTOR_SERVICES, type ServiceType } from './serviceSectors';

export const MISSION_SERVICE_FILTER_KEY = 'ce_mission_service_types';
export const MISSION_SERVICE_FILTER_PARAM = 'services';
export const MISSION_SERVICE_FILTER_EVENT = 'ce:mission-service-filter';

const ALLOWED = new Set<string>(ALL_SECTOR_SERVICES.map((service) => service.id));

export function parseServiceTypeSelection(raw: string | null | undefined): ServiceType[] {
  if (!raw) return [];
  const out: ServiceType[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (!ALLOWED.has(id) || out.includes(id as ServiceType)) continue;
    out.push(id as ServiceType);
  }
  return out;
}

export function serializeServiceTypeSelection(ids: readonly string[]): string {
  return parseServiceTypeSelection(ids.join(',')).join(',');
}

export function readMissionServiceFilter(): ServiceType[] {
  if (typeof window === 'undefined') return [];
  try {
    const fromUrl = new URLSearchParams(window.location.search).get(MISSION_SERVICE_FILTER_PARAM);
    if (fromUrl !== null) return parseServiceTypeSelection(fromUrl);
    return parseServiceTypeSelection(window.localStorage.getItem(MISSION_SERVICE_FILTER_KEY));
  } catch {
    return [];
  }
}

export function writeMissionServiceFilter(ids: readonly string[]): void {
  if (typeof window === 'undefined') return;
  const next = parseServiceTypeSelection(ids.join(','));
  const serial = next.join(',');
  try {
    if (serial) window.localStorage.setItem(MISSION_SERVICE_FILTER_KEY, serial);
    else window.localStorage.removeItem(MISSION_SERVICE_FILTER_KEY);
  } catch {
    /* private mode */
  }
  try {
    const url = new URL(window.location.href);
    if (serial) url.searchParams.set(MISSION_SERVICE_FILTER_PARAM, serial);
    else url.searchParams.delete(MISSION_SERVICE_FILTER_PARAM);
    window.history.replaceState(window.history.state, '', url);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(MISSION_SERVICE_FILTER_EVENT, { detail: next }));
  } catch {
    /* ignore */
  }
}

export function subscribeMissionServiceFilter(listener: (ids: ServiceType[]) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onCustom = (event: Event) => {
    const detail = (event as CustomEvent<ServiceType[]>).detail;
    if (Array.isArray(detail)) listener(parseServiceTypeSelection(detail.join(',')));
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== MISSION_SERVICE_FILTER_KEY) return;
    listener(parseServiceTypeSelection(event.newValue));
  };
  const onPop = () => listener(readMissionServiceFilter());
  window.addEventListener(MISSION_SERVICE_FILTER_EVENT, onCustom);
  window.addEventListener('storage', onStorage);
  window.addEventListener('popstate', onPop);
  return () => {
    window.removeEventListener(MISSION_SERVICE_FILTER_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('popstate', onPop);
  };
}

export function filterMissionsByServiceTypes<T extends { service_type?: string | null }>(
  missions: T[],
  selected: readonly string[]
): T[] {
  if (!Array.isArray(missions)) return [];
  const wanted = parseServiceTypeSelection(selected.join(','));
  if (wanted.length === 0) return missions;
  const set = new Set<string>(wanted);
  return missions.filter((mission) => set.has(String(mission.service_type || '')));
}

export function useMissionServiceFilter(): {
  selectedServiceTypes: ServiceType[];
  toggleServiceType: (id: string) => void;
  clearServiceTypes: () => void;
} {
  const [selectedServiceTypes, setSelectedServiceTypes] = useState<ServiceType[]>(() =>
    readMissionServiceFilter()
  );
  const selectedRef = useRef(selectedServiceTypes);
  selectedRef.current = selectedServiceTypes;

  useEffect(() => subscribeMissionServiceFilter(setSelectedServiceTypes), []);

  const toggleServiceType = useCallback((id: string) => {
    const prev = selectedRef.current;
    const next = prev.includes(id as ServiceType)
      ? prev.filter((item) => item !== id)
      : [...prev, id as ServiceType];
    writeMissionServiceFilter(next);
  }, []);

  const clearServiceTypes = useCallback(() => {
    writeMissionServiceFilter([]);
  }, []);

  return { selectedServiceTypes, toggleServiceType, clearServiceTypes };
}
