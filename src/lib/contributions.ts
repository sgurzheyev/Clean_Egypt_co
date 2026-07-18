import { supabase } from '../../services/supabase';

export type ContributionResult = {
  mission_id: string;
  amount_usd: number;
  current_funding: number;
  target_budget: number;
  opened_for_bidding: boolean;
  idempotent?: boolean;
};

function throwIfInvokeFailed(name: string, res: { data: any; error: any }) {
  if (res.error) {
    const msg =
      res.error.message ||
      res.data?.error ||
      `Edge function ${name} failed`;
    throw new Error(msg);
  }
  if (res.data?.error) {
    throw new Error(String(res.data.error));
  }
}

/** Start Stripe Checkout for a crowdfunding contribution (redirects to session.url). */
export async function startContributionCheckout(input: {
  missionId: string;
  amountUsd: number;
  successUrl: string;
  cancelUrl?: string;
}): Promise<{ url: string; sessionId: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not authenticated');
  }

  const res = await supabase.functions.invoke('stripe-contribution-checkout', {
    body: {
      mission_id: input.missionId,
      amount_usd: Math.floor(input.amountUsd),
      success_url: input.successUrl,
      cancel_url: input.cancelUrl || input.successUrl,
    },
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
  const res = await supabase.functions.invoke('stripe-contribution-confirm', {
    body: { session_id: sessionId },
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

/** Direct RPC path (no Stripe) — kept for admin/tools; UI uses Checkout. */
export async function contributeToMission(
  missionId: string,
  amountUsd: number
): Promise<ContributionResult> {
  const { data, error } = await supabase.rpc('contribute_to_mission', {
    p_mission_id: missionId,
    p_amount_usd: Math.floor(amountUsd),
  });
  if (error) throw error;
  const row = (data || {}) as ContributionResult;
  return {
    mission_id: String(row.mission_id ?? missionId),
    amount_usd: Number(row.amount_usd ?? amountUsd),
    current_funding: Number(row.current_funding ?? 0),
    target_budget: Number(row.target_budget ?? 0),
    opened_for_bidding: !!row.opened_for_bidding,
  };
}
