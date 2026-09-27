/**
 * Trusted Web Activity detection for the Bubblewrap app
 * package `com.garbagin.app` (www.garbagin.com).
 *
 * Chrome sets `document.referrer` to `android-app://com.garbagin.app` on the
 * first document load (also accepted with a trailing `/`, `?`, or `#`).
 * Later navigations inside the TWA often drop it, so the
 * first positive signal is stored in both sessionStorage and localStorage.
 * `?twa=1` is the Bubblewrap startUrl fallback (`startUrl`: `/?twa=1`).
 * A query param cannot turn TWA mode off.
 */
export const TWA_PACKAGE = 'com.garbagin.app';
export const TWA_REFERRER_PREFIX = `android-app://${TWA_PACKAGE}`;
export const TWA_STORAGE_KEY = 'ce_twa';

export function twaSignalFrom(input: {
  referrer?: string | null;
  search?: string | null;
  stored?: boolean;
}): { active: boolean; shouldPersist: boolean } {
  const referrer = String(input.referrer || '');
  const raw = String(input.search || '');
  const query = raw.startsWith('?') ? raw.slice(1) : raw.replace(/^\?/, '');
  const fromParam = new URLSearchParams(query).get('twa') === '1';
  const fromReferrer = referrerMatchesPackage(referrer);
  if (fromParam || fromReferrer) return { active: true, shouldPersist: true };
  if (input.stored) return { active: true, shouldPersist: false };
  return { active: false, shouldPersist: false };
}

/** Exact package, or the same package plus `/`, `?`, or `#`. A longer package name does not match. */
export function referrerMatchesPackage(referrer: string): boolean {
  if (referrer === TWA_REFERRER_PREFIX) return true;
  if (!referrer.startsWith(TWA_REFERRER_PREFIX)) return false;
  const next = referrer.charAt(TWA_REFERRER_PREFIX.length);
  return next === '/' || next === '?' || next === '#';
}

let latched: boolean | null = null;

function readStored(): boolean {
  try {
    return (
      window.sessionStorage.getItem(TWA_STORAGE_KEY) === '1' ||
      window.localStorage.getItem(TWA_STORAGE_KEY) === '1'
    );
  } catch {
    return false;
  }
}

function persistTwa(): void {
  try {
    window.sessionStorage.setItem(TWA_STORAGE_KEY, '1');
    window.localStorage.setItem(TWA_STORAGE_KEY, '1');
  } catch {
    /* private mode */
  }
}

/** Read referrer / ?twa=1 / stored flag once per page load. */
export function captureTwaContext(): boolean {
  if (typeof window === 'undefined') {
    latched = false;
    return false;
  }
  const signal = twaSignalFrom({
    referrer: document.referrer,
    search: window.location.search,
    stored: readStored(),
  });
  if (signal.shouldPersist) persistTwa();
  latched = signal.active;
  return signal.active;
}

export function isTwaContext(): boolean {
  if (latched == null) return captureTwaContext();
  return latched;
}

/** Test-only. Production latch is set on first read. */
export function resetTwaLatchForTests(): void {
  latched = null;
}
