/**
 * $0 free garbage pins live 7 days from crowdfunding_expires_at
 * (or created_at when the clock was not stamped). Any Stripe contribution
 * that raises current_funding keeps the pin, and apply_stripe_contribution
 * moves the clock to at least now()+30 days.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const FREE_GARBAGE_PIN_LIFE_MS = 7 * DAY_MS;

export function freeGarbagePinExpired(
  mission: {
    is_report?: boolean | null;
    status?: string | null;
    current_funding?: number | null;
    created_at?: string | null;
    crowdfunding_expires_at?: string | null;
  },
  now = Date.now()
): boolean {
  const status = String(mission.status || '').toLowerCase();
  const report = !!mission.is_report || status === 'reported';
  if (!report) return false;
  if (Number(mission.current_funding || 0) > 0) return false;
  if (status === 'hidden' || status === 'archived' || status === 'expired') return false;

  const explicit = mission.crowdfunding_expires_at
    ? Date.parse(mission.crowdfunding_expires_at)
    : NaN;
  const created = mission.created_at ? Date.parse(mission.created_at) : NaN;
  const deadline = Number.isFinite(explicit)
    ? explicit
    : Number.isFinite(created)
      ? created + FREE_GARBAGE_PIN_LIFE_MS
      : NaN;
  if (!Number.isFinite(deadline)) return false;
  return deadline <= now;
}
