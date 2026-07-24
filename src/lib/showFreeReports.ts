/**
 * Session preference: show free civic "Attention Zone" report pins.
 * Default ON so new users still see reports; active users can mute them.
 */
import { isGarbageZoneReport } from './garbageZoneReport';

export const SHOW_FREE_REPORTS_STORAGE_KEY = 'ce_show_free_reports';
export const SHOW_FREE_REPORTS_EVENT = 'ce:show-free-reports';

export function readShowFreeReports(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(SHOW_FREE_REPORTS_STORAGE_KEY);
    if (raw === null) return true;
    return raw !== '0' && raw !== 'false';
  } catch {
    return true;
  }
}

export function writeShowFreeReports(show: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SHOW_FREE_REPORTS_STORAGE_KEY, show ? '1' : '0');
  } catch {
    /* private mode / quota */
  }
  try {
    window.dispatchEvent(new CustomEvent(SHOW_FREE_REPORTS_EVENT, { detail: show }));
  } catch {
    /* ignore */
  }
}

/** Subscribe to cross-component preference updates (map ↔ market ↔ profile). */
export function subscribeShowFreeReports(listener: (show: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onCustom = (e: Event) => {
    const detail = (e as CustomEvent<boolean>).detail;
    if (typeof detail === 'boolean') listener(detail);
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== SHOW_FREE_REPORTS_STORAGE_KEY) return;
    listener(e.newValue !== '0' && e.newValue !== 'false');
  };
  window.addEventListener(SHOW_FREE_REPORTS_EVENT, onCustom);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(SHOW_FREE_REPORTS_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
  };
}

/** When `show` is false, drop free report / attention-zone pins. */
export function filterMissionsByFreeReports<
  T extends { is_report?: boolean | null; status?: string | null; category?: string | null },
>(missions: T[], show: boolean): T[] {
  if (show) return missions;
  return missions.filter((m) => {
    if (isGarbageZoneReport(m)) return false;
    if (String(m.category || '').toLowerCase() === 'report') return false;
    return true;
  });
}
