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
