import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import Stripe from 'https://esm.sh/stripe@14.16.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) throw new Error('Missing STRIPE_SECRET_KEY');

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !anonKey) throw new Error('Missing SUPABASE_URL / SUPABASE_ANON_KEY');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as {
      user_id?: unknown;
      pack_tokens?: unknown;
      pack_usd?: unknown;
      pack_usd_cents?: unknown;
    };
    const userId = typeof body.user_id === 'string' ? body.user_id.trim() : '';
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Missing user_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const packTokens = Math.floor(Number(body.pack_tokens));
    let packCents = Math.floor(Number(body.pack_usd_cents));
    if (!Number.isFinite(packCents) || packCents <= 0) {
      const legacyUsd = Math.floor(Number(body.pack_usd));
      if (legacyUsd > 0) packCents = legacyUsd * 100;
    }

    if (!isAllowedPack(packCents, packTokens)) {
      return new Response(JSON.stringify({ error: 'Invalid pack' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !user || user.id !== userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    });
    const paymentIntent = await stripe.paymentIntents.create({
      amount: packCents,
      currency: 'usd',
      metadata: {
        user_id: userId,
        purpose: 'token_pack',
        tokens: String(packTokens),
        pack_usd_cents: String(packCents),
      },
      automatic_payment_methods: { enabled: true },
    });

    return new Response(JSON.stringify({ clientSecret: paymentIntent.client_secret }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    console.error('stripe-token-intent error:', error?.message || error);
    return new Response(JSON.stringify({ error: String(error?.message || 'Unknown error') }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
