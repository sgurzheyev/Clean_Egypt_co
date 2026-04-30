import Stripe from 'https://esm.sh/stripe@14.16.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // 1. Обработка CORS (нужна для мобильных устройств)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
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
    const plan_usd = Number(body.plan_usd ?? 0);
    const plan_months = Math.floor(Number(body.plan_months ?? 0));

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(), // Критично для Deno!
    });

    // 2. Создание платежа в Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.floor(plan_usd * 100), // Конвертируем доллары в центы
      currency: 'usd',
      metadata: {
        user_id,
        months: String(plan_months),
        type: 'subscription',
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