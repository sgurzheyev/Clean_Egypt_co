/**
 * Live-map preview from overlay lists (My Orders, Service Marketplace, History).
 * Dispatches a window event so Profile (sibling of MapPicker) can drive the camera
 * without closing the glass overlay.
 */
import { APP_EVENT_PREVIEW_MISSION_LOCATION } from './brand';

export type PreviewMissionLocationDetail = {
  lat: number;
  lng: number;
  missionId?: string;
};

export function isPreviewableCoord(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function dispatchPreviewMissionLocation(
  lat: unknown,
  lng: unknown,
  missionId?: string
): void {
  if (!isPreviewableCoord(lat, lng)) return;
  window.dispatchEvent(
    new CustomEvent<PreviewMissionLocationDetail>(APP_EVENT_PREVIEW_MISSION_LOCATION, {
      detail: { lat: lat as number, lng: lng as number, missionId },
    })
  );
}

export function subscribePreviewMissionLocation(
  handler: (detail: PreviewMissionLocationDetail) => void
): () => void {
  const onEvent = (event: Event) => {
    const detail = (event as CustomEvent<PreviewMissionLocationDetail>).detail;
    if (!detail || !isPreviewableCoord(detail.lat, detail.lng)) return;
    handler(detail);
  };
  window.addEventListener(APP_EVENT_PREVIEW_MISSION_LOCATION, onEvent);
  return () => window.removeEventListener(APP_EVENT_PREVIEW_MISSION_LOCATION, onEvent);
}

/**
 * While `root` scrolls, preview the card whose center is closest to the
 * upper-third focus band (the card the user is actually reading).
 */
export function attachListScrollMapPreview(root: HTMLElement): () => void {
  let timer = 0;
  const pick = () => {
    const cards = root.querySelectorAll<HTMLElement>('[data-map-preview-lat]');
    if (cards.length === 0) return;
    const rootRect = root.getBoundingClientRect();
    if (rootRect.height < 8) return;
    const focusY = rootRect.top + rootRect.height * 0.34;
    let best: { dist: number; lat: number; lng: number; id?: string } | null = null;
    cards.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.bottom < rootRect.top + 8 || rect.top > rootRect.bottom - 8) return;
      const lat = Number.parseFloat(el.dataset.mapPreviewLat || '');
      const lng = Number.parseFloat(el.dataset.mapPreviewLng || '');
      if (!isPreviewableCoord(lat, lng)) return;
      const mid = (rect.top + rect.bottom) / 2;
      const dist = Math.abs(mid - focusY);
      if (!best || dist < best.dist) {
        best = {
          dist,
          lat,
          lng,
          id: el.dataset.mapPreviewId || undefined,
        };
      }
    });
    if (best) dispatchPreviewMissionLocation(best.lat, best.lng, best.id);
  };
  const onScroll = () => {
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      pick();
    }, 140);
  };
  root.addEventListener('scroll', onScroll, { passive: true });
  pick();
  return () => {
    root.removeEventListener('scroll', onScroll);
    if (timer) window.clearTimeout(timer);
  };
}
