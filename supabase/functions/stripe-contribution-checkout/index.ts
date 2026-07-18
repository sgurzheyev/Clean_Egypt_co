import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import Stripe from 'https://esm.sh/stripe@14.16.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * Creates a Stripe Checkout Session for a Garbage Removal crowdfunding contribution.
 * Amount is USD (whole dollars). Stripe charges amount_usd * 100 cents.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!stripeKey || !supabaseUrl || !anonKey) {
      throw new Error('Missing Stripe or Supabase env');
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as {
      mission_id?: unknown;
      amount_usd?: unknown;
      success_url?: unknown;
      cancel_url?: unknown;
    };

    const missionId = typeof body.mission_id === 'string' ? body.mission_id.trim() : '';
    const amountUsd = Math.floor(Number(body.amount_usd));
    const successUrl =
      typeof body.success_url === 'string' && body.success_url.trim().length > 0
        ? body.success_url.trim()
        : '';
    const cancelUrl =
      typeof body.cancel_url === 'string' && body.cancel_url.trim().length > 0
        ? body.cancel_url.trim()
        : successUrl;

    if (!missionId || amountUsd < 1 || !successUrl) {
      return new Response(JSON.stringify({ error: 'Invalid mission_id, amount_usd, or success_url' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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

    const { data: mission, error: missionErr } = await supabaseUser
      .from('missions')
      .select('id, status, crowdfunding_mode, service_type, expected_price, creator_id')
      .eq('id', missionId)
      .maybeSingle();

    if (missionErr || !mission) {
      return new Response(JSON.stringify({ error: 'Mission not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!mission.crowdfunding_mode) {
      return new Response(JSON.stringify({ error: 'Mission is not in crowdfunding mode' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const serviceType = String(mission.service_type || '').toLowerCase();
    if (serviceType !== 'junk_removal' && serviceType !== 'beach_street_cleanup') {
      return new Response(JSON.stringify({ error: 'Crowdfunding only for Garbage Removal' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (String(mission.status || '').toLowerCase() !== 'funding') {
      return new Response(JSON.stringify({ error: 'Mission is not accepting contributions' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (mission.creator_id && mission.creator_id === user.id) {
      return new Response(JSON.stringify({ error: 'Creators cannot contribute to their own campaign' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const amountCents = Math.max(50, amountUsd * 100);

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    });

    const sep = successUrl.includes('?') ? '&' : '?';
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: `${successUrl}${sep}cf_contribution=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      client_reference_id: user.id,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: amountCents,
            product_data: {
              name: 'CleanEgypt crowdfunding contribution',
              description: `Garbage Removal contribution · $${amountUsd}`,
            },
          },
        },
      ],
      metadata: {
        purpose: 'crowdfunding_contribution',
        mission_id: missionId,
        contributor_id: user.id,
        amount_usd: String(amountUsd),
      },
      payment_intent_data: {
        metadata: {
          purpose: 'crowdfunding_contribution',
          mission_id: missionId,
          contributor_id: user.id,
          amount_usd: String(amountUsd),
        },
      },
    });

    if (!session.url) {
      throw new Error('Stripe Checkout Session missing url');
    }

    return new Response(
      JSON.stringify({
        url: session.url,
        sessionId: session.id,
        amountUsd,
        amountCents,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('stripe-contribution-checkout error:', error?.message || error);
    return new Response(JSON.stringify({ error: String(error?.message || 'Unknown error') }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
