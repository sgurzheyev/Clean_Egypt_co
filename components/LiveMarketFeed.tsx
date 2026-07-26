/**
 * [[Architecture_Overview.md]]
 * Live market feed of active missions (USD work budgets).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { formatWorkBudgetUsd } from '../src/lib/formatMoney';
import { missionWorkBudgetUsd } from '../src/lib/missionBudget';
import { missionPinIcon, missionSector } from '../src/lib/serviceSectors';
import { closestMarketplaceCity } from '../src/lib/egyptMarketplace';
import {
  MARKETPLACE_ALL_CITIES_ID,
  filterMissionsByCountriesCity,
} from '../src/lib/globalMarketplace';
import { useLocationCatalog } from '../src/hooks/useLocationCatalog';
import { formatPinLocationTag } from '../src/lib/mapboxReverseGeocode';
import { extractMissionFeedDescription } from '../src/lib/missionDescription';
import {
  DEFAULT_MISSION_SORT,
  filterMissionsByTags,
  formatSubmittedRelative,
  sortMissions,
  type MissionSortMode,
} from '../src/lib/missionFilterSort';
import MissionFeedCard from './MissionFeedCard';
import MissionFilterPanel from './MissionFilterPanel';
import ImmersiveMissionFeed from './ImmersiveMissionFeed';
import {
  filterMissionsByFreeReports,
  readShowFreeReports,
  subscribeShowFreeReports,
  writeShowFreeReports,
} from '../src/lib/showFreeReports';
import { filterMissionsByMutedCreators } from '../src/lib/mutedCreators';
import { useMutedCreators } from '../src/hooks/useMutedCreators';
import {
  fetchTrustBadgesForOwners,
  type TrustBadgeId,
} from '../src/lib/trustBadges';
import TrustBadgeRow from './TrustBadgeRow';

export interface LiveMarketMission {
  id: string;
  category: 'public' | 'home' | 'office' | string;
  service_type?: string | null;
  amount_target: number;
  expected_price?: number | null;
  current_funding?: number | null;
  is_report?: boolean | null;
  location_lat: number;
  location_lng: number;
  country?: string | null;
  city?: string | null;
  status: string;
  cleaner_id?: string | null;
  creator_id?: string | null;
  description?: string | null;
  photo_urls?: string[] | null;
  created_at?: string | null;
  creator?: {
    full_name?: string | null;
    avatar_url?: string | null;
  } | null;
}

interface LiveMarketFeedProps {
  open: boolean;
  onClose: () => void;
  onSelectMission: (mission: LiveMarketMission) => void;
  currentUserId?: string | null;
  /** Open the mission briefing with P2P chat intent (immersive feed "Message"). */
  onOpenMissionChat?: (mission: LiveMarketMission) => void;
  /** Open the account/profile overlay (immersive feed bottom nav). */
  onOpenProfile?: () => void;
  /** Immersive feed "+": back to the map with the new-mission pin-drop flow armed. */
  onCreateMission?: () => void;
}

const ACTIVE_MARKET_STATUSES = [
  'pending',
  'available',
  'open',
  'funding',
  'in_progress',
  'reported',
] as const;

/** Crowdfunding stays listed while funding — even with a pre-locked cleaner. */
function isPublicMarketMission(mission: LiveMarketMission): boolean {
  const status = String(mission.status || '').toLowerCase() as (typeof ACTIVE_MARKET_STATUSES)[number];
  if (!ACTIVE_MARKET_STATUSES.includes(status)) return false;
  if (status === 'reported' || mission.is_report) return true;
  if (status === 'funding') return true;
  if (status === 'in_progress') return true;
  return !mission.cleaner_id;
}

