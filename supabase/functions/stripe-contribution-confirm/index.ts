import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import Stripe from 'https://esm.sh/stripe@14.16.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  console.error('[stripe-contribution-confirm]', message, extra || '');
  return new Response(JSON.stringify({ error: message, ...(extra || {}) }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

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
      return jsonError('Missing Authorization', 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');

    if (!supabaseUrl) {
      return jsonError('Missing SUPABASE_URL env', 500);
    }
    if (!anonKey) {
      return jsonError('Missing SUPABASE_ANON_KEY env', 500);
    }
    if (!serviceKey) {
      return jsonError('Missing SUPABASE_SERVICE_ROLE_KEY env', 500);
    }
    if (!stripeKey) {
      return jsonError('Missing STRIPE_SECRET_KEY env', 500);
    }

    let body: { session_id?: unknown };
    try {
      body = (await req.json()) as { session_id?: unknown };
    } catch (e: any) {
      return jsonError('Invalid JSON body', 400, { detail: String(e?.message || e) });
    }

    const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
    if (!sessionId) {
      return jsonError('Missing session_id', 400);
    }

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await supabaseUser.auth.getUser();
    if (userErr || !user) {
      return jsonError('Unauthorized', 401, {
        detail: userErr?.message || 'No user from JWT',
      });
    }

    let session;
    try {
      const stripe = new Stripe(stripeKey, {
        apiVersion: '2023-10-16',
        httpClient: Stripe.createFetchHttpClient(),
      });
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch (e: any) {
      return jsonError('Stripe session retrieve failed', 400, {
        detail: String(e?.message || e),
        session_id: sessionId,
      });
    }

    if (session.payment_status !== 'paid') {
      return jsonError('Payment not completed', 400, {
        payment_status: session.payment_status,
        session_id: sessionId,
      });
    }

    const purpose = String(session.metadata?.purpose || '');
    if (purpose !== 'crowdfunding_contribution') {
      return jsonError('Invalid session purpose', 400, {
        purpose: purpose || null,
        session_id: sessionId,
      });
    }

    const missionId = String(session.metadata?.mission_id || '');
    const contributorId = String(
      session.metadata?.contributor_id || session.client_reference_id || ''
    );
    const metadataUsd = Math.floor(Number(session.metadata?.amount_usd || 0));
    const paidUsd = Math.floor(Number(session.amount_total || 0) / 100);
    // Prefer charged Stripe amount; metadata must agree when present.
    const amountUsd = paidUsd >= 1 ? paidUsd : metadataUsd;

    if (!missionId || amountUsd < 1) {
      return jsonError('Invalid contribution metadata', 400, {
        mission_id: missionId || null,
        amount_usd: amountUsd,
        paid_usd: paidUsd,
        metadata_usd: metadataUsd,
        metadata: session.metadata || null,
      });
    }

    if (metadataUsd >= 1 && paidUsd >= 1 && metadataUsd !== paidUsd) {
      return jsonError('Amount mismatch between Stripe charge and metadata', 400, {
        paid_usd: paidUsd,
        metadata_usd: metadataUsd,
        session_id: sessionId,
      });
    }

    if (contributorId !== user.id) {
      return jsonError('Session does not belong to this user', 403, {
        contributor_id: contributorId,
        user_id: user.id,
      });
    }

    // Service role bypasses RLS for contributions insert + mission funding update.
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
      return jsonError(rpcErr.message || 'Contribution RPC failed', 400, {
        code: rpcErr.code || null,
        details: rpcErr.details || null,
        hint: rpcErr.hint || null,
        mission_id: missionId,
        amount_usd: amountUsd,
        session_id: sessionId,
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
    console.error('[stripe-contribution-confirm] unhandled', error);
    return jsonError(String(error?.message || 'Unknown error'), 500, {
      stack: typeof error?.stack === 'string' ? error.stack.slice(0, 500) : null,
    });
  }
});
