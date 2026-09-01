import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import {
  createStripeClient,
  handlePayError,
  jsonResponse,
  mapStripeError,
  optionsResponse,
  PayHttpError,
  readJsonBody,
  readStripeSecretKey,
  requireAuthedUser,
  requireSupabaseEnv,
} from '../_shared/stripePay.ts';

/**
 * After Stripe confirmation, activate subscription idempotently using:
 * `activate_subscription_from_payment_service_role(user_id, payment_intent_id, months)`.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return optionsResponse();
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed', code: 'method_not_allowed' }, 405);
  }

  try {
    const { user } = await requireAuthedUser(req);
    const { url, serviceKey } = requireSupabaseEnv();
    const { key } = readStripeSecretKey();

    const body = await readJsonBody<{ payment_intent_id?: unknown }>(req);
    const paymentIntentId =
      typeof body.payment_intent_id === 'string' ? body.payment_intent_id.trim() : '';
    if (!paymentIntentId) {
      throw new PayHttpError('Missing payment_intent_id', 400, 'missing_payment');
    }

    const stripe = createStripeClient(key);
    let pi;
    try {
      pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (err) {
      throw mapStripeError(err, 'paymentIntents.retrieve');
    }

    if (pi.status !== 'succeeded') {
      throw new PayHttpError('Payment not succeeded', 400, 'payment_not_succeeded');
    }

    const metaUser = pi.metadata?.user_id;
    if (!metaUser || metaUser !== user.id) {
      throw new PayHttpError('Payment not for this user', 403, 'user_mismatch');
    }
    if (pi.metadata?.purpose !== 'executor_subscription') {
      throw new PayHttpError('Invalid payment purpose', 400, 'invalid_purpose');
    }

    const months = Math.floor(Number(pi.metadata?.months ?? 0));
    if (months <= 0 || months > 120) {
      throw new PayHttpError('Invalid months metadata', 400, 'invalid_months');
    }

    const supabaseService = createClient(url, serviceKey);
    const { data: exp, error: rpcErr } = await supabaseService.rpc(
      'activate_subscription_from_payment_service_role',
      {
        p_user_id: user.id,
        p_payment_intent_id: paymentIntentId,
        p_months: months,
      }
    );
    if (rpcErr) {
      console.error('activate_subscription_from_payment_service_role', rpcErr);
      const msg = String(rpcErr.message || '');
      if (/profile not found/i.test(msg)) {
        throw new PayHttpError(
          'Your account profile is missing. Sign out, sign in again, or complete registration.',
          409,
          'profile_missing'
        );
      }
      throw new PayHttpError(msg || 'Could not activate subscription', 400, 'activate_failed');
    }

    const bonusTokens = Math.floor(Number(pi.metadata?.bonus_tokens ?? 0));
    if (bonusTokens > 0) {
      const { error: bonusErr } = await supabaseService.rpc(
        'credit_tokens_from_payment_service_role',
        {
          p_user_id: user.id,
          p_payment_intent_id: `${paymentIntentId}:bonus`,
          p_tokens: bonusTokens,
        }
      );
      if (bonusErr) {
        console.error('subscription bonus token credit', bonusErr);
      }
    }

    return jsonResponse({ subscription_expires_at: exp });
  } catch (error) {
    return handlePayError(error, 'stripe-subscription-activate');
  }
});
