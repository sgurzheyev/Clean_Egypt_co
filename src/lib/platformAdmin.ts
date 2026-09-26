import { useEffect, useState } from 'react';
import { supabase } from '../../services/supabase';

/**
 * Browser gate for admin UI. The server function is the source of truth
 * (platform_admins / founder email / profiles.role). Do not hardcode identities here.
 */
export function useIsPlatformAdmin(userId: string | null | undefined): boolean {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setAllowed(false);
      return;
    }
    (async () => {
      const { data, error } = await supabase.rpc('is_platform_admin', { p_uid: userId });
      if (!cancelled) setAllowed(!error && data === true);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return allowed;
}

/** Worker Orders — still in flight (P2P review + crowd awaiting_approval). */
export const WORKER_ACTIVE_STATUSES = [
  'in_progress',
  'review',
  'pending_approval',
  'awaiting_approval',
] as const;

/** Profile History — P2P close + crowd success + rare/legacy failed. */
export const WORKER_HISTORY_STATUSES = [
  'completed',
  'finished',
  'approved',
  'failed',
] as const;

export const WORKER_PROFILE_STATUSES = [
  ...WORKER_ACTIVE_STATUSES,
  ...WORKER_HISTORY_STATUSES,
] as const;

export function isWorkerActiveMissionStatus(
  status: string | null | undefined
): boolean {
  const s = String(status ?? '').toLowerCase();
  return (WORKER_ACTIVE_STATUSES as readonly string[]).includes(s);
}

export function isArchivedMissionStatus(status: string | null | undefined): boolean {
  const s = String(status ?? '').toLowerCase();
  return (WORKER_HISTORY_STATUSES as readonly string[]).includes(s);
}
