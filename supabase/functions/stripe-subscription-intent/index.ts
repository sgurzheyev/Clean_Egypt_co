import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import Stripe from 'https://esm.sh/stripe@14.16.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Yearly SaaS subscription — keep in sync with `src/lib/tokenPricing.ts`. */
const YEARLY_PLAN = {
  cents: 999,
  months: 12,
  bonusTokens: 100,
  tier: 'yearly_access',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!stripeKey || !supabaseUrl || !anonKey) {
      throw new Error('Environment variables are not set in Supabase');
    }

    const body = (await req.json()) as {
      user_id?: unknown;
      plan_usd?: unknown;
      plan_usd_cents?: unknown;
      plan_months?: unknown;
      bonus_tokens?: unknown;
      plan_tier?: unknown;
    };
    const user_id = String(body.user_id ?? '');
    const plan_months = Math.floor(Number(body.plan_months ?? 0));
    const plan_usd_cents = Math.floor(
      Number(body.plan_usd_cents ?? 0) || Math.floor(Number(body.plan_usd ?? 0)) * 100
    );
    const bonus_tokens = Math.floor(Number(body.bonus_tokens ?? 0));
    const plan_tier = String(body.plan_tier ?? '');

    if (!user_id) {
      return new Response(JSON.stringify({ error: 'Missing user_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const planOk =
      plan_usd_cents === YEARLY_PLAN.cents &&
      plan_months === YEARLY_PLAN.months &&
      bonus_tokens === YEARLY_PLAN.bonusTokens &&
      plan_tier === YEARLY_PLAN.tier;

    if (!planOk) {
      return new Response(JSON.stringify({ error: 'Invalid plan' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !user || user.id !== user_id) {
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
      amount: plan_usd_cents,
      currency: 'usd',
      metadata: {
        user_id,
        months: String(plan_months),
        purpose: 'executor_subscription',
        plan_tier: YEARLY_PLAN.tier,
        bonus_tokens: String(bonus_tokens),
      },
      automatic_payment_methods: { enabled: true },
    });

    return new Response(JSON.stringify({ clientSecret: paymentIntent.client_secret }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    console.error('Error creating payment intent:', error?.message || error);
    return new Response(JSON.stringify({ error: String(error?.message || 'Unknown error') }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
