import { useEffect, type RefObject } from 'react';
import { attachListScrollMapPreview } from '../lib/listMapPreview';

/** Bind scroll → map preview on a list scroller while `enabled`. */
export function useListScrollMapPreview(
  enabled: boolean,
  rootRef: RefObject<HTMLElement | null>,
  /** Bump when the scroller node is assigned late (e.g. Virtuoso). */
  scrollerEpoch = 0
): void {
  useEffect(() => {
    if (!enabled) return;
    const root = rootRef.current;
    if (!root) return;
    return attachListScrollMapPreview(root);
  }, [enabled, rootRef, scrollerEpoch]);
}
