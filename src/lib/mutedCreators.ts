/**
 * Local-first mute list for creator spam protection.
 * Key: garbini_muted_creators — zero-latency, no backend.
 */
export const MUTED_CREATORS_STORAGE_KEY = 'garbini_muted_creators';
export const MUTED_CREATORS_EVENT = 'ce:muted-creators';

function normalizeId(id: string | null | undefined): string | null {
  const s = String(id || '').trim();
  return s.length > 0 ? s : null;
}

export function readMutedCreators(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(MUTED_CREATORS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      const id = normalizeId(typeof item === 'string' ? item : null);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  } catch {
    return [];
  }
}

function writeMutedCreators(ids: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MUTED_CREATORS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* private mode / quota */
  }
  try {
    window.dispatchEvent(new CustomEvent(MUTED_CREATORS_EVENT, { detail: ids }));
  } catch {
    /* ignore */
  }
}

export function isMuted(creatorId: string | null | undefined, mutedIds?: string[]): boolean {
  const id = normalizeId(creatorId);
  if (!id) return false;
  const list = mutedIds ?? readMutedCreators();
  return list.includes(id);
}

export function muteCreator(creatorId: string | null | undefined): string[] {
  const id = normalizeId(creatorId);
  if (!id) return readMutedCreators();
  const prev = readMutedCreators();
  if (prev.includes(id)) return prev;
  const next = [...prev, id];
  writeMutedCreators(next);
  return next;
}

export function unmuteCreator(creatorId: string | null | undefined): string[] {
  const id = normalizeId(creatorId);
  if (!id) return readMutedCreators();
  const next = readMutedCreators().filter((x) => x !== id);
  writeMutedCreators(next);
  return next;
}

export function clearMuted(): string[] {
  writeMutedCreators([]);
  return [];
}

/** Drop missions whose creator is in the mute list. */
export function filterMissionsByMutedCreators<
  T extends { creator_id?: string | null },
>(missions: T[], mutedIds: string[]): T[] {
  if (!mutedIds || mutedIds.length === 0) return missions;
  const muted = new Set(mutedIds);
  return missions.filter((m) => {
    const id = normalizeId(m.creator_id);
    if (!id) return true;
    return !muted.has(id);
  });
}

export function subscribeMutedCreators(listener: (ids: string[]) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onCustom = (e: Event) => {
    const detail = (e as CustomEvent<string[]>).detail;
    if (Array.isArray(detail)) listener(detail);
    else listener(readMutedCreators());
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== MUTED_CREATORS_STORAGE_KEY) return;
    listener(readMutedCreators());
  };
  window.addEventListener(MUTED_CREATORS_EVENT, onCustom);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(MUTED_CREATORS_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
  };
}
