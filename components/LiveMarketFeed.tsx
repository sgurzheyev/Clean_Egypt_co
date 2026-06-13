import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { supabase } from '../services/supabase';
import { formatWorkBudgetEgp } from '../src/lib/formatMoney';
import { missionWorkBudgetEgp } from '../src/lib/missionBudget';
import { closestMarketplaceCity } from '../src/lib/egyptMarketplace';
import { formatPinLocationTag } from '../src/lib/mapboxReverseGeocode';
import MissionFeedCard from './MissionFeedCard';

export interface LiveMarketMission {
  id: string;
  category: 'public' | 'home' | 'office' | string;
  amount_target: number;
  expected_price?: number | null;
  current_funding?: number | null;
  location_lat: number;
  location_lng: number;
  status: string;
  cleaner_id?: string | null;
  creator_id?: string | null;
  description?: string | null;
  photo_urls?: string[] | null;
  created_at?: string | null;
}

interface LiveMarketFeedProps {
  open: boolean;
  onClose: () => void;
  onSelectMission: (mission: LiveMarketMission) => void;
  currentUserId?: string | null;
}

const ACTIVE_MARKET_STATUSES = ['pending', 'available', 'funding', 'in_progress'] as const;

const statusClass = (status: string) =>
  status === 'in_progress'
    ? 'border-cyan-400/55 bg-cyan-500/25 text-cyan-100'
    : 'border-emerald-400/55 bg-emerald-500/25 text-emerald-100';

function missionLocationLine(
  mission: LiveMarketMission,
  t: (key: string) => string
): string {
  const descLine = String(mission.description ?? '').split('\n')[0]?.trim();
  if (descLine.startsWith('📍')) return descLine;
  const hub = closestMarketplaceCity(mission.location_lat, mission.location_lng);
  if (hub) {
    return formatPinLocationTag(
      { areaName: '', closestCityId: hub.id, closestCityNameKey: hub.nameKey },
      (key) => t(key),
      t('pinLocationLabel')
    );
  }
  return `${mission.location_lat.toFixed(4)}, ${mission.location_lng.toFixed(4)}`;
}

const LiveMarketFeed: React.FC<LiveMarketFeedProps> = ({
  open,
  onClose,
  onSelectMission,
  currentUserId,
}) => {
  const { t } = useTranslation();
  const [missions, setMissions] = useState<LiveMarketMission[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      const { data, error } = await supabase
        .from('missions')
        .select(`
          id,
          category,
          amount_target,
          expected_price,
          current_funding,
          location_lat,
          location_lng,
          status,
          cleaner_id,
          creator_id,
          description,
          photo_urls,
          created_at
        `)
        .in('status', [...ACTIVE_MARKET_STATUSES])
        .order('amount_target', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200);

      if (cancelled) return;
      if (error) {
        setLoadError(error.message || t('liveMarketLoadFailed'));
        setMissions([]);
      } else {
        setMissions(
          ((data || []) as LiveMarketMission[]).filter(
            (mission) =>
              Number.isFinite(mission.location_lat) &&
              Number.isFinite(mission.location_lng) &&
              ACTIVE_MARKET_STATUSES.includes(
                mission.status as (typeof ACTIVE_MARKET_STATUSES)[number]
              )
          )
        );
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, t]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[140] bg-black/70 backdrop-blur-sm pointer-events-auto"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 44, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 32, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[88vh] w-full max-w-xl flex-col rounded-t-2xl bg-slate-950/95 shadow-[0_-12px_40px_rgba(0,0,0,0.45)]"
          >
            <div className="relative shrink-0 px-4 pb-2 pt-3">
              <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-white/20" />
              <button
                type="button"
                onClick={onClose}
                className="absolute right-3 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-slate-300"
                aria-label={t('close')}
              >
                ✕
              </button>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-400">
                {t('serviceMarketplace')}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">{t('liveMarketBrowseHint')}</p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <div className="space-y-3">
                {loading && <p className="py-4 text-center text-xs text-slate-400">{t('loading')}</p>}
                {!loading && loadError && (
                  <p className="py-4 text-center text-xs text-red-300">{loadError}</p>
                )}
                {!loading && !loadError && missions.length === 0 && (
                  <p className="py-4 text-center text-xs text-slate-400">{t('noLiveMissions')}</p>
                )}
                {!loading &&
                  !loadError &&
                  missions.map((mission) => {
                    const budget = missionWorkBudgetEgp(mission);
                    const isOwnTask =
                      !!currentUserId && mission.creator_id === currentUserId;
                    const isHome = mission.category === 'home';
                    const statusLabel =
                      mission.status === 'in_progress' ? t('accepted') : mission.status;

                    return (
                      <MissionFeedCard
                        key={mission.id}
                        photoUrl={mission.photo_urls?.[0] ?? null}
                        placeholderVariant={isHome ? 'home' : 'city'}
                        placeholderIcon={isHome ? '🏠' : '🌆'}
                        budgetValue={formatWorkBudgetEgp(budget)}
                        locationLine={missionLocationLine(mission, t)}
                        metaLine={`${t('orderNumber')} ${mission.id.slice(0, 8)}`}
                        highlighted={isOwnTask}
                        topLeftBadge={
                          isOwnTask ? (
                            <span className="rounded-full border border-emerald-400/50 bg-emerald-500/30 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-emerald-100 backdrop-blur-sm">
                              {t('yourTaskBadge')}
                            </span>
                          ) : undefined
                        }
                        statusBadge={
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] backdrop-blur-sm ${statusClass(
                              mission.status
                            )}`}
                          >
                            {t('status')}: {statusLabel}
                          </span>
                        }
                        onClick={() => onSelectMission(mission)}
                        onLocate={() => onSelectMission(mission)}
                        locateAriaLabel={t('locateOnMap')}
                      />
                    );
                  })}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default LiveMarketFeed;
