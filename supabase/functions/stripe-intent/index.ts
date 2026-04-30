import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import Stripe from 'https://esm.sh/stripe@14.16.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Creates a Stripe PaymentIntent for wallet top-up.
 * Accepts integer EGP only; computes USD charge server-side using platform_settings.usd_to_egp_rate (fallback 55).
 * Client must not send trusted USD or final EGP credit.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      throw new Error('Missing STRIPE_SECRET_KEY in Supabase Secrets');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceKey) {
      throw new Error('Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY');
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as { amount_egp?: unknown; user_id?: unknown };
    const userId = typeof body.user_id === 'string' ? body.user_id : '';
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Missing user_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.amount_egp === undefined || body.amount_egp === null) {
      return new Response(JSON.stringify({ error: 'Missing amount_egp' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await supabaseUser.auth.getUser();
    if (userErr || !user || user.id !== userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rawEgp = Number(body.amount_egp);
    const amountEgp = Math.floor(Math.max(0, rawEgp));
    if (!Number.isFinite(amountEgp) || amountEgp <= 0) {
      return new Response(JSON.stringify({ error: 'Invalid amount_egp' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (amountEgp > 2_500_000) {
      return new Response(JSON.stringify({ error: 'Amount too large' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseService = createClient(supabaseUrl, serviceKey);
    const { data: rateRow } = await supabaseService
      .from('platform_settings')
      .select('usd_to_egp_rate')
      .eq('id', 1)
      .maybeSingle();

    let rate = Number(rateRow?.usd_to_egp_rate);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 1000) {
      rate = 55;
    }

    const chargeUsd = Math.round((amountEgp / rate) * 10000) / 10000;
    const cents = Math.round(chargeUsd * 100);
    if (cents < 50) {
      return new Response(JSON.stringify({ error: 'Minimum charge is $0.50' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    });

    const paymentIntent = await stripe.paymentIntents.create({
      amount: cents,
      currency: 'usd',
      metadata: {
        user_id: userId,
        purpose: 'wallet_top_up',
        amount_egp_intent: String(amountEgp),
      },
      automatic_payment_methods: { enabled: true },
    });

    return new Response(
      JSON.stringify({ clientSecret: paymentIntent.client_secret }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    );
  } catch (error: any) {
    console.error('stripe-intent error:', error?.message || error);
    return new Response(
      JSON.stringify({ error: String(error?.message || 'Unknown error') }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      },
    );
  }
});
