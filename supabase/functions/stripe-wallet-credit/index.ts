import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^14.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * After client-side Stripe confirmation, credits EGP using:
 * floor(verified_usd_charged * get_usd_to_egp_rate() * 0.97) via RPC (service_role).
 * Never trusts client-supplied EGP amounts.
 */
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');

    if (!supabaseUrl || !anonKey || !serviceKey || !stripeKey) {
      throw new Error('Missing Supabase or Stripe env');
    }

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await supabaseUser.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as { payment_intent_id?: unknown };
    const paymentIntentId =
      typeof body.payment_intent_id === 'string' ? body.payment_intent_id.trim() : '';
    if (!paymentIntentId) {
      return new Response(JSON.stringify({ error: 'Missing payment_intent_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const stripe = new Stripe(stripeKey, { apiVersion: '2022-11-15' });
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (pi.status !== 'succeeded') {
      return new Response(JSON.stringify({ error: 'Payment not succeeded' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const metaUser = pi.metadata?.user_id;
    if (!metaUser || metaUser !== user.id) {
      return new Response(JSON.stringify({ error: 'Payment not for this user' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (pi.metadata?.purpose !== 'wallet_top_up') {
      return new Response(JSON.stringify({ error: 'Invalid payment purpose' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cents = pi.amount_received ?? pi.amount;
    const amountUsd = Number(cents) / 100;
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      return new Response(JSON.stringify({ error: 'Invalid payment amount' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseService = createClient(supabaseUrl, serviceKey);
    const { data: egpCredited, error: rpcErr } = await supabaseService.rpc('credit_wallet_topup_stripe', {
      p_user_id: user.id,
      p_usd_charged: amountUsd,
      p_payment_intent_id: paymentIntentId,
    });

    if (rpcErr) {
      console.error('credit_wallet_topup_stripe', rpcErr);
      return new Response(JSON.stringify({ error: rpcErr.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ egp_credited: egpCredited }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('stripe-wallet-credit error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
