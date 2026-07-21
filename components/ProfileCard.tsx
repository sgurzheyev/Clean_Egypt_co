/**
 * Reusable social-style profile card (Facebook/LinkedIn vibe).
 * Header band + overlapping avatar, verification badge, rating, stat counters,
 * and an actions row. Used for public profiles, admin user deep-dive, and
 * client/user previews so they read as rich cards instead of text lines.
 */
import React from 'react';
import { BadgeCheck, Star } from 'lucide-react';

export type ProfileCardStat = {
  label: string;
  value: React.ReactNode;
  /** Optional tailwind text-color class for the value, e.g. "text-orange-400". */
  accent?: string;
};

export type ProfileCardAccent = 'cyan' | 'emerald' | 'orange' | 'amber';

const ACCENT: Record<
  ProfileCardAccent,
  { ring: string; band: string; badge: string; initial: string }
> = {
  cyan: {
    ring: 'border-cyan-400/40',
    band: 'from-cyan-500/25 via-cyan-500/10 to-transparent',
    badge: 'text-cyan-300',
    initial: 'text-cyan-200',
  },
  emerald: {
    ring: 'border-emerald-400/40',
    band: 'from-emerald-500/25 via-emerald-500/10 to-transparent',
    badge: 'text-emerald-300',
    initial: 'text-emerald-200',
  },
  orange: {
    ring: 'border-orange-400/40',
    band: 'from-orange-500/25 via-orange-500/10 to-transparent',
    badge: 'text-orange-300',
    initial: 'text-orange-200',
  },
  amber: {
    ring: 'border-amber-400/40',
    band: 'from-amber-500/25 via-amber-500/10 to-transparent',
    badge: 'text-amber-300',
    initial: 'text-amber-200',
  },
};

export interface ProfileCardProps {
  name: string;
  avatarUrl?: string | null;
  handle?: string | null;
  subtitle?: React.ReactNode;
  isVerified?: boolean;
  rating?: number | null;
  reviewCount?: number | null;
  stats?: ProfileCardStat[];
  /** Extra pill badges shown under the name (e.g. Banned, Role). */
  badges?: React.ReactNode;
  /** Action buttons row rendered at the bottom of the card. */
  actions?: React.ReactNode;
  accent?: ProfileCardAccent;
  onAvatarClick?: () => void;
  className?: string;
}

const ProfileCard: React.FC<ProfileCardProps> = ({
  name,
  avatarUrl,
  handle,
  subtitle,
  isVerified = false,
  rating,
  reviewCount,
  stats = [],
  badges,
  actions,
  accent = 'cyan',
  onAvatarClick,
  className = '',
}) => {
  const theme = ACCENT[accent];
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const hasRating = typeof rating === 'number' && rating > 0;

  const AvatarInner = (
    <span
      className={`relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 ${theme.ring} bg-slate-900 shadow-[0_6px_20px_rgba(0,0,0,0.45)]`}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" draggable={false} className="h-full w-full object-cover" />
      ) : (
        <span className={`text-2xl font-black ${theme.initial}`}>{initial}</span>
      )}
    </span>
  );

  return (
    <article
      className={`relative overflow-hidden rounded-3xl border border-white/10 bg-slate-950/80 shadow-[0_8px_32px_rgba(0,0,0,0.35)] ${className}`}
    >
      <div className={`h-16 w-full bg-gradient-to-b ${theme.band}`} aria-hidden />

      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        <div className="-mt-10 flex items-end gap-3">
          {onAvatarClick ? (
            <button
              type="button"
              onClick={onAvatarClick}
              className="rounded-full transition-transform active:scale-95"
              aria-label={name}
            >
              {AvatarInner}
            </button>
          ) : (
            AvatarInner
          )}

          <div className="min-w-0 flex-1 pb-1">
            <div className="flex items-center gap-1.5">
              <h3 className="truncate text-base font-extrabold tracking-tight text-white sm:text-lg">
                {name}
              </h3>
              {isVerified && (
                <BadgeCheck className={`h-4 w-4 shrink-0 ${theme.badge}`} strokeWidth={2.5} aria-label="Verified" />
              )}
            </div>
            {handle && <p className="truncate text-xs font-medium text-slate-400">{handle}</p>}
            {hasRating && (
              <div className="mt-0.5 flex items-center gap-1">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" strokeWidth={2} />
                <span className="text-xs font-bold text-amber-200">{Number(rating).toFixed(1)}</span>
                {typeof reviewCount === 'number' && reviewCount > 0 && (
                  <span className="text-[11px] text-slate-500">({reviewCount})</span>
                )}
              </div>
            )}
          </div>
        </div>

        {subtitle && <div className="mt-2 text-[11px] leading-snug text-slate-400">{subtitle}</div>}

        {badges && <div className="mt-2 flex flex-wrap gap-1.5">{badges}</div>}

        {stats.length > 0 && (
          <div
            className="mt-4 grid gap-2"
            style={{ gridTemplateColumns: `repeat(${Math.min(stats.length, 3)}, minmax(0, 1fr))` }}
          >
            {stats.map((s, i) => (
              <div
                key={`${s.label}-${i}`}
                className="rounded-2xl border border-white/8 bg-white/[0.03] px-2.5 py-2 text-center"
              >
                <p className={`text-lg font-black leading-none ${s.accent || 'text-slate-100'}`}>
                  {s.value}
                </p>
                <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        )}

        {actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </article>
  );
};

export default ProfileCard;
