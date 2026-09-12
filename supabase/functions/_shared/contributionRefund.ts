/**
 * P0-3 — refund a paid crowdfunding Checkout Session after apply_stripe_contribution
 * rejects it as a permanent business error (over-budget, not accepting, expired, …).
 *
 * Idempotent: DB PK on session id + Stripe idempotency key `cf-reject-refund:{cs_id}`.
 * Never refunds a session that already has a `contributions` row.
 */
import Stripe from 'https://esm.sh/stripe@14.16.0?target=deno';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';

export type RejectRefundAction = 'proceed' | 'retry' | 'already_done' | 'skip_credited';

export type RejectRefundResult = {
  ok: boolean;
  refunded: boolean;
  skipped?: 'credited' | 'already_done' | 'unpaid';
  refund_id: string | null;
  payment_intent_id: string | null;
  status: string;
  error?: string;
  retryable: boolean;
};

export function isPermanentContributionReject(message: string): boolean {
  const msg = String(message || '');
  return (
    /not accepting contributions/i.test(msg) ||
    /already funded/i.test(msg) ||
    /exceeds remaining/i.test(msg) ||
    /window has expired/i.test(msg) ||
    /target budget is invalid/i.test(msg) ||
    /target budget must be at least/i.test(msg) ||
    /direct-payment only/i.test(msg) ||
    /only for Garbage Removal/i.test(msg) ||
    /Mission not found/i.test(msg) ||
    /Creators cannot contribute/i.test(msg) ||
    /Contribution must be at least/i.test(msg)
  );
}

function paymentIntentIdOf(session: Stripe.Checkout.Session): string {
  const raw = session.payment_intent;
  if (!raw) return '';
  return typeof raw === 'string' ? raw : String(raw.id || '');
}

function refundIdOf(refund: Stripe.Refund | null | undefined): string {
  return refund?.id ? String(refund.id) : '';
}

async function markRefund(
  supabase: SupabaseClient,
  sessionId: string,
  status: string,
  extras: {
    refundId?: string | null;
    paymentIntentId?: string | null;
    errorMessage?: string | null;
  }
): Promise<void> {
  const { error } = await supabase.rpc('mark_contribution_reject_refund', {
    p_stripe_checkout_session_id: sessionId,
    p_status: status,
    p_stripe_refund_id: extras.refundId || null,
    p_stripe_payment_intent_id: extras.paymentIntentId || null,
    p_error_message: extras.errorMessage || null,
  });
  if (error) {
    console.error('[contribution-refund] mark failed', {
      session_id: sessionId,
      status,
      message: error.message,
    });
  }
}

async function notifyContributorRefunded(
  supabase: SupabaseClient,
  contributorId: string | null,
  missionId: string | null,
  amountUsd: number,
  rejectReason: string
): Promise<void> {
  if (!contributorId) return;
  const { error } = await supabase.rpc('create_notification', {
    p_user_id: contributorId,
    p_type: 'contribution_refunded',
    p_mission_id: missionId,
    p_actor_id: null,
    p_title: 'Card refunded',
    p_message: `Your $${amountUsd} contribution could not be applied (${rejectReason}). The charge was refunded automatically.`,
  });
  if (error) {
    console.error('[contribution-refund] notify failed', {
      contributor_id: contributorId,
      mission_id: missionId,
      message: error.message,
    });
  }
}

/**
 * Claim + Stripe.refunds.create for a paid session that apply rejected.
 * Safe to call from confirm and webhook on the same session.
 */
