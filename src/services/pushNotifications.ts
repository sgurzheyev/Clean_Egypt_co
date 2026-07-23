/**
 * Phase 5 — browser / PWA push registration.
 *
 * Saves FCM or Web Push tokens into `public.user_push_tokens` via
 * `upsert_user_push_token` (or direct table upsert).
 *
 * Env (Vite):
 *   FCM Web (add `firebase` package when enabling):
 *     VITE_FIREBASE_API_KEY
 *     VITE_FIREBASE_AUTH_DOMAIN
 *     VITE_FIREBASE_PROJECT_ID
 *     VITE_FIREBASE_MESSAGING_SENDER_ID
 *     VITE_FIREBASE_APP_ID
 *     VITE_FCM_VAPID_KEY
 *
 *   Pure Web Push:
 *     VITE_VAPID_PUBLIC_KEY
 *
 * Without secrets, DEV mode still writes a stub token so DB wiring can be tested.
 */
import { supabase } from '../../services/supabase';

export type PushPlatform = 'web' | 'android' | 'ios';

export type PushRegistrationResult = {
  ok: boolean;
  token?: string;
  platform: PushPlatform;
  permission: NotificationPermission | 'unsupported';
  reason?: string;
};

function detectPlatform(): PushPlatform {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/android/i.test(ua)) return 'android';
  if (/iPad|iPhone|iPod/i.test(ua)) return 'ios';
  return 'web';
}

function hasFirebaseEnv(): boolean {
  return !!(
    String(import.meta.env.VITE_FIREBASE_API_KEY || '').trim() &&
    String(import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim() &&
    String(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim() &&
    String(import.meta.env.VITE_FIREBASE_APP_ID || '').trim() &&
    String(import.meta.env.VITE_FCM_VAPID_KEY || '').trim()
  );
}

async function persistToken(token: string, platform: PushPlatform): Promise<void> {
  const { error: rpcErr } = await supabase.rpc('upsert_user_push_token', {
    p_token: token,
    p_platform: platform,
  });
  if (!rpcErr) return;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) throw rpcErr;

  const { error } = await supabase.from('user_push_tokens').upsert(
    {
      user_id: uid,
      token,
      platform,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: 'token' }
  );
  if (error) throw error || rpcErr;
}

/**
 * FCM token path — enable after `npm i firebase` and setting VITE_FIREBASE_*.
 * Left as an explicit stub so the Vite build does not require the firebase package yet.
 */
async function getFcmToken(): Promise<string | null> {
  if (!hasFirebaseEnv()) return null;
  console.info(
    '[push] VITE_FIREBASE_* detected. Install `firebase`, then implement getToken() in getFcmToken() (see Phase 5 comments).'
  );
  return null;
}

async function getWebPushSubscriptionToken(): Promise<string | null> {
  const vapid = String(import.meta.env.VITE_VAPID_PUBLIC_KEY || '').trim();
  if (!vapid || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return null;
  }
  const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const key = urlBase64ToUint8Array(vapid);
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
  }
  return JSON.stringify(sub.toJSON());
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Request permission (if needed), obtain a device token, persist to Supabase.
 */
export async function registerPushNotifications(): Promise<PushRegistrationResult> {
  const platform = detectPlatform();

  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return { ok: false, platform, permission: 'unsupported', reason: 'unsupported' };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    return {
      ok: false,
      platform,
      permission: Notification.permission,
      reason: 'not_authenticated',
    };
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') {
    return { ok: false, platform, permission, reason: 'permission_denied' };
  }

  try {
    let token = (await getFcmToken()) || (await getWebPushSubscriptionToken());

    if (!token && import.meta.env.DEV) {
      token = `dev-stub-${session.user.id.slice(0, 8)}-${Date.now()}`;
    }

    if (!token) {
      return {
        ok: false,
        platform,
        permission,
        reason: 'missing_fcm_or_vapid_env',
      };
    }

    await persistToken(token, platform);
    return { ok: true, token, platform, permission };
  } catch (err) {
    console.warn('registerPushNotifications failed', err);
    return {
      ok: false,
      platform,
      permission,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function unregisterPushToken(token: string): Promise<void> {
  const { error } = await supabase.from('user_push_tokens').delete().eq('token', token);
  if (error) throw error;
}
