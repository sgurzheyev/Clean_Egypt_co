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

/** Effective funding deadline (crowdfunding_expires_at, else created_at + 7d). */
export function getCrowdfundingExpiresAt(mission: {
  crowdfunding_expires_at?: string | null;
  created_at?: string | null;
}): Date | null {
  const raw = mission.crowdfunding_expires_at;
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (mission.created_at) {
    const created = new Date(mission.created_at);
    if (!Number.isNaN(created.getTime())) {
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
  if (!expiresAt) return null;
  const totalMs = expiresAt.getTime() - nowMs;
  if (totalMs <= 0) {
    return { totalMs: 0, days: 0, hours: 0, minutes: 0, expired: true };
  }
  const days = Math.floor(totalMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((totalMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((totalMs % (60 * 60 * 1000)) / (60 * 1000));
  return { totalMs, days, hours, minutes, expired: false };
}

/** Compact label: "2d 4h" / "4h 12m" / "12m". */
export function formatCrowdfundingCountdownCompact(
  parts: CrowdfundingCountdownParts | null
): string {
  if (!parts) return '';
  if (parts.expired) return '0h';
  if (parts.days > 0) return `${parts.days}d ${parts.hours}h`;
  if (parts.hours > 0) return `${parts.hours}h ${parts.minutes}m`;
  return `${Math.max(1, parts.minutes)}m`;
}