export async function refundRejectedCheckout(input: {
  stripe: Stripe;
  supabaseService: SupabaseClient;
  session: Stripe.Checkout.Session;
  rejectReason: string;
  logLabel: string;
}): Promise<RejectRefundResult> {
  const { stripe, supabaseService, rejectReason, logLabel } = input;
  let session = input.session;
  const sessionId = String(session.id || '').trim();
  const missionId = String(session.metadata?.mission_id || '').trim() || null;
  const contributorId = String(
    session.metadata?.contributor_id || session.client_reference_id || ''
  ).trim() || null;
  const metadataUsd = Math.floor(Number(session.metadata?.amount_usd || 0));
  const paidUsd = Math.floor(Number(session.amount_total || 0) / 100);
  const amountUsd = paidUsd >= 1 ? paidUsd : metadataUsd;

  if (!sessionId) {
    return {
      ok: false,
      refunded: false,
      refund_id: null,
      payment_intent_id: null,
      status: 'failed',
      error: 'Missing Stripe session id',
      retryable: false,
    };
  }

  const { data: claimRaw, error: claimErr } = await supabaseService.rpc(
    'claim_contribution_reject_refund',
    {
      p_stripe_checkout_session_id: sessionId,
      p_mission_id: missionId,
      p_contributor_id: contributorId,
      p_amount_usd: amountUsd,
      p_reject_reason: rejectReason,
    }
  );

  if (claimErr) {
    console.error(`${logLabel} refund claim failed`, {
      session_id: sessionId,
      message: claimErr.message,
    });
    return {
      ok: false,
      refunded: false,
      refund_id: null,
      payment_intent_id: null,
      status: 'failed',
      error: claimErr.message,
      retryable: true,
    };
  }

  const claim = (claimRaw || {}) as {
    action?: RejectRefundAction;
    status?: string;
    stripe_refund_id?: string | null;
    stripe_payment_intent_id?: string | null;
  };
  const action = (claim.action || 'proceed') as RejectRefundAction;

  if (action === 'skip_credited') {
    console.warn(`${logLabel} skip refund — session already credited`, { session_id: sessionId });
    return {
      ok: true,
      refunded: false,
      skipped: 'credited',
      refund_id: null,
      payment_intent_id: claim.stripe_payment_intent_id || null,
      status: 'skip_credited',
      retryable: false,
    };
  }

  if (action === 'already_done') {
    console.log(`${logLabel} refund already recorded`, {
      session_id: sessionId,
      refund_id: claim.stripe_refund_id || null,
      status: claim.status || null,
    });
    return {
      ok: true,
      refunded: true,
      skipped: 'already_done',
      refund_id: claim.stripe_refund_id || null,
      payment_intent_id: claim.stripe_payment_intent_id || null,
      status: String(claim.status || 'refunded'),
      retryable: false,
    };
  }

  if (session.payment_status && session.payment_status !== 'paid') {
    return {
      ok: true,
      refunded: false,
      skipped: 'unpaid',
      refund_id: null,
      payment_intent_id: null,
      status: 'pending',
      retryable: false,
    };
  }

  let paymentIntentId = paymentIntentIdOf(session);
  if (!paymentIntentId) {
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
      paymentIntentId = paymentIntentIdOf(session);
    } catch (err: any) {
      const message = String(err?.message || err);
      await markRefund(supabaseService, sessionId, 'failed', {
        errorMessage: message,
      });
      return {
        ok: false,
        refunded: false,
        refund_id: null,
        payment_intent_id: null,
        status: 'failed',
        error: message,
        retryable: true,
      };
    }
  }

  if (!paymentIntentId) {
    const message = 'Checkout Session has no payment_intent';
    await markRefund(supabaseService, sessionId, 'failed', { errorMessage: message });
    return {
      ok: false,
      refunded: false,
      refund_id: null,
      payment_intent_id: null,
      status: 'failed',
      error: message,
      retryable: true,
    };
  }

  try {
    const existing = await stripe.refunds.list({
      payment_intent: paymentIntentId,
      limit: 10,
    });
    const prior = existing.data.find((r) =>
      ['succeeded', 'pending', 'requires_action'].includes(String(r.status || ''))
    );
    if (prior) {
      await markRefund(supabaseService, sessionId, 'already_refunded', {
        refundId: refundIdOf(prior),
        paymentIntentId,
      });
      console.log(`${logLabel} Stripe already had a refund`, {
        session_id: sessionId,
        refund_id: prior.id,
        status: prior.status,
      });
      return {
        ok: true,
        refunded: true,
        skipped: 'already_done',
        refund_id: refundIdOf(prior),
        payment_intent_id: paymentIntentId,
        status: 'already_refunded',
        retryable: false,
      };
    }

    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        reason: 'requested_by_customer',
        metadata: {
          purpose: 'crowdfunding_reject_refund',
          mission_id: missionId || '',
          contributor_id: contributorId || '',
          checkout_session_id: sessionId,
          reject_reason: String(rejectReason || '').slice(0, 400),
        },
      },
      { idempotencyKey: `cf-reject-refund:${sessionId}` }
    );

    const terminal =
      String(refund.status || '') === 'failed' || String(refund.status || '') === 'canceled'
        ? 'failed'
        : 'refunded';

    if (terminal === 'failed') {
      const message = `Stripe refund status=${refund.status}`;
      await markRefund(supabaseService, sessionId, 'failed', {
        refundId: refundIdOf(refund),
        paymentIntentId,
        errorMessage: message,
      });
      return {
        ok: false,
        refunded: false,
        refund_id: refundIdOf(refund),
        payment_intent_id: paymentIntentId,
        status: 'failed',
        error: message,
        retryable: true,
      };
    }

    await markRefund(supabaseService, sessionId, 'refunded', {
      refundId: refundIdOf(refund),
      paymentIntentId,
    });
    await notifyContributorRefunded(
      supabaseService,
      contributorId,
      missionId,
      amountUsd,
      rejectReason
    );

    console.log(`${logLabel} auto-refund created`, {
      session_id: sessionId,
      mission_id: missionId,
      contributor_id: contributorId,
      amount_usd: amountUsd,
      refund_id: refund.id,
      payment_intent_id: paymentIntentId,
      reject_reason: rejectReason,
    });

    return {
      ok: true,
      refunded: true,
      refund_id: refundIdOf(refund),
      payment_intent_id: paymentIntentId,
      status: 'refunded',
      retryable: false,
    };
  } catch (err: any) {
    const code = String(err?.code || '');
    const message = String(err?.message || err);
    if (code === 'charge_already_refunded' || /already been refunded/i.test(message)) {
      await markRefund(supabaseService, sessionId, 'already_refunded', {
        paymentIntentId,
        errorMessage: null,
      });
      return {
        ok: true,
        refunded: true,
        skipped: 'already_done',
        refund_id: null,
        payment_intent_id: paymentIntentId,
        status: 'already_refunded',
        retryable: false,
      };
    }

    await markRefund(supabaseService, sessionId, 'failed', {
      paymentIntentId,
      errorMessage: message,
    });
    console.error(`${logLabel} Stripe refund failed`, {
      session_id: sessionId,
      payment_intent_id: paymentIntentId,
      code: code || null,
      message,
    });
    return {
      ok: false,
      refunded: false,
      refund_id: null,
      payment_intent_id: paymentIntentId,
      status: 'failed',
      error: message,
      retryable: true,
    };
  }
}
