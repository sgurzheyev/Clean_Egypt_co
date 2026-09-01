/**
 * Shared Stripe PaymentIntent helpers for token packs, subscriptions, and wallet top-up.
 * Secret keys never leave this runtime. Client 401s on api.stripe.com/v1/elements/*
 * are Stripe.js (publishable key) — this module stops invalid/empty sk_* from reaching Stripe.
 */
import { createClient, type User } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import Stripe from 'https://esm.sh/stripe@14.16.0?target=deno';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export class PayHttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'PayHttpError';
    this.status = status;
    this.code = code;
  }
}

export function isPayHttpError(err: unknown): err is PayHttpError {
  return Boolean(
    err &&
      typeof err === 'object' &&
      (err as PayHttpError).name === 'PayHttpError' &&
      typeof (err as PayHttpError).status === 'number'
  );
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function handlePayError(err: unknown, logLabel: string): Response {
  if (isPayHttpError(err)) {
    console.error(`${logLabel}:`, err.code, err.message);
    return jsonResponse({ error: err.message, code: err.code }, err.status);
  }
  const mapped = mapStripeError(err, logLabel);
  console.error(`${logLabel}:`, mapped.code, mapped.message);
  return jsonResponse({ error: mapped.message, code: mapped.code }, mapped.status);
}

export function optionsResponse(): Response {
  return new Response('ok', { headers: corsHeaders });
}

/** Strip dashboard copy-paste artifacts that make Stripe return HTTP 401. */
export function normalizeStripeSecret(raw: string | undefined | null): string {
  let value = String(raw ?? '').trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value.replace(/[\r\n\s]/g, '');
}

export type StripeKeyMode = 'live' | 'test';

export function readStripeSecretKey(): { key: string; mode: StripeKeyMode } {
  const key = normalizeStripeSecret(Deno.env.get('STRIPE_SECRET_KEY'));
  if (!key) {
    throw new PayHttpError(
      'Payment is not configured. Set STRIPE_SECRET_KEY in Supabase Edge Function secrets (Dashboard → Edge Functions → Secrets).',
      503,
      'stripe_not_configured'
    );
  }
  const match = key.match(/^(?:sk|rk)_(live|test)_/);
  if (!match) {
    throw new PayHttpError(
      'STRIPE_SECRET_KEY is malformed. Use a Stripe secret or restricted key starting with sk_live_, sk_test_, rk_live_, or rk_test_.',
      503,
      'stripe_key_invalid'
    );
  }
  return { key, mode: match[1] as StripeKeyMode };
}

export function requireSupabaseEnv(): { url: string; anonKey: string; serviceKey: string } {
  const url = String(Deno.env.get('SUPABASE_URL') ?? '').trim();
  const anonKey = String(Deno.env.get('SUPABASE_ANON_KEY') ?? '').trim();
  const serviceKey = String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
  if (!url || !anonKey) {
    throw new PayHttpError(
      'Supabase URL or anon key is missing on the Edge Function runtime.',
      503,
      'supabase_env_missing'
    );
  }
  if (!serviceKey) {
    throw new PayHttpError(
      'SUPABASE_SERVICE_ROLE_KEY is missing on the Edge Function runtime.',
      503,
      'supabase_env_missing'
    );
  }
  return { url, anonKey, serviceKey };
}

export function createStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  });
}

function bearerFromRequest(req: Request): string {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.match(/^Bearer\s+(\S+)/i)?.[1]?.trim() ?? '';
  if (!token) {
    throw new PayHttpError(
      'Sign in again. Missing Authorization: Bearer <access token>.',
      401,
      'missing_auth'
    );
  }
  return token;
}

/**
 * Verify the caller JWT with GoTrue (`getUser`) and optionally match `user_id` from the body.
 * Does not call Stripe until this succeeds.
 */
