/**
 * Canonical Garbagin brand + public site origin.
 * Prefer `VITE_APP_ORIGIN` in deployed environments; fall back to live domain.
 */
export const APP_BRAND = 'Garbagin';
export const APP_DOMAIN = 'garbagin.com';
export const APP_ORIGIN_DEFAULT = `https://${APP_DOMAIN}`;
export const APP_SUPPORT_EMAIL = `support@${APP_DOMAIN}`;
export const APP_TELEGRAM_SUPPORT = 'https://t.me/Garbagin_Admin_Bot';
export const APP_TMA_EMAIL_DOMAIN = `tma.${APP_DOMAIN}`;

/** Custom window events (mission lifecycle). */
export const APP_EVENT_MISSION_COMPLETED = 'garbagin:mission-completed';
export const APP_EVENT_MISSION_DELETED = 'garbagin:mission-deleted';
/**
 * Deep-link into a mission briefing from overlays outside MapPicker
 * (e.g. the Immersive Visual Feed inside Profile).
 * detail: { missionId: string; openChatWith?: string | null }
 */
export const APP_EVENT_OPEN_MISSION = 'garbagin:open-mission';

/**
 * Absolute site origin for Stripe redirects, auth email links, and deep links.
 * Uses VITE_APP_ORIGIN when set; otherwise the current browser origin; else production.
 */
export function getAppOrigin(): string {
  const fromEnv =
    typeof import.meta !== 'undefined' &&
    typeof import.meta.env?.VITE_APP_ORIGIN === 'string' &&
    import.meta.env.VITE_APP_ORIGIN.trim()
      ? String(import.meta.env.VITE_APP_ORIGIN).trim().replace(/\/$/, '')
      : '';
  if (fromEnv) return fromEnv;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/$/, '');
  }
  return APP_ORIGIN_DEFAULT;
}

/** Build an absolute app URL (pathname should start with `/` or be empty). */
export function appUrl(pathname = '/'): string {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${getAppOrigin()}${path === '/' ? '/' : path}`;
}
