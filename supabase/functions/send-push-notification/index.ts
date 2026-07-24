/**
 * send-push-notification
 *
 * Dispatches background push for a new `public.notifications` row.
 * Invoked by:
 *   - pg_net trigger `trg_notifications_send_push` (preferred), or
 *   - Supabase Database Webhook on INSERT into `notifications`, or
 *   - Manual POST for testing.
 *
 * ---------------------------------------------------------------------------
 * REQUIRED SUPABASE SECRETS (Dashboard → Edge Functions → Secrets)
 * ---------------------------------------------------------------------------
 *   SUPABASE_URL                 — auto-injected on hosted projects
 *   SUPABASE_SERVICE_ROLE_KEY    — auto-injected; used to read user_push_tokens
 *
 * Choose ONE push provider path:
 *
 * A) Firebase Cloud Messaging (recommended for Android / Capacitor / Web FCM)
 *   FCM_SERVER_KEY               — REQUIRED for production dispatch today.
 *                                  Firebase Console → Project settings → Cloud Messaging
 *                                  → Cloud Messaging API (Legacy) → Server key
 *                                  Set with:  supabase secrets set FCM_SERVER_KEY="...."
 *   Without FCM_SERVER_KEY the function returns dry_run:true (safe no-op).
 *
 *   Optional HTTP v1 (future):
 *   FCM_SERVICE_ACCOUNT_JSON     — full service-account JSON string
 *   FCM_PROJECT_ID               — Firebase project id
 *
 * B) Web Push (VAPID) — browser Push API without FCM
 *   VAPID_PUBLIC_KEY
 *   VAPID_PRIVATE_KEY
 *   VAPID_SUBJECT                — mailto:you@cleanegypt.co or https://…
 *
 * Optional:
 *   PUSH_WEBHOOK_SECRET          — must match private.app_config
 *                                  `send_push_notification_webhook_secret`
 *   APP_DEEP_LINK_BASE           — e.g. https://cleanegypt.co (mission deep links)
 *
 * Client env (Vite) for registration — see src/services/pushNotifications.ts:
 *   VITE_FIREBASE_API_KEY / VITE_FIREBASE_AUTH_DOMAIN / VITE_FIREBASE_PROJECT_ID
 *   VITE_FIREBASE_MESSAGING_SENDER_ID / VITE_FIREBASE_APP_ID
 *   VITE_FCM_VAPID_KEY           — Web Push certificates key pair from Firebase
 *   VITE_VAPID_PUBLIC_KEY        — if using pure Web Push (path B)
 * ---------------------------------------------------------------------------
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type PushPayload = {
  notification_id?: string;
  user_id: string;
  type?: string;
  title?: string | null;
  message?: string | null;
  mission_id?: string | null;
  actor_id?: string | null;
  created_at?: string | null;
  record?: Record<string, unknown>;
};

type TokenRow = {
  id: string;
  token: string;
  platform: string;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function str(v: unknown, fallback = ''): string {
  if (v == null) return fallback;
  const s = String(v).trim();
  return s.length ? s : fallback;
}

function normalizePayload(body: Record<string, unknown>): PushPayload | null {
  // Direct shape from our pg_net trigger
  if (body.user_id) {
    return {
      notification_id: str(body.notification_id) || undefined,
      user_id: str(body.user_id),
      type: str(body.type) || undefined,
      title: str(body.title) || null,
      message: str(body.message) || null,
      mission_id: str(body.mission_id) || null,
      actor_id: str(body.actor_id) || null,
      created_at: str(body.created_at) || null,
    };
  }

  // Supabase Database Webhook envelope: { type, table, record, ... }
  const record = (body.record || body.new || null) as Record<string, unknown> | null;
  if (record && record.user_id) {
    return {
      notification_id: str(record.id) || undefined,
      user_id: str(record.user_id),
      type: str(record.type) || undefined,
      title: str(record.title) || null,
      message: str(record.message) || null,
      mission_id: str(record.mission_id) || null,
      actor_id: str(record.actor_id) || null,
      created_at: str(record.created_at) || null,
      record,
    };
  }

  return null;
}

async function sendFcmLegacy(
  serverKey: string,
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, string>
): Promise<{ ok: number; fail: number; stale: string[] }> {
  let ok = 0;
  let fail = 0;
  const stale: string[] = [];

  // Legacy multicast (up to 1000). Scaffold sends one-by-one for clearer errors.
  for (const token of tokens) {
    try {
      const res = await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: {
          Authorization: `key=${serverKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: token,
          priority: 'high',
          notification: {
            title,
            body,
            click_action: data.click_action || undefined,
          },
          data,
        }),
      });
      const raw = await res.text();
      let parsed: { success?: number; failure?: number; results?: Array<{ error?: string }> } = {};
      try {
        parsed = JSON.parse(raw);
      } catch {
        /* ignore */
      }
      if (!res.ok || parsed.failure) {
        fail += 1;
        const errCode = parsed.results?.[0]?.error || '';
        if (
          errCode === 'NotRegistered' ||
          errCode === 'InvalidRegistration' ||
          /not.?registered/i.test(raw)
        ) {
          stale.push(token);
        }
        console.warn('FCM send failed', res.status, raw.slice(0, 300));
      } else {
        ok += 1;
      }
    } catch (e) {
      fail += 1;
      console.warn('FCM send threw', e);
    }
  }

  return { ok, fail, stale };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const expectedSecret = str(Deno.env.get('PUSH_WEBHOOK_SECRET'));
  if (expectedSecret) {
    const got = str(req.headers.get('x-webhook-secret'));
    if (got !== expectedSecret) {
      return json({ error: 'Unauthorized webhook' }, 401);
    }
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const payload = normalizePayload(body);
  if (!payload?.user_id) {
    return json({ error: 'Missing user_id / notification payload' }, 400);
  }

  const supabaseUrl = str(Deno.env.get('SUPABASE_URL'));
  const serviceKey = str(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: tokenRows, error: tokenErr } = await supabase
    .from('user_push_tokens')
    .select('id, token, platform')
    .eq('user_id', payload.user_id);

  if (tokenErr) {
    console.error('user_push_tokens query failed', tokenErr);
    return json({ error: tokenErr.message }, 500);
  }

  const rows = (tokenRows || []) as TokenRow[];
  if (rows.length === 0) {
    return json({
      ok: true,
      skipped: true,
      reason: 'no_device_tokens',
      user_id: payload.user_id,
    });
  }

  const title =
    str(payload.title) ||
    str(payload.type) ||
    'CleanEgypt';
  const message =
    str(payload.message) ||
    str(payload.title) ||
    'You have a new notification';

  const deepBase = str(Deno.env.get('APP_DEEP_LINK_BASE'), 'https://cleanegypt.co');
  const missionId = str(payload.mission_id);
  const clickAction = missionId
    ? `${deepBase.replace(/\/$/, '')}/?mission=${encodeURIComponent(missionId)}`
    : deepBase;

  const data: Record<string, string> = {
    type: str(payload.type, 'generic'),
    notification_id: str(payload.notification_id),
    mission_id: missionId,
    click_action: clickAction,
  };

  const fcmServerKey = str(Deno.env.get('FCM_SERVER_KEY'));
  const vapidPrivate = str(Deno.env.get('VAPID_PRIVATE_KEY'));

  if (!fcmServerKey && !vapidPrivate) {
    console.warn(
      'No FCM_SERVER_KEY or VAPID_PRIVATE_KEY set — dry-run only. Configure secrets before production.'
    );
    return json({
      ok: true,
      dry_run: true,
      user_id: payload.user_id,
      tokens: rows.length,
      title,
      message,
      data,
      hint: 'Set FCM_SERVER_KEY (or VAPID_* keys) in Edge Function secrets',
    });
  }

  let sent = { ok: 0, fail: 0, stale: [] as string[] };

  if (fcmServerKey) {
    sent = await sendFcmLegacy(
      fcmServerKey,
      rows.map((r) => r.token),
      title,
      message,
      data
    );
  } else if (vapidPrivate) {
    // Scaffold: Web Push requires encrypted payloads (web-push lib).
    // Documented for Phase 5 completion — return dry_run until wired.
    console.warn(
      'VAPID_PRIVATE_KEY present but Web Push sender not fully wired in this scaffold. Prefer FCM_SERVER_KEY for now.'
    );
    return json({
      ok: true,
      dry_run: true,
      provider: 'web_push_vapid',
      tokens: rows.length,
      title,
      message,
      hint: 'Install/complete web-push sender or use FCM_SERVER_KEY',
    });
  }

  if (sent.stale.length) {
    await supabase.from('user_push_tokens').delete().in('token', sent.stale);
  }

  // Touch last_used_at for successful devices (best-effort).
  if (sent.ok > 0) {
    const good = rows
      .filter((r) => !sent.stale.includes(r.token))
      .map((r) => r.token);
    if (good.length) {
      await supabase
        .from('user_push_tokens')
        .update({ last_used_at: new Date().toISOString() })
        .in('token', good);
    }
  }

  return json({
    ok: true,
    user_id: payload.user_id,
    notification_id: payload.notification_id,
    provider: fcmServerKey ? 'fcm_legacy' : 'none',
    sent: sent.ok,
    failed: sent.fail,
    pruned_stale: sent.stale.length,
  });
});
