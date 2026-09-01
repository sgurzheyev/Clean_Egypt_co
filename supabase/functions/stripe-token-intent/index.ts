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

/** SaaS token top-up tiers — keep in sync with `src/lib/tokenPricing.ts`. */
const ALLOWED_PACKS: { cents: number; tokens: number }[] = [
  { cents: 1000, tokens: 100 },
  { cents: 1999, tokens: 300 },
  { cents: 4999, tokens: 700 },
  { cents: 9900, tokens: 5000 },
];

function isAllowedPack(cents: number, tokens: number): boolean {
  return ALLOWED_PACKS.some((p) => p.cents === cents && p.tokens === tokens);
}

/**
 * Stripe PaymentIntent for token top-up purchase (tiered SaaS packs).
 * Requires Authorization: Bearer <user JWT>. Never calls Stripe with an empty/malformed secret.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return optionsResponse();
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed', code: 'method_not_allowed' }, 405);
  }

  try {
    const body = await readJsonBody<{
      user_id?: unknown;
      pack_tokens?: unknown;
      pack_usd?: unknown;
      pack_usd_cents?: unknown;
    }>(req);

    const userId = typeof body.user_id === 'string' ? body.user_id.trim() : '';
    if (!userId) {
      throw new PayHttpError('Missing user_id', 400, 'missing_user');
    }

    const { user } = await requireAuthedUser(req, userId);
    await assertProfileExists(user.id);

    const packTokens = Math.floor(Number(body.pack_tokens));
    let packCents = Math.floor(Number(body.pack_usd_cents));
    if (!Number.isFinite(packCents) || packCents <= 0) {
      const legacyUsd = Math.floor(Number(body.pack_usd));
      if (legacyUsd > 0) packCents = legacyUsd * 100;
    }

    if (!isAllowedPack(packCents, packTokens)) {
      throw new PayHttpError('Invalid pack', 400, 'invalid_pack');
    }

    const intent = await createCardPaymentIntent({
      amountCents: packCents,
      metadata: {
        user_id: user.id,
        purpose: 'token_pack',
        tokens: String(packTokens),
        pack_usd_cents: String(packCents),
      },
    });

    return jsonResponse({
      clientSecret: intent.clientSecret,
      livemode: intent.livemode,
    });
  } catch (error) {
    return handlePayError(error, 'stripe-token-intent');
  }
});
