import { throwIfInvokeFailed } from './supabaseFunctionError';
import { invokeAuthenticatedFunction, resolveAuthenticatedUserId } from './supabaseAuth';

/** Create a Stripe PaymentIntent for wallet top-up (USD). */
export async function createWalletTopUpIntent(input: {
  userId: string;
  amountUsd: number;
}): Promise<{ clientSecret: string; amountUsd: number }> {
  const userId = await resolveAuthenticatedUserId(input.userId);
  if (!userId) throw new Error('Not authenticated');

  const res = await invokeAuthenticatedFunction('stripe-intent', {
    user_id: userId,
    amount_usd: Math.floor(input.amountUsd),
  });
  await throwIfInvokeFailed('stripe-intent', res);
  const payload = (res.data || {}) as { clientSecret?: unknown; amountUsd?: unknown };
  const clientSecret = String(payload.clientSecret || '');
  if (!clientSecret) throw new Error('Missing client secret');
  return {
    clientSecret,
    amountUsd: Number(payload.amountUsd ?? input.amountUsd),
  };
}
