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

export function isArchivedMissionStatus(status: string | null | undefined): boolean {
  const s = String(status ?? '').toLowerCase();
  return s === 'finished' || s === 'completed';
}