export async function requireAuthedUser(
  req: Request,
  expectedUserId?: string
): Promise<{ user: User; bearer: string }> {
  const bearer = bearerFromRequest(req);
  const { url, anonKey } = requireSupabaseEnv();
  const supabaseUser = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  const {
    data: { user },
    error,
  } = await supabaseUser.auth.getUser();
  if (error || !user?.id) {
    const msg = String(error?.message || '');
    if (/expired|invalid jwt|jwt/i.test(msg)) {
      throw new PayHttpError('Session expired. Sign in again to pay.', 401, 'session_expired');
    }
    throw new PayHttpError(
      'Sign in again. Could not verify your session.',
      401,
      'session_expired'
    );
  }
  if (expectedUserId && expectedUserId !== user.id) {
    throw new PayHttpError(
      'This payment session does not match the signed-in account.',
      403,
      'user_mismatch'
    );
  }
  return { user, bearer };
}

/** Catch a broken auth.users → public.profiles link after a DB migration. */
export async function assertProfileExists(userId: string): Promise<void> {
  const { url, serviceKey } = requireSupabaseEnv();
  const admin = createClient(url, serviceKey);
  const { data, error } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle();
  if (error) {
    console.error('profiles lookup failed', error.message);
    throw new PayHttpError(
      'Could not load your account profile after a database migration. Sign out, sign in again, or contact support.',
      503,
      'profile_lookup_failed'
    );
  }
  if (!data?.id) {
    throw new PayHttpError(
      'Your account profile is missing. Sign out, sign in again, or complete registration before paying.',
      409,
      'profile_missing'
    );
  }
}

/**
 * Map Stripe SDK failures to frontend JSON. Never echo Stripe's message — it can
 * contain a truncated secret key and would look like a client 401 if forwarded blindly.
 */
export function mapStripeError(err: unknown, action: string): PayHttpError {
  if (isPayHttpError(err)) return err;
  const anyErr = err as {
    type?: string;
    rawType?: string;
    code?: string;
    statusCode?: number;
    message?: string;
  };
  const status = Number(anyErr?.statusCode) || 0;
  const type = String(anyErr?.type || anyErr?.rawType || '');
  const code = String(anyErr?.code || '');
  const message = String(anyErr?.message || '');
  console.error(`Stripe ${action} failed`, { type, code, status });

  if (
    status === 401 ||
    type === 'StripeAuthenticationError' ||
    code === 'api_key_expired' ||
    /invalid api[- ]key|no api key provided|expired api key/i.test(message)
  ) {
    return new PayHttpError(
      'Stripe secret key is invalid, expired, or belongs to a different Stripe account. Update STRIPE_SECRET_KEY in Supabase secrets so it matches VITE_STRIPE_PUBLISHABLE_KEY (same account, live vs test).',
      503,
      'stripe_key_invalid'
    );
  }
  if (status === 403 || type === 'StripePermissionError') {
    return new PayHttpError(
      'Stripe rejected this request. If you use a restricted key, allow PaymentIntents write access.',
      503,
      'stripe_key_invalid'
    );
  }
  return new PayHttpError(
    'Could not create the payment. Please try again.',
    400,
    'stripe_create_failed'
  );
}

export async function createCardPaymentIntent(input: {
  amountCents: number;
  metadata: Record<string, string>;
}): Promise<{ clientSecret: string; livemode: boolean; paymentIntentId: string }> {
  const { key } = readStripeSecretKey();
  const stripe = createStripeClient(key);
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: input.amountCents,
      currency: 'usd',
      metadata: input.metadata,
      // Card Element + confirmCardPayment — no redirect wallets, no Elements PaymentIntent fetch.
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    });
    const clientSecret = String(paymentIntent.client_secret || '');
    if (!clientSecret) {
      throw new PayHttpError(
        'Stripe did not return a client secret. Try again.',
        502,
        'stripe_create_failed'
      );
    }
    return {
      clientSecret,
      livemode: Boolean(paymentIntent.livemode),
      paymentIntentId: paymentIntent.id,
    };
  } catch (err) {
    throw mapStripeError(err, 'paymentIntents.create');
  }
}

export async function readJsonBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new PayHttpError('Invalid JSON body.', 400, 'invalid_json');
  }
}
