import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import Stripe from 'https://esm.sh/stripe@14.16.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, stripe-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * Stripe webhook — closes the "paid but never confirmed" gap for crowdfunding.
 *
 * Listens for `checkout.session.completed`, verifies the Stripe signature, then
 * calls the same service-role RPC as `stripe-contribution-confirm`:
 *   apply_stripe_contribution (idempotent on stripe_checkout_session_id).
 *
 * Token / subscription / wallet packs use PaymentIntents + client credit edges,
 * not Checkout Sessions — those purposes are acknowledged and ignored here.
 *
 * Deploy with verify_jwt=false (Stripe has no Supabase JWT). See config.toml.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!stripeKey || !webhookSecret || !supabaseUrl || !serviceKey) {
    console.error('[stripe-webhook] missing env', {
      stripeKey: !!stripeKey,
      webhookSecret: !!webhookSecret,
      supabaseUrl: !!supabaseUrl,
      serviceKey: !!serviceKey,
    });
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const signature = req.headers.get('stripe-signature') || req.headers.get('Stripe-Signature');
  if (!signature) {
    return new Response(JSON.stringify({ error: 'Missing stripe-signature' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Raw body required for signature verification — do NOT parse JSON first.
  const rawBody = await req.text();

  const stripe = new Stripe(stripeKey, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  });
  const cryptoProvider = Stripe.createSubtleCryptoProvider();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
      undefined,
      cryptoProvider
    );
  } catch (err: any) {
    console.error('[stripe-webhook] signature verification failed', err?.message || err);
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Only Checkout Sessions matter for crowdfunding; other event types → ack.
  if (event.type !== 'checkout.session.completed') {
    return new Response(JSON.stringify({ received: true, ignored: event.type }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const purpose = String(session.metadata?.purpose || '');

  // Non-crowdfunding Checkout (if any) — acknowledge so Stripe stops retrying.
  if (purpose !== 'crowdfunding_contribution') {
    console.log('[stripe-webhook] ignoring checkout purpose', {
      purpose: purpose || null,
      session_id: session.id,
    });
    return new Response(
      JSON.stringify({ received: true, ignored: true, purpose: purpose || null }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  if (session.payment_status && session.payment_status !== 'paid') {
    console.warn('[stripe-webhook] session not paid yet', {
      session_id: session.id,
      payment_status: session.payment_status,
    });
    // Retry later — unpaid completed events are unusual but possible.
    return new Response(JSON.stringify({ error: 'Payment not completed' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const missionId = String(session.metadata?.mission_id || '').trim();
  const contributorId = String(
    session.metadata?.contributor_id || session.client_reference_id || ''
  ).trim();
  const metadataUsd = Math.floor(Number(session.metadata?.amount_usd || 0));
  const paidUsd = Math.floor(Number(session.amount_total || 0) / 100);
  const amountUsd = paidUsd >= 1 ? paidUsd : metadataUsd;

  if (!missionId || !contributorId || amountUsd < 1) {
    console.error('[stripe-webhook] invalid crowdfunding metadata', {
      session_id: session.id,
      mission_id: missionId || null,
      contributor_id: contributorId || null,
      amount_usd: amountUsd,
      paid_usd: paidUsd,
      metadata_usd: metadataUsd,
    });
    // 200 — bad metadata will never self-heal; avoid infinite Stripe retries.
    return new Response(
      JSON.stringify({ received: true, applied: false, reason: 'invalid_metadata' }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  if (metadataUsd >= 1 && paidUsd >= 1 && metadataUsd !== paidUsd) {
    console.error('[stripe-webhook] amount mismatch', {
      session_id: session.id,
      paid_usd: paidUsd,
      metadata_usd: metadataUsd,
    });
    return new Response(
      JSON.stringify({ received: true, applied: false, reason: 'amount_mismatch' }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  const supabaseService = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error: rpcErr } = await supabaseService.rpc('apply_stripe_contribution', {
    p_mission_id: missionId,
    p_contributor_id: contributorId,
    p_amount_usd: amountUsd,
    p_stripe_checkout_session_id: session.id,
  });

  if (rpcErr) {
    const msg = String(rpcErr.message || '');
    // Business rejects (already funded / expired / exceeds remaining): ack 200
    // so Stripe does not retry forever. Money may need manual refund ops.
    const permanent =
      /not accepting contributions/i.test(msg) ||
      /already funded/i.test(msg) ||
      /exceeds remaining/i.test(msg) ||
      /window has expired/i.test(msg) ||
      /target budget is invalid/i.test(msg) ||
      /direct-payment only/i.test(msg) ||
      /only for Garbage Removal/i.test(msg);

    console.error('[stripe-webhook] apply_stripe_contribution failed', {
      session_id: session.id,
      mission_id: missionId,
      contributor_id: contributorId,
      amount_usd: amountUsd,
      code: rpcErr.code || null,
      message: msg,
      permanent,
    });

    if (permanent) {
      return new Response(
        JSON.stringify({
          received: true,
          applied: false,
          reason: 'business_reject',
          error: msg,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Transient / unknown — ask Stripe to retry.
    return new Response(JSON.stringify({ error: msg || 'Contribution RPC failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const row = (data || {}) as Record<string, unknown>;
  console.log('[stripe-webhook] contribution applied', {
    session_id: session.id,
    mission_id: String(row.mission_id ?? missionId),
    amount_usd: Number(row.amount_usd ?? amountUsd),
    current_funding: Number(row.current_funding ?? 0),
    opened_for_bidding: !!row.opened_for_bidding,
    crowdfunding_expires_at: row.crowdfunding_expires_at ?? null,
    started_work: !!row.started_work,
    idempotent: !!row.idempotent,
  });

  return new Response(
    JSON.stringify({
      received: true,
      applied: true,
      mission_id: String(row.mission_id ?? missionId),
      amount_usd: Number(row.amount_usd ?? amountUsd),
      current_funding: Number(row.current_funding ?? 0),
      target_budget: Number(row.target_budget ?? 0),
      opened_for_bidding: !!row.opened_for_bidding,
      crowdfunding_expires_at: row.crowdfunding_expires_at ?? null,
      started_work: !!row.started_work,
      idempotent: !!row.idempotent,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
});
