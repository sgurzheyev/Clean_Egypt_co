import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import Stripe from 'https://esm.sh/stripe@14.16.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  // 1. Обработка CORS (нужна для мобильных устройств)
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
      plan_months?: unknown;
    };
    const user_id = String(body.user_id ?? '');
    const plan_usd = Math.floor(Number(body.plan_usd ?? 0));
    const plan_months = Math.floor(Number(body.plan_months ?? 0));

    if (!user_id) {
      return new Response(JSON.stringify({ error: 'Missing user_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const planOk =
      (plan_usd === 1 && plan_months === 1) ||
      (plan_usd === 10 && plan_months === 12);
    if (!planOk) {
      return new Response(JSON.stringify({ error: 'Invalid plan' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify caller matches the provided user_id (zero-trust).
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

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(), // Критично для Deno!
    });

    // 2. Создание платежа в Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: plan_usd * 100, // доллары → центы
      currency: 'usd',
      metadata: {
        user_id,
        months: String(plan_months),
        purpose: 'executor_subscription',
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