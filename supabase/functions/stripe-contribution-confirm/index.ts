import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import Stripe from 'https://esm.sh/stripe@14.16.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * After Stripe Checkout success redirect, verify the session is paid and apply
 * the crowdfunding contribution via service-role RPC (idempotent).
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

    const body = (await req.json()) as { session_id?: unknown };
    const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'Missing session_id' }), {
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

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    });
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      return new Response(JSON.stringify({ error: 'Payment not completed' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const purpose = String(session.metadata?.purpose || '');
    if (purpose !== 'crowdfunding_contribution') {
      return new Response(JSON.stringify({ error: 'Invalid session purpose' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const missionId = String(session.metadata?.mission_id || '');
    const contributorId = String(session.metadata?.contributor_id || session.client_reference_id || '');
    const amountUsd = Math.floor(Number(session.metadata?.amount_usd || 0));

    if (!missionId || amountUsd < 1) {
      return new Response(JSON.stringify({ error: 'Invalid contribution metadata' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (contributorId !== user.id) {
      return new Response(JSON.stringify({ error: 'Session does not belong to this user' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseService = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error: rpcErr } = await supabaseService.rpc('apply_stripe_contribution', {
      p_mission_id: missionId,
      p_contributor_id: user.id,
      p_amount_usd: amountUsd,
      p_stripe_checkout_session_id: sessionId,
    });

    if (rpcErr) {
      console.error('apply_stripe_contribution', rpcErr);
      return new Response(JSON.stringify({ error: rpcErr.message || 'Contribution RPC failed' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const row = (data || {}) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        mission_id: String(row.mission_id ?? missionId),
        amount_usd: Number(row.amount_usd ?? amountUsd),
        current_funding: Number(row.current_funding ?? 0),
        target_budget: Number(row.target_budget ?? 0),
        opened_for_bidding: !!row.opened_for_bidding,
        idempotent: !!row.idempotent,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('stripe-contribution-confirm error:', error?.message || error);
    return new Response(JSON.stringify({ error: String(error?.message || 'Unknown error') }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
