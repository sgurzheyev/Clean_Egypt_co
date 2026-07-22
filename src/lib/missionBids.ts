import { supabase } from '../../services/supabase';

export type MissionBidRow = {
  id: string;
  mission_id: string;
  cleaner_id: string;
  bid_amount: number;
  status: string;
  created_at: string;
  cleaner?: {
    full_name?: string | null;
    avatar_url?: string | null;
    rating?: number | null;
    telegram_username?: string | null;
  } | null;
};

export function bidWorkerDisplayName(bid: MissionBidRow): string {
  const c = bid.cleaner;
  if (c?.full_name?.trim()) return c.full_name.trim();
  if (c?.telegram_username?.trim()) return `@${c.telegram_username.trim()}`;
  return 'Eco Hero';
}

/** Place bid via RPC (crowdfunding funding allowed; 1-token stake on crowdfunding). */
export async function placeMissionBid(
  missionId: string,
  bidAmountUsd: number
): Promise<string> {
  const amount = Math.floor(Number(bidAmountUsd));
  if (!Number.isFinite(amount) || amount < 1) {
    throw new Error('Bid amount must be at least 1 USD');
  }
  const { data, error } = await supabase.rpc('place_mission_bid', {
    p_mission_id: missionId,
    p_bid_amount: amount,
  });
  if (error) throw error;
  return String(data ?? '');
}
