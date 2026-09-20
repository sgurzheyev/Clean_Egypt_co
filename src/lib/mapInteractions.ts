/**
 * Mapbox gesture restore — overlays (MissionBriefing, Store filter scrim)
 * often steal the matching pointerup/touchend, leaving scrollZoom / dragPan /
 * touchZoomRotate stuck `_active` until a full reload.
 *
 * Regression: after close of the mission pin card OR Store mode on/off,
 * zoom +/- (and often pan/pinch) must work without restarting the app.
 * Call restoreMapInteractions on overlay unmount and Store toggle; bounce
 * enable() so HandlerManager drops a half-finished gesture.
 */

export const MAP_GESTURE_HANDLER_NAMES = [
  'scrollZoom',
  'boxZoom',
  'dragPan',
  'dragRotate',
  'keyboard',
  'doubleClickZoom',
  'touchZoomRotate',
  'touchPitch',
] as const;

export type MapGestureHandlerName = (typeof MAP_GESTURE_HANDLER_NAMES)[number];

type MapGestureHandler = {
  enable?: () => void;
  disable?: () => void;
  isEnabled?: () => boolean;
  reset?: () => void;
};

export type MapGestureMap = {
  stop?: () => void;
  resize?: () => void;
  getCanvas?: () => HTMLCanvasElement | undefined;
  getCanvasContainer?: () => HTMLElement | undefined;
} & Partial<Record<MapGestureHandlerName, MapGestureHandler | undefined>>;

function bounceHandler(handler: MapGestureHandler | undefined) {
  if (!handler) return;
  try {
    handler.reset?.();
  } catch {
    /* ignore */
  }
  try {
    const enabled =
      typeof handler.isEnabled === 'function' ? handler.isEnabled() : true;
    if (enabled) {
      handler.disable?.();
    }
    handler.enable?.();
  } catch {
    /* map disposing */
  }
}

/** Abort a half-finished pan/pinch and turn every camera handler back on. */
export function restoreMapInteractions(
  map: MapGestureMap | null | undefined
): void {
  if (!map) return;
  try {
    map.stop?.();
  } catch {
    /* ignore */
  }
  for (const name of MAP_GESTURE_HANDLER_NAMES) {
    bounceHandler(map[name]);
  }

  const canvas = map.getCanvas?.();
  if (canvas) {
    try {
      canvas.style.cursor = '';
      canvas.style.removeProperty('pointer-events');
      canvas.style.touchAction = 'none';
    } catch {
      /* ignore */
    }
  }

  try {
    map.resize?.();
  } catch {
    /* ignore */
  }
}

/** Disable camera handlers while a full-screen map overlay owns pointer events. */
export function suspendMapInteractions(
  map: MapGestureMap | null | undefined
): void {
  if (!map) return;
  try {
    map.stop?.();
  } catch {
    /* ignore */
  }
  for (const name of MAP_GESTURE_HANDLER_NAMES) {
    try {
      map[name]?.disable?.();
    } catch {
      /* ignore */
    }
  }
}

/** Drop a carousel/sheet pointer capture so unmount cannot swallow later clicks. */
export function releaseCapturedPointer(
  el: HTMLElement | null | undefined,
  pointerId: number | null | undefined
): void {
  if (!el || pointerId == null) return;
  try {
    if (el.hasPointerCapture?.(pointerId)) {
      el.releasePointerCapture(pointerId);
    }
  } catch {
    /* already released or node detached */
  }
}
