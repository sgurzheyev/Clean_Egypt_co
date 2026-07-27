/**
 * Place / accept mission bids — supports optional tiered offer packages.
 */
import { supabase } from '../../services/supabase';
import {
  normalizeBidOfferPackages,
  packagesToRpcPayload,
  type BidOfferPackage,
} from './bidPackages';

export type MissionBidRow = {
  id: string;
  mission_id: string;
  cleaner_id: string;
  bid_amount: number;
  status: string;
  created_at: string;
  offer_packages?: BidOfferPackage[] | null;
  selected_package_id?: string | null;
  selected_package?: BidOfferPackage | null;
  cleaner?: {
    full_name?: string | null;
    avatar_url?: string | null;
    rating?: number | null;
    telegram_username?: string | null;
  } | null;
};

export function bidWorkerDisplayName(
  bid: MissionBidRow,
  opts?: { unlockContact?: boolean }
): string {
  const c = bid.cleaner;
  if (c?.full_name?.trim()) return c.full_name.trim();
  const unlock =
    opts?.unlockContact ?? String(bid.status || '').toLowerCase() === 'accepted';
  // Hungry-Games: Telegram stays locked until the bid is accepted.
  if (unlock && c?.telegram_username?.trim()) return `@${c.telegram_username.trim()}`;
  return 'Eco Hero';
}

export function rowToMissionBid(row: Record<string, unknown>): MissionBidRow {
  const packages = normalizeBidOfferPackages(row.offer_packages);
  const selected = row.selected_package
    ? normalizeBidOfferPackages([row.selected_package])[0] ?? null
    : null;
  const status = String(row.status || 'pending');
  const cleanerRaw = row.cleaner as MissionBidRow['cleaner'] | MissionBidRow['cleaner'][] | null;
  const cleanerRow = Array.isArray(cleanerRaw) ? cleanerRaw[0] : cleanerRaw;
  const accepted = status.toLowerCase() === 'accepted';
  const cleaner = cleanerRow
    ? {
        full_name: cleanerRow.full_name ?? null,
        avatar_url: cleanerRow.avatar_url ?? null,
        rating: cleanerRow.rating ?? null,
        // Redact Telegram for pending bids (network still may carry it; UI + helpers hide it).
        telegram_username: accepted ? cleanerRow.telegram_username ?? null : null,
      }
    : null;
  return {
    id: String(row.id),
    mission_id: String(row.mission_id),
    cleaner_id: String(row.cleaner_id),
    bid_amount: Number(row.bid_amount) || 0,
    status,
    created_at: String(row.created_at ?? ''),
    offer_packages: packages,
    selected_package_id: row.selected_package_id
      ? String(row.selected_package_id)
      : null,
    selected_package: selected,
    cleaner,
  };
}

/** Place bid via RPC (optional tiered packages; 1-token stake on crowdfunding). */
export async function placeMissionBid(
  missionId: string,
  bidAmountUsd: number,
  offerPackages?: BidOfferPackage[] | null
): Promise<string> {
  const amount = Math.floor(Number(bidAmountUsd));
  if (!Number.isFinite(amount) || amount < 1) {
    throw new Error('Bid amount must be at least 1 USD');
  }
  const packages = offerPackages?.length
    ? packagesToRpcPayload(offerPackages)
    : null;
  const { data, error } = await supabase.rpc('place_mission_bid', {
    p_mission_id: missionId,
    p_bid_amount: amount,
    ...(packages ? { p_offer_packages: packages } : {}),
  });
  if (error) throw error;
  return String(data ?? '');
}

/** Creator accepts a bid, optionally choosing a specific package. */
export async function acceptMissionBid(
  bidId: string,
  packageId?: string | null
): Promise<void> {
  const payload: Record<string, unknown> = { p_bid_id: bidId };
  if (packageId) payload.p_package_id = packageId;
  const { error } = await supabase.rpc('accept_mission_bid', payload);
  if (error) throw error;
}
