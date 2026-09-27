/**
 * Play Billing purchase verification. OFF unless PLAY_BILLING_ENABLED=true.
 * That secret is not set. This function does not credit tokens while it is off.
 *
 * When enabled it:
 *   1. Checks the caller JWT.
 *   2. Exchanges GOOGLE_PLAY_SERVICE_ACCOUNT_JSON for an Android Publisher token.
 *   3. Reads the purchase from the Google Play Developer API.
 *   4. Credits tokens or the yearly subscription only after purchaseState 0,
 *      idempotent on `play:` + purchase token via the existing service-role RPCs.
 *   5. Then consumes the token pack or acknowledges the subscription.
 *
 * SKUs (create these in Play Console before ever enabling the flag):
 *   tokens_100, tokens_300, tokens_700, tokens_5000, yearly_access
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import {
  handlePayError,
  jsonResponse,
  optionsResponse,
  PayHttpError,
  readJsonBody,
  requireAuthedUser,
  requireSupabaseEnv,
} from '../_shared/stripePay.ts';

const PACKAGE_NAME = 'com.garbagin.app';
const TOKEN_SKUS: Record<string, number> = {
  tokens_100: 100,
  tokens_300: 300,
  tokens_700: 700,
  tokens_5000: 5000,
};
const SUBSCRIPTION_SKU = 'yearly_access';
const SUBSCRIPTION_MONTHS = 12;

function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function playAccessToken(clientEmail: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: clientEmail,
        scope: 'https://www.googleapis.com/auth/androidpublisher',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      })
    )
  );
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  );
  const assertion = `${unsigned}.${b64url(signature)}`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new PayHttpError('Play API auth failed', 502, 'play_auth_failed');
  }
  return tokenJson.access_token;
}

async function readPlayPurchase(
  accessToken: string,
  productId: string,
  purchaseToken: string,
  subscription: boolean
): Promise<{ purchaseState: number }> {
  const kind = subscription ? 'subscriptions' : 'products';
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}` +
    `/purchases/${kind}/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = (await res.json()) as { purchaseState?: number; paymentState?: number };
  if (!res.ok) {
    throw new PayHttpError('Play purchase lookup failed', 402, 'play_purchase_invalid');
  }
  const purchaseState = subscription
    ? body.paymentState === 1
      ? 0
      : 1
    : Number(body.purchaseState);
  return { purchaseState };
}

/** Consumable token packs are consumed. The subscription is acknowledged. Both stay behind the flag. */
async function settlePlayPurchase(
  accessToken: string,
  productId: string,
  purchaseToken: string,
  subscription: boolean
): Promise<boolean> {
  const kind = subscription ? 'subscriptions' : 'products';
  const action = subscription ? 'acknowledge' : 'consume';
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}` +
    `/purchases/${kind}/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:${action}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (res.ok) return true;
  const text = await res.text();
  if (res.status === 400 && /already/i.test(text)) return true;
  console.error('play-billing-verify settle failed', res.status, text.slice(0, 300));
  return false;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return optionsResponse();
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed', code: 'method_not_allowed' }, 405);
  }

  if (Deno.env.get('PLAY_BILLING_ENABLED') !== 'true') {
    return jsonResponse(
      { error: 'Play Billing is not enabled', code: 'play_billing_disabled', enabled: false },
      403
    );
  }

  try {
    const { user } = await requireAuthedUser(req);
    const rawAccount = Deno.env.get('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON') || '';
    if (!rawAccount.trim()) {
      throw new PayHttpError('Play service account is not configured', 503, 'play_not_configured');
    }
    const account = JSON.parse(rawAccount) as { client_email?: string; private_key?: string };
    if (!account.client_email || !account.private_key) {
      throw new PayHttpError('Play service account is incomplete', 503, 'play_not_configured');
    }

    const body = await readJsonBody<{ product_id?: unknown; purchase_token?: unknown }>(req);
    const productId = typeof body.product_id === 'string' ? body.product_id.trim() : '';
    const purchaseToken =
      typeof body.purchase_token === 'string' ? body.purchase_token.trim() : '';
    if (!productId || !purchaseToken) {
      throw new PayHttpError('Missing product or purchase token', 400, 'play_token_missing');
    }

    const accessToken = await playAccessToken(account.client_email, account.private_key);
    const subscription = productId === SUBSCRIPTION_SKU;
    if (!subscription && !(productId in TOKEN_SKUS)) {
      throw new PayHttpError('Unknown Play product', 400, 'play_sku_missing');
    }
    const purchase = await readPlayPurchase(accessToken, productId, purchaseToken, subscription);
    if (purchase.purchaseState !== 0) {
      throw new PayHttpError('Purchase is not paid', 402, 'play_not_purchased');
    }

    const { url, serviceKey } = requireSupabaseEnv();
    const admin = createClient(url, serviceKey);
    const ledgerId = `play:${purchaseToken}`;

    if (subscription) {
      const { data, error } = await admin.rpc('activate_subscription_from_payment_service_role', {
        p_user_id: user.id,
        p_payment_intent_id: ledgerId,
        p_months: SUBSCRIPTION_MONTHS,
      });
      if (error) throw new PayHttpError(error.message, 400, 'credit_failed');
      const acknowledged = await settlePlayPurchase(
        accessToken,
        productId,
        purchaseToken,
        true
      );
      return jsonResponse({ ok: true, acknowledged, subscription_expires_at: data });
    }

    const tokens = TOKEN_SKUS[productId];
    const { data, error } = await admin.rpc('credit_tokens_from_payment_service_role', {
      p_user_id: user.id,
      p_payment_intent_id: ledgerId,
      p_tokens: tokens,
    });
    if (error) throw new PayHttpError(error.message, 400, 'credit_failed');
    const acknowledged = await settlePlayPurchase(
      accessToken,
      productId,
      purchaseToken,
      false
    );
    return jsonResponse({ ok: true, acknowledged, token_balance: data });
  } catch (error) {
    return handlePayError(error, 'play-billing-verify');
  }
});
