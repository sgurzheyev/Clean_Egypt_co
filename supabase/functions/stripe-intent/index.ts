import {
  assertProfileExists,
  createCardPaymentIntent,
  handlePayError,
  jsonResponse,
  optionsResponse,
  PayHttpError,
  readJsonBody,
  requireAuthedUser,
} from '../_shared/stripePay.ts';

/**
 * Creates a Stripe PaymentIntent for wallet top-up.
 * Accepts integer USD; charges that amount in currency: 'usd' (no FX).
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return optionsResponse();
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed', code: 'method_not_allowed' }, 405);
  }

  try {
    const body = await readJsonBody<{ amount_usd?: unknown; user_id?: unknown }>(req);
    const userId = typeof body.user_id === 'string' ? body.user_id.trim() : '';
    if (!userId) {
      throw new PayHttpError('Missing user_id', 400, 'missing_user');
    }

    const { user } = await requireAuthedUser(req, userId);
    await assertProfileExists(user.id);

    if (body.amount_usd === undefined || body.amount_usd === null) {
      throw new PayHttpError('Missing amount_usd', 400, 'invalid_amount');
    }

    const amountUsd = Math.floor(Math.max(0, Number(body.amount_usd)));
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      throw new PayHttpError('Invalid amount_usd', 400, 'invalid_amount');
    }
    if (amountUsd > 2_500_000) {
      throw new PayHttpError('Amount too large', 400, 'invalid_amount');
    }

    const cents = Math.max(50, amountUsd * 100);
    const intent = await createCardPaymentIntent({
      amountCents: cents,
      metadata: {
        user_id: user.id,
        purpose: 'wallet_top_up',
        amount_usd_intent: String(amountUsd),
      },
    });

    return jsonResponse({
      clientSecret: intent.clientSecret,
      livemode: intent.livemode,
      amountUsd,
    });
  } catch (error) {
    return handlePayError(error, 'stripe-intent');
  }
});
