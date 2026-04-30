import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import Stripe from 'https://esm.sh/stripe@14.16.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * After Stripe confirmation, activate subscription idempotently using:
 * `activate_subscription_from_payment_service_role(user_id, payment_intent_id, months)`.
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
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
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

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    });
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
    if (pi.metadata?.purpose !== 'executor_subscription') {
      return new Response(JSON.stringify({ error: 'Invalid payment purpose' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const months = Math.floor(Number(pi.metadata?.months ?? 0));
    const ok = months === 1 || months === 12;
    if (!ok) {
      return new Response(JSON.stringify({ error: 'Invalid months metadata' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseService = createClient(supabaseUrl, serviceKey);
    const { data: exp, error: rpcErr } = await supabaseService.rpc(
      'activate_subscription_from_payment_service_role',
      {
        p_user_id: user.id,
        p_payment_intent_id: paymentIntentId,
        p_months: months,
      }
    );
    if (rpcErr) {
      console.error('activate_subscription_from_payment_service_role', rpcErr);
      return new Response(JSON.stringify({ error: rpcErr.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ subscription_expires_at: exp }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('stripe-subscription-activate error:', error?.message || error);
    return new Response(JSON.stringify({ error: String(error?.message || 'Unknown error') }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

