/**
 * Crowdfunding is exclusive to Garbage Removal services.
 * All other services stay on the Direct Payment / bid flow.
 */
import type { ServiceType } from './serviceSectors';

export const GARBAGE_REMOVAL_SERVICES: readonly ServiceType[] = [
  'junk_removal',
  'beach_street_cleanup',
] as const;

export function isGarbageRemovalService(
  serviceType: string | null | undefined
): boolean {
  return GARBAGE_REMOVAL_SERVICES.includes(serviceType as ServiceType);
}

export function isCrowdfundingMission(mission: {
  crowdfunding_mode?: boolean | null;
  service_type?: string | null;
}): boolean {
  return (
    !!mission.crowdfunding_mode &&
    isGarbageRemovalService(mission.service_type)
  );
}

/** Map / feed: crowd campaign pin (mode flag or live funding status). */
export function isCrowdfundingPin(mission: {
  crowdfunding_mode?: boolean | null;
  status?: string | null;
}): boolean {
  if (mission.crowdfunding_mode) return true;
  return String(mission.status ?? '').toLowerCase() === 'funding';
}

/** USD still needed to hit the campaign goal. Null if not a live underfunded crowd pin. */
export function crowdfundingRemainingUsd(mission: {
  crowdfunding_mode?: boolean | null;
  status?: string | null;
  expected_price?: number | null;
  amount_target?: number | null;
  current_funding?: number | null;
}): number | null {
  if (!isCrowdfundingPin(mission)) return null;
  if (String(mission.status ?? '').toLowerCase() !== 'funding') return null;
  const target = Math.max(
    0,
    Math.floor(Number(mission.expected_price ?? mission.amount_target ?? 0))
  );
  const raised = Math.max(0, Math.floor(Number(mission.current_funding ?? 0)));
  const remaining = Math.max(0, target - raised);
  return remaining > 0 ? remaining : null;
}

/** Feed / profile callout: locked-cleaner copy vs generic “Needs $X more”. */
export function crowdfundingFeedCallout(mission: {
  crowdfunding_mode?: boolean | null;
  status?: string | null;
  expected_price?: number | null;
  amount_target?: number | null;
  current_funding?: number | null;
  cleaner_id?: string | null;
}): { kind: 'locked' | 'needs_more'; remaining: number } | null {
  const remaining = crowdfundingRemainingUsd(mission);
  if (remaining == null) return null;
  if (mission.cleaner_id) return { kind: 'locked', remaining };
  return { kind: 'needs_more', remaining };
}

/** True while the mission is still raising contributions (not yet open for bids). */
export function isCrowdfundingOpen(mission: {
  crowdfunding_mode?: boolean | null;
  service_type?: string | null;
  status?: string | null;
}): boolean {
  return (
    isCrowdfundingMission(mission) &&
    String(mission.status ?? '').toLowerCase() === 'funding'
  );
}

/** Effective funding deadline (crowdfunding_expires_at, else created_at + 7d).
 * Create = +7d; each successful contribution sets GREATEST(expires, now+30d) in DB.
 */
export function getCrowdfundingExpiresAt(mission: {
  crowdfunding_expires_at?: string | null;
  created_at?: string | null;
}): Date | null {
  const raw = mission.crowdfunding_expires_at;
  if (raw) {
    const d = new Date(raw);
    if (Number.isFinite(d.getTime())) return d;
  }
  if (mission.created_at) {
    const created = new Date(mission.created_at);
    if (Number.isFinite(created.getTime())) {
      return new Date(created.getTime() + 7 * 24 * 60 * 60 * 1000);
    }
  }
  return null;
}

export type CrowdfundingCountdownParts = {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  expired: boolean;
};

export function getCrowdfundingCountdownParts(
  expiresAt: Date | null,
  nowMs: number = Date.now()
): CrowdfundingCountdownParts | null {
  if (!expiresAt || !Number.isFinite(expiresAt.getTime()) || !Number.isFinite(nowMs)) {
    return null;
  }
  const totalMs = expiresAt.getTime() - nowMs;
  if (!Number.isFinite(totalMs) || totalMs <= 0) {
    return { totalMs: 0, days: 0, hours: 0, minutes: 0, expired: true };
  }
  const days = Math.floor(totalMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((totalMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((totalMs % (60 * 60 * 1000)) / (60 * 1000));
  return { totalMs, days, hours, minutes, expired: false };
}

/** Compact label: "2d 4h" / "4h 12m" / "12m" / "30d 0h" after timer extension. */
export function formatCrowdfundingCountdownCompact(
  parts: CrowdfundingCountdownParts | null
): string {
  if (!parts) return '';
  if (parts.expired) return '0h';
  const days = Number.isFinite(parts.days) ? parts.days : 0;
  const hours = Number.isFinite(parts.hours) ? parts.hours : 0;
  const minutes = Number.isFinite(parts.minutes) ? parts.minutes : 0;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}