function fundingCleanerLockRemaining(mission: LiveMarketMission): number | null {
  if (String(mission.status || '').toLowerCase() !== 'funding' || !mission.cleaner_id) {
    return null;
  }
  const target = Math.max(
    0,
    Math.floor(Number(mission.expected_price ?? mission.amount_target ?? 0))
  );
  const raised = Math.max(0, Math.floor(Number(mission.current_funding ?? 0)));
  return Math.max(0, target - raised);
}

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
  const city = String(mission.city ?? '').trim();
  const country = String(mission.country ?? '').trim();
  if (city || country) {
    const placeLabel = [city, country].filter(Boolean).join(', ');
    return formatPinLocationTag(
      {
        areaName: '',
        closestCityId: '',
        closestCityNameKey: '',
        placeLabel,
        country: country || undefined,
        city: city || undefined,
      },
      (key) => t(key),
      t('pinLocationLabel')
    );
  }
  const hub = closestMarketplaceCity(mission.location_lat, mission.location_lng);
  if (hub) {
    return formatPinLocationTag(
      {
        areaName: '',
        closestCityId: hub.id,
        closestCityNameKey: hub.nameKey,
        country: 'Egypt',
      },
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
  onOpenMissionChat,
  onOpenProfile,
  onCreateMission,
}) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [missions, setMissions] = useState<LiveMarketMission[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<MissionSortMode>(DEFAULT_MISSION_SORT);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [marketCountryIds, setMarketCountryIds] = useState<string[]>([]);
  const [marketCityId, setMarketCityId] = useState<string>(MARKETPLACE_ALL_CITIES_ID);
  const [showFreeReports, setShowFreeReports] = useState(() => readShowFreeReports());
  // Immersive Visual Feed: id of the mission whose photo was tapped (null = closed).
  const [immersiveStartId, setImmersiveStartId] = useState<string | null>(null);
  const [creatorBadges, setCreatorBadges] = useState<
    Record<string, TrustBadgeId[]>
  >({});
  const { mutedIds } = useMutedCreators();

  const toggleTag = (tag: string) =>
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]
    );
  const clearTags = () => setSelectedTags([]);
  const handleShowFreeReportsChange = (show: boolean) => {
    setShowFreeReports(show);
    writeShowFreeReports(show);
  };

  useEffect(() => subscribeShowFreeReports(setShowFreeReports), []);

  // Closing the market panel always closes the immersive feed with it.
  useEffect(() => {
    if (!open) setImmersiveStartId(null);
  }, [open]);

  // DB catalog + DB-wide facets keep every populated region selectable, even
  // when its missions fall outside this panel's page window.
  const { catalog: locationCatalog } = useLocationCatalog(missions, open);

  const visibleMissions = useMemo(
    () =>
      sortMissions(
        filterMissionsByMutedCreators(
          filterMissionsByFreeReports(
            filterMissionsByCountriesCity(
              filterMissionsByTags(missions, selectedTags),
              marketCountryIds,
              marketCityId,
              locationCatalog
            ),
            showFreeReports
          ),
          mutedIds
        ),
        sortMode
      ),
    [
      missions,
      selectedTags,
      marketCountryIds,
      marketCityId,
      locationCatalog,
      showFreeReports,
      mutedIds,
      sortMode,
    ]
  );

  useEffect(() => {
    if (!open || missions.length === 0) return;
    let cancelled = false;
    const ids = [
      ...new Set(
        missions
          .map((m) => m.creator_id)
          .filter((id): id is string => !!id)
      ),
    ].slice(0, 24);
    if (ids.length === 0) return;
    void fetchTrustBadgesForOwners(ids).then((map) => {
      if (!cancelled) setCreatorBadges(map);
    });
    return () => {
      cancelled = true;
    };
  }, [open, missions]);

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
          service_type,
          amount_target,
          expected_price,
          current_funding,
          is_report,
          location_lat,
          location_lng,
          country,
          city,
          status,
          cleaner_id,
          creator_id,
          description,
          photo_urls,
          created_at,
          creator:profiles!creator_id (
            full_name,
            avatar_url
          )
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
              isPublicMarketMission(mission)
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
    <>
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
            className="ce-bottom-sheet absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border-t border-white/10 bg-[#0A0A12]/95 shadow-[0_-12px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl"
            style={{ maxHeight: 'min(85svh, 85dvh, 85vh)' }}
          >
            <div
              className="ce-bottom-sheet-body min-h-0 flex-1 touch-pan-y"
              style={{ WebkitOverflowScrolling: 'touch' }}
              onTouchMove={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 z-10 relative border-b border-white/10 bg-[#0A0A12]/95 p-4 backdrop-blur-xl">
                <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-white/20" aria-hidden />
                <button
                  type="button"
                  onClick={onClose}
                  className="absolute right-3 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-slate-300"
                  aria-label={t('close')}
                >
                  ✕
                </button>
                <p className="pr-10 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-400">
                  {t('serviceMarketplace')}
                </p>
                <p className="mt-0.5 pr-10 text-xs text-slate-500">{t('liveMarketBrowseHint')}</p>
              </div>

              <div className="w-full max-w-full min-w-0 space-y-4 overflow-x-hidden px-3 pt-3 pb-[max(2.5rem,calc(env(safe-area-inset-bottom,0px)+2rem))]">
                <MissionFilterPanel
                  sortMode={sortMode}
                  onSortChange={setSortMode}
                  selectedTags={selectedTags}
                  onToggleTag={toggleTag}
                  onClearTags={clearTags}
                  resultCount={visibleMissions.length}
                  countryIds={marketCountryIds}
                  onCountryIdsChange={setMarketCountryIds}
                  cityId={marketCityId}
                  onCityChange={setMarketCityId}
                  locationCatalog={locationCatalog}
                  showFreeReports={showFreeReports}
                  onShowFreeReportsChange={handleShowFreeReportsChange}
                />

                <div className="space-y-3">
                  {loading && <p className="py-4 text-center text-xs text-slate-400">{t('loading')}</p>}
                  {!loading && loadError && (
                    <p className="py-4 text-center text-xs text-red-300">{loadError}</p>
                  )}
                  {!loading && !loadError && missions.length === 0 && (
                    <p className="py-4 text-center text-xs text-slate-400">{t('noLiveMissions')}</p>
                  )}
                  {!loading && !loadError && missions.length > 0 && visibleMissions.length === 0 && (
                    <p className="py-4 text-center text-xs text-slate-400">{t('noMissionsMatchFilters')}</p>
                  )}
                  {!loading &&
                    !loadError &&
                    visibleMissions.map((mission) => {
                      const budget = missionWorkBudgetUsd(mission);
                      const isOwnTask =
                        !!currentUserId && mission.creator_id === currentUserId;
                      const isHome = missionSector(mission.service_type, mission.category) === 'home';
                      const remainingForStart = fundingCleanerLockRemaining(mission);
                      const statusLabel =
                        mission.status === 'in_progress' ? t('accepted') : mission.status;

                      return (
                        <MissionFeedCard
                          key={mission.id}
                          photoUrl={mission.photo_urls?.[0] ?? null}
                          placeholderVariant={isHome ? 'home' : 'city'}
                          placeholderIcon={missionPinIcon(mission.service_type, mission.category)}
                          budgetValue={formatWorkBudgetUsd(budget)}
                          locationLine={missionLocationLine(mission, t)}
                          description={extractMissionFeedDescription(mission.description)}
                          metaLine={`${t('orderNumber')} ${mission.id.slice(0, 8)}`}
                          submittedLabel={
                            mission.created_at
                              ? `${t('submittedLabel')}: ${formatSubmittedRelative(
                                  mission.created_at,
                                  i18n.language
                                )}`
                              : undefined
                          }
                          creatorAvatarUrl={mission.creator?.avatar_url ?? null}
                          creatorName={mission.creator?.full_name ?? null}
                          creatorAriaLabel={t('viewCreatorProfile')}
                          trustBadges={
                            mission.creator_id &&
                            (creatorBadges[mission.creator_id]?.length ?? 0) > 0 ? (
                              <TrustBadgeRow
                                badges={creatorBadges[mission.creator_id]}
                                compact
                                vertical
                              />
                            ) : undefined
                          }
                          onCreatorClick={
                            mission.creator_id
                              ? () => {
                                  onClose();
                                  navigate(`/profile/${mission.creator_id}`);
                                }
                              : undefined
                          }
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
                          callout={
                            remainingForStart != null ? (
                              <span className="inline-flex max-w-full rounded-lg border border-violet-400/45 bg-violet-600/85 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-white shadow-[0_4px_14px_rgba(139,92,246,0.35)] backdrop-blur-sm">
                                {t('feedCleanerLockedNeedsMore', {
                                  amount: remainingForStart,
                                  defaultValue:
                                    'Cleaner locked in! Needs ${{amount}} more to start',
                                })}
                              </span>
                            ) : undefined
                          }
                          onClick={() => onSelectMission(mission)}
                          onPhotoClick={() => setImmersiveStartId(mission.id)}
                          photoAriaLabel={t('immersiveOpenFeed', {
                            defaultValue: 'Open visual feed',
                          })}
                          onLocate={() => onSelectMission(mission)}
                          locateAriaLabel={t('locateOnMap')}
                        />
                      );
                    })}
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>

    {/* Immersive Visual Feed — mission stack mirrors the active filter state. */}
    <ImmersiveMissionFeed
      open={open && !!immersiveStartId}
      missions={visibleMissions}
      startMissionId={immersiveStartId}
      creatorTrustBadges={creatorBadges}
      onClose={() => setImmersiveStartId(null)}
      onOpenCreator={(creatorId) => {
        setImmersiveStartId(null);
        onClose();
        navigate(`/profile/${creatorId}`);
      }}
      onShowOnMap={(mission) => {
        setImmersiveStartId(null);
        onSelectMission(mission as LiveMarketMission);
      }}
      onContact={(mission) => {
        // Briefing hosts the contact panel — the Hungry-Games privacy lock
        // (contacts hidden until a bid is accepted) is enforced there.
        setImmersiveStartId(null);
        onSelectMission(mission as LiveMarketMission);
      }}
      onMessage={(mission) => {
        setImmersiveStartId(null);
        if (onOpenMissionChat) {
          onOpenMissionChat(mission as LiveMarketMission);
        } else {
          onSelectMission(mission as LiveMarketMission);
        }
      }}
      onOpenProfile={
        onOpenProfile
          ? () => {
              setImmersiveStartId(null);
              onClose();
              onOpenProfile();
            }
          : undefined
      }
      onCreateMission={
        onCreateMission
          ? () => {
              setImmersiveStartId(null);
              onClose();
              onCreateMission();
            }
          : undefined
      }
    />
    </>
  );
};

export default LiveMarketFeed;
