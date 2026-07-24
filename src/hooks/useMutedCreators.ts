/**
 * React state wrapper around local-first muted creator IDs.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  clearMuted as clearMutedStorage,
  isMuted as isMutedStorage,
  muteCreator as muteCreatorStorage,
  readMutedCreators,
  subscribeMutedCreators,
  unmuteCreator as unmuteCreatorStorage,
} from '../lib/mutedCreators';

export function useMutedCreators() {
  const [mutedIds, setMutedIds] = useState<string[]>(() => readMutedCreators());

  useEffect(() => subscribeMutedCreators(setMutedIds), []);

  const muteCreator = useCallback((creatorId: string | null | undefined) => {
    const next = muteCreatorStorage(creatorId);
    setMutedIds(next);
    return next;
  }, []);

  const unmuteCreator = useCallback((creatorId: string | null | undefined) => {
    const next = unmuteCreatorStorage(creatorId);
    setMutedIds(next);
    return next;
  }, []);

  const clearMuted = useCallback(() => {
    const next = clearMutedStorage();
    setMutedIds(next);
    return next;
  }, []);

  const isMuted = useCallback(
    (creatorId: string | null | undefined) => isMutedStorage(creatorId, mutedIds),
    [mutedIds]
  );

  return {
    mutedIds,
    mutedCount: mutedIds.length,
    muteCreator,
    unmuteCreator,
    clearMuted,
    isMuted,
  };
}
