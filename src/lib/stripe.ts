import { supabase } from '../../services/supabase';

/** Create a Stripe PaymentIntent for wallet top-up (USD). */
export async function createWalletTopUpIntent(input: {
  userId: string;
  amountUsd: number;
}): Promise<{ clientSecret: string; amountUsd: number }> {
  const res = await supabase.functions.invoke('stripe-intent', {
    body: {
      user_id: input.userId,
      amount_usd: Math.floor(input.amountUsd),
    },
  });
  if (res.error) throw new Error(res.error.message || 'stripe-intent failed');
  if (res.data?.error) throw new Error(String(res.data.error));
  const clientSecret = String(res.data?.clientSecret || '');
  if (!clientSecret) throw new Error('Missing client secret');
  return {
    clientSecret,
    amountUsd: Number(res.data?.amountUsd ?? input.amountUsd),
  };
}
