/** Matches server-side admin checks (trigger + admin_delete_mission RPC). */
export function isPlatformAdmin(input: {
  email?: string | null;
  telegramUsername?: string | null;
  role?: string | null;
}): boolean {
  if (String(input.role ?? '').toLowerCase() === 'admin') return true;
  const email = String(input.email ?? '').toLowerCase();
  if (email === 'sgurzheyev@gmail.com' || email.includes('tg_6618910143')) return true;
  return String(input.telegramUsername ?? '').toLowerCase() === 'sergiogurgini';
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
