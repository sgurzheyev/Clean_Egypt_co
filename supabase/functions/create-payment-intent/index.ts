import {
  createCardPaymentIntent,
  handlePayError,
  jsonResponse,
  optionsResponse,
  PayHttpError,
  readJsonBody,
  requireAuthedUser,
} from '../_shared/stripePay.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return optionsResponse();
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed', code: 'method_not_allowed' }, 405);
  }

  try {
    await requireAuthedUser(req);
    const body = await readJsonBody<{ amount?: unknown }>(req);
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new PayHttpError('Invalid amount', 400, 'invalid_amount');
    }
    const cents = Math.round(amount * 100);
    if (cents < 50 || cents > 250_000_000) {
      throw new PayHttpError('Invalid amount', 400, 'invalid_amount');
    }

    const intent = await createCardPaymentIntent({
      amountCents: cents,
      metadata: { purpose: 'legacy_create_payment_intent' },
    });

    return jsonResponse({
      clientSecret: intent.clientSecret,
      livemode: intent.livemode,
    });
  } catch (error) {
    return handlePayError(error, 'create-payment-intent');
  }
});
