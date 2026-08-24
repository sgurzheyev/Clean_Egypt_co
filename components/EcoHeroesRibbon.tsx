/**
 * Eco-Ego supporter ribbon — overlapping avatars under crowdfunding progress.
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatWorkBudgetUsd } from '../src/lib/formatMoney';
import {
  fetchMissionEcoHeroes,
  type MissionEcoHero,
} from '../src/lib/missionEcoHeroes';
import { resolveAvatarUrl } from '../src/lib/r2Media';

const MAX_VISIBLE = 8;

function displayName(hero: MissionEcoHero, anonymousLabel: string): string {
  const name = hero.full_name?.trim();
  return name || anonymousLabel;
}

function initialFor(hero: MissionEcoHero): string {
  const name = hero.full_name?.trim();
  if (name) return name.charAt(0).toUpperCase();
  return '✦';
}

type Props = {
  missionId: string;
  /** Bump when funding changes so the ribbon refreshes after a donation. */
  refreshKey?: string | number;
};

const EcoHeroesRibbon: React.FC<Props> = ({ missionId, refreshKey }) => {
  const { t } = useTranslation();
  const [heroes, setHeroes] = useState<MissionEcoHero[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rows = await fetchMissionEcoHeroes(missionId);
        if (!cancelled) setHeroes(rows);
      } catch {
        if (!cancelled) setHeroes([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [missionId, refreshKey]);

  useEffect(() => {
    if (!activeId) return;
    const id = window.setTimeout(() => setActiveId(null), 3200);
    return () => window.clearTimeout(id);
  }, [activeId]);

  if (loading && heroes.length === 0) {
    return (
      <div className="mt-3 flex items-center gap-2 py-1">
        <div className="h-8 w-8 animate-pulse rounded-full bg-white/10" />
        <div className="h-8 w-8 -ml-2 animate-pulse rounded-full bg-white/10" />
        <div className="h-8 w-8 -ml-2 animate-pulse rounded-full bg-white/10" />
      </div>
    );
  }

  if (heroes.length === 0) return null;

  const visible = heroes.slice(0, MAX_VISIBLE);
  const overflow = Math.max(0, heroes.length - visible.length);
  const anonymous = t('ecoHeroAnonymous', { defaultValue: 'Eco Hero' });
  const activeHero = activeId ? heroes.find((h) => h.user_id === activeId) : null;

  return (
    <div className="relative mt-3">
      <div className="mb-1.5 flex items-center gap-2">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300/90">
          {t('ecoHeroesLabel', { defaultValue: 'Eco Heroes' })}
        </p>
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-emerald-400/35 bg-emerald-500/15 px-1.5 text-[9px] font-black tabular-nums text-emerald-100">
          {heroes.length}
        </span>
      </div>

      <div className="flex max-w-full items-center overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex items-center -space-x-2 pr-2">
          {visible.map((hero, index) => {
            const vip = hero.isVip;
            const top = hero.isTopDonor;
            const size = vip ? 'h-10 w-10 sm:h-11 sm:w-11' : 'h-8 w-8';
            const ring = top
              ? 'border-2 border-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.55)]'
              : vip
                ? 'border-2 border-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]'
                : 'border border-white/20';
            const z = top || vip ? 20 + index : 10 + index;
            const name = displayName(hero, anonymous);

            return (
              <button
                key={hero.user_id}
                type="button"
                title={name}
                aria-label={name}
                onClick={() => setActiveId(hero.user_id)}
                className={`relative shrink-0 ${size} rounded-full ${ring} bg-slate-900/90 backdrop-blur-sm transition-transform active:scale-95`}
                style={{ zIndex: z }}
              >
                {hero.avatar_url ? (
                  <img
                    src={resolveAvatarUrl(hero.avatar_url)}
                    alt=""
                    draggable={false}
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  <span
                    className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-cyan-700/80 via-emerald-900/90 to-slate-950 text-[11px] font-black text-cyan-100"
                    aria-hidden
                  >
                    {initialFor(hero)}
                  </span>
                )}
                {vip && (
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 flex min-w-[1.1rem] items-center justify-center rounded-full border border-slate-950 px-1 text-[8px] font-black leading-none ${
                      top
                        ? 'bg-amber-400 text-slate-950'
                        : 'bg-emerald-400 text-slate-950'
                    }`}
                  >
                    {top && hero.contribution_count < 2
                      ? '★'
                      : `+${Math.min(99, hero.contribution_count)}`}
                  </span>
                )}
              </button>
            );
          })}
          {overflow > 0 && (
            <span
              className="relative z-[5] flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-slate-900/90 text-[10px] font-black text-slate-300"
              aria-label={t('ecoHeroesMore', {
                count: overflow,
                defaultValue: '+{{count}} more',
              })}
            >
              +{overflow}
            </span>
          )}
        </div>
      </div>

      {activeHero && (
        <div
          role="status"
          className="mt-1 rounded-xl border border-emerald-400/30 bg-emerald-950/90 px-3 py-2 text-[11px] font-medium leading-snug text-emerald-50 shadow-[0_8px_24px_rgba(16,185,129,0.2)] backdrop-blur-md"
        >
          {t('ecoHeroToast', {
            name: displayName(activeHero, anonymous),
            amount: formatWorkBudgetUsd(activeHero.total_donated),
            count: activeHero.contribution_count,
            defaultValue:
              '{{name}} · contributed {{amount}} ({{count}}×) — a true Eco Hero!',
          })}
        </div>
      )}
    </div>
  );
};

export default EcoHeroesRibbon;
