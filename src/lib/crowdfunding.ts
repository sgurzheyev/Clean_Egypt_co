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
