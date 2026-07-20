import { supabase } from '../../services/supabase';
import { resolveAccessToken } from './supabaseAuth';
import { throwIfInvokeFailed } from './supabaseFunctionError';

export type ContributionResult = {
  mission_id: string;
  amount_usd: number;
  current_funding: number;
  target_budget: number;
  opened_for_bidding: boolean;
  idempotent?: boolean;
};

/** Start Stripe Checkout for a crowdfunding contribution (redirects to session.url). */
export async function startContributionCheckout(input: {
  missionId: string;
  amountUsd: number;
  successUrl: string;
  cancelUrl?: string;
}): Promise<{ url: string; sessionId: string }> {
  const accessToken = await resolveAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated');
  }

  const res = await supabase.functions.invoke('stripe-contribution-checkout', {
    body: {
      mission_id: input.missionId,
      amount_usd: Math.floor(input.amountUsd),
      success_url: input.successUrl,
      cancel_url: input.cancelUrl || input.successUrl,
    },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  throwIfInvokeFailed('stripe-contribution-checkout', res);

  const url = String(res.data?.url || '');
  const sessionId = String(res.data?.sessionId || '');
  if (!url) throw new Error('Stripe Checkout URL missing');
  return { url, sessionId };
}

/**
 * After Stripe Checkout redirect, verify payment and apply contribution via
 * service-role RPC (idempotent on session id).
 */
export async function confirmContributionCheckout(
  sessionId: string
): Promise<ContributionResult> {
  const accessToken = await resolveAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated');
  }

  const res = await supabase.functions.invoke('stripe-contribution-confirm', {
    body: { session_id: sessionId },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  throwIfInvokeFailed('stripe-contribution-confirm', res);
  const row = (res.data || {}) as ContributionResult;
  return {
    mission_id: String(row.mission_id ?? ''),
    amount_usd: Number(row.amount_usd ?? 0),
    current_funding: Number(row.current_funding ?? 0),
    target_budget: Number(row.target_budget ?? 0),
    opened_for_bidding: !!row.opened_for_bidding,
    idempotent: !!row.idempotent,
  };
}

/** Direct RPC path removed — crowdfunding must go through Stripe Checkout. */
export async function contributeToMission(
  _missionId: string,
  _amountUsd: number
): Promise<ContributionResult> {
  throw new Error(
    'Direct contribute_to_mission is disabled. Use startContributionCheckout / confirmContributionCheckout.'
  );
}
