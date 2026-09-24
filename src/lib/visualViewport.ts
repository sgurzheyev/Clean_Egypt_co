/**
 * Lock the app shell to the *visible* viewport.
 *
 * On the first paint iOS Safari / Telegram WebView often report `100dvh` as the
 * large layout viewport (under the notch and below the home indicator). Bottom
 * sheets then pin their CTAs off-screen. After a dismiss + reopen, a resize has
 * landed and the same sheet fits. Binding `--vv-height` / `--vv-offset-top` to
 * `visualViewport` (and Telegram's stable height) keeps the first open tappable.
 */

type TelegramWebApp = {
  ready?: () => void;
  expand?: () => void;
  viewportStableHeight?: number;
  onEvent?: (event: string, cb: () => void) => void;
  offEvent?: (event: string, cb: () => void) => void;
};

function telegramWebApp(): TelegramWebApp | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
}

export function syncVisualViewport(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const tg = telegramWebApp();
  try {
    tg?.ready?.();
    tg?.expand?.();
  } catch {
    /* Telegram script missing or already torn down */
  }

  const vv = window.visualViewport;
  let height = vv?.height ?? window.innerHeight;
  let offsetTop = vv?.offsetTop ?? 0;
  const stable = tg?.viewportStableHeight;
  if (typeof stable === 'number' && Number.isFinite(stable) && stable > 0) {
    height = Math.min(height, stable);
  }
  if (!Number.isFinite(height) || height < 1) height = window.innerHeight || 1;
  if (!Number.isFinite(offsetTop) || offsetTop < 0) offsetTop = 0;

  const root = document.documentElement;
  root.style.setProperty('--vv-height', `${Math.round(height)}px`);
  root.style.setProperty('--vv-offset-top', `${Math.round(offsetTop)}px`);
}

let subscribed = false;
let cachedSafeTop: number | null = null;

/** Idempotent. Call once at startup. */
export function installVisualViewportSync(): void {
  if (subscribed || typeof window === 'undefined') return;
  subscribed = true;
  syncVisualViewport();
  window.visualViewport?.addEventListener('resize', syncVisualViewport);
  window.visualViewport?.addEventListener('scroll', syncVisualViewport);
  window.addEventListener('resize', syncVisualViewport);
  window.addEventListener('orientationchange', () => {
    cachedSafeTop = null;
    syncVisualViewport();
  });
  const tg = telegramWebApp();
  try {
    tg?.onEvent?.('viewportChanged', syncVisualViewport);
  } catch {
    /* ignore */
  }
}

export type ViewportRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Anchor is the bottom-center of a tooltip drawn with
 * `translate(-50%, calc(-100% - gap))`. Clamp so the box stays inside the
 * visual viewport and below the notch (`safeTop`).
 */
export function clampTooltipAnchor(
  anchor: { x: number; y: number },
  viewport: ViewportRect,
  box: { width: number; height: number },
  safeTop = 0,
  gap = 12
): { x: number; y: number } {
  const width = Math.max(1, box.width);
  const height = Math.max(1, box.height);
  const minX = viewport.left + width / 2 + 8;
  const maxX = viewport.left + viewport.width - width / 2 - 8;
  const minY = viewport.top + Math.max(0, safeTop) + height + gap;
  const maxY = viewport.top + viewport.height - 8;
  const x = maxX >= minX ? Math.min(maxX, Math.max(minX, anchor.x)) : viewport.left + viewport.width / 2;
  const y = maxY >= minY ? Math.min(maxY, Math.max(minY, anchor.y)) : minY;
  return { x, y };
}

export function readSafeAreaTopPx(): number {
  if (cachedSafeTop != null) return cachedSafeTop;
  if (typeof document === 'undefined') return 0;
  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.visibility = 'hidden';
  probe.style.paddingTop = 'env(safe-area-inset-top, 0px)';
  document.body.appendChild(probe);
  const px = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  cachedSafeTop = px;
  return px;
}
