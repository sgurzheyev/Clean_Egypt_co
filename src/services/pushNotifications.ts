/**
 * Phase 5 — browser / PWA push registration (FCM + Web Push).
 *
 * Env (Vite) — accept either VAPID name:
 *   VITE_FIREBASE_API_KEY
 *   VITE_FIREBASE_AUTH_DOMAIN (optional)
 *   VITE_FIREBASE_PROJECT_ID
 *   VITE_FIREBASE_MESSAGING_SENDER_ID
 *   VITE_FIREBASE_APP_ID
 *   VITE_FIREBASE_VAPID_KEY  (preferred) or VITE_FCM_VAPID_KEY
 *   VITE_VAPID_PUBLIC_KEY    (pure Web Push fallback)
 */
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { supabase } from '../../services/supabase';

export type PushPlatform = 'web' | 'android' | 'ios';

export type PushRegistrationResult = {
  ok: boolean;
  token?: string;
  platform: PushPlatform;
  permission: NotificationPermission | 'unsupported';
  reason?: string;
};

function env(name: string): string {
  return String(import.meta.env[name] || '').trim();
}

function vapidKey(): string {
  return env('VITE_FIREBASE_VAPID_KEY') || env('VITE_FCM_VAPID_KEY');
}

function detectPlatform(): PushPlatform {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/android/i.test(ua)) return 'android';
  if (/iPad|iPhone|iPod/i.test(ua)) return 'ios';
  return 'web';
}

function firebaseWebConfig(): {
  apiKey: string;
  authDomain: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
} | null {
  const apiKey = env('VITE_FIREBASE_API_KEY');
  const projectId = env('VITE_FIREBASE_PROJECT_ID');
  const messagingSenderId = env('VITE_FIREBASE_MESSAGING_SENDER_ID');
  const appId = env('VITE_FIREBASE_APP_ID');
  if (!apiKey || !projectId || !messagingSenderId || !appId) return null;
  return {
    apiKey,
    authDomain: env('VITE_FIREBASE_AUTH_DOMAIN') || `${projectId}.firebaseapp.com`,
    projectId,
    messagingSenderId,
    appId,
  };
}

function hasFirebaseEnv(): boolean {
  return !!(firebaseWebConfig() && vapidKey());
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

async function getFcmToken(): Promise<string | null> {
  const cfg = firebaseWebConfig();
  const key = vapidKey();
  if (!cfg || !key) return null;

  const supported = await isSupported().catch(() => false);
  if (!supported) {
    console.info('[push] Firebase Messaging not supported in this browser');
    return null;
  }
  if (!('serviceWorker' in navigator)) return null;

  const app = getApps().length > 0 ? getApp() : initializeApp(cfg);
  // Prefer env-injected SW (Vite plugin); fall back to placeholder public SW.
  const swUrl = '/firebase-messaging-sw.generated.js';
  let reg: ServiceWorkerRegistration;
  try {
    reg = await navigator.serviceWorker.register(swUrl, { scope: '/' });
  } catch {
    reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
      scope: '/',
    });
  }
  await navigator.serviceWorker.ready;

  const messaging = getMessaging(app);
  const token = await getToken(messaging, {
    vapidKey: key,
    serviceWorkerRegistration: reg,
  });
  return token || null;
}

async function getWebPushSubscriptionToken(): Promise<string | null> {
  const vapid = env('VITE_VAPID_PUBLIC_KEY');
  if (!vapid || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return null;
  }
  const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const applicationServerKey = urlBase64ToUint8Array(vapid);
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
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
 * Never throws to callers — returns a structured result for denied/unsupported cases.
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
    try {
      permission = await Notification.requestPermission();
    } catch (err) {
      return {
        ok: false,
        platform,
        permission: 'denied',
        reason: err instanceof Error ? err.message : 'permission_request_failed',
      };
    }
  }
  if (permission !== 'granted') {
    return { ok: false, platform, permission, reason: 'permission_denied' };
  }

  try {
    let token: string | null = null;
    try {
      token = await getFcmToken();
    } catch (err) {
      console.warn('[push] FCM getToken failed, trying Web Push fallback', err);
    }
    if (!token) {
      try {
        token = await getWebPushSubscriptionToken();
      } catch (err) {
        console.warn('[push] Web Push subscribe failed', err);
      }
    }

    if (!token && import.meta.env.DEV && !hasFirebaseEnv()) {
      token = `dev-stub-${session.user.id.slice(0, 8)}-${Date.now()}`;
    }

    if (!token) {
      return {
        ok: false,
        platform,
        permission,
        reason: hasFirebaseEnv() ? 'token_unavailable' : 'missing_fcm_or_vapid_env',
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
