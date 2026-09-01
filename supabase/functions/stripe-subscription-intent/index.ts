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

/** Yearly SaaS subscription — keep in sync with `src/lib/tokenPricing.ts`. */
const YEARLY_PLAN = {
  cents: 999,
  months: 12,
  bonusTokens: 100,
  tier: 'yearly_access',
};

/**
 * Stripe PaymentIntent for yearly worker access.
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
      plan_usd?: unknown;
      plan_usd_cents?: unknown;
      plan_months?: unknown;
      bonus_tokens?: unknown;
      plan_tier?: unknown;
    }>(req);

    const userId = String(body.user_id ?? '').trim();
    if (!userId) {
      throw new PayHttpError('Missing user_id', 400, 'missing_user');
    }

    const { user } = await requireAuthedUser(req, userId);
    await assertProfileExists(user.id);

    const planMonths = Math.floor(Number(body.plan_months ?? 0));
    const planUsdCents = Math.floor(
      Number(body.plan_usd_cents ?? 0) || Math.floor(Number(body.plan_usd ?? 0)) * 100
    );
    const bonusTokens = Math.floor(Number(body.bonus_tokens ?? 0));
    const planTier = String(body.plan_tier ?? '');

    const planOk =
      planUsdCents === YEARLY_PLAN.cents &&
      planMonths === YEARLY_PLAN.months &&
      bonusTokens === YEARLY_PLAN.bonusTokens &&
      planTier === YEARLY_PLAN.tier;

    if (!planOk) {
      throw new PayHttpError('Invalid plan', 400, 'invalid_plan');
    }

    const intent = await createCardPaymentIntent({
      amountCents: planUsdCents,
      metadata: {
        user_id: user.id,
        months: String(planMonths),
        purpose: 'executor_subscription',
        plan_tier: YEARLY_PLAN.tier,
        bonus_tokens: String(bonusTokens),
      },
    });

    return jsonResponse({
      clientSecret: intent.clientSecret,
      livemode: intent.livemode,
    });
  } catch (error) {
    return handlePayError(error, 'stripe-subscription-intent');
  }
});
