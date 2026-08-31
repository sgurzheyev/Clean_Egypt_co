/**
 * [[Architecture_Overview.md]]
 * Live market feed of active missions (USD work budgets).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Virtuoso } from 'react-virtuoso';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { formatWorkBudgetUsd } from '../src/lib/formatMoney';
import { missionWorkBudgetUsd } from '../src/lib/missionBudget';
import { missionPinIcon, missionSector } from '../src/lib/serviceSectors';
import { crowdfundingFeedCallout, isCrowdfundingPin } from '../src/lib/crowdfunding';
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
import MissionFeedErrorBoundary from './MissionFeedErrorBoundary';
import { useListScrollMapPreview } from '../src/hooks/useListScrollMapPreview';

/** Extra pixels kept mounted above/below the visible Service Market list. */
const MARKET_LIST_OVERSCAN_PX = { top: 480, bottom: 720 } as const;

/** GPU layer for mission cards during scroll (glass / buttons stay composited). */
const CARD_GPU_STYLE: React.CSSProperties = {
  transform: 'translateZ(0)',
  willChange: 'transform, opacity',
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
};
export interface LiveMarketMission {
  id: string;
  category: 'public' | 'home' | 'office' | string;
  service_type?: string | null;
  amount_target: number;
  expected_price?: number | null;
  current_funding?: number | null;
  crowdfunding_mode?: boolean | null;
  crowdfunding_expires_at?: string | null;
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
  photos?: unknown;
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

function fundingFeedCallout(mission: LiveMarketMission): {
  kind: 'locked' | 'needs_more';
  remaining: number;
} | null {
  return crowdfundingFeedCallout(mission);
}

const statusClass = (status: string, isCrowd: boolean) =>
  isCrowd || String(status || '').toLowerCase() === 'funding'
    ? 'border-violet-400/55 bg-violet-500/25 text-violet-100'
    : status === 'in_progress'
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
  const marketScrollerRef = useRef<HTMLElement | null>(null);
  const [scrollerEpoch, setScrollerEpoch] = useState(0);
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
  useListScrollMapPreview(open, marketScrollerRef, scrollerEpoch);

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
          crowdfunding_mode,
          crowdfunding_expires_at,
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
    <MissionFeedErrorBoundary
      variant="sheet"
      resetKeys={[open]}
      onClose={onClose}
    >
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[140] pointer-events-none"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 44, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 32, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
            className="ce-bottom-sheet live-map-glass pointer-events-auto absolute inset-x-0 bottom-0 mx-auto flex h-[min(85svh,85dvh,85vh)] max-h-[min(85svh,85dvh,85vh)] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border-t border-cyan-400/20"
            style={{
              display: 'flex',
              flexDirection: 'column',
              height: 'min(85svh, 85dvh, 85vh)',
              maxHeight: 'min(85svh, 85dvh, 85vh)',
            }}
          >
            {/* Column shell: header + filters (shrink-0) + Virtuoso (flex-1 min-h-0).
                Filters stay outside Virtuoso so expand/collapse never remounts the list. */}
            <div
              className="flex h-full min-h-0 w-full flex-1 flex-col"
              style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
            >
              <div className="relative shrink-0 border-b border-white/10 bg-white/[0.04] p-4 backdrop-blur-md">
                <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-white/20" aria-hidden />
                <button
                  type="button"
                  onClick={onClose}
                  className="glass-button absolute right-3 top-2 flex h-8 w-8 items-center justify-center rounded-full text-slate-300"
                  aria-label={t('close')}
                >
                  ✕
                </button>
                <p className="glass-text pr-10 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-300">
                  {t('serviceMarketplace')}
                </p>
                <p className="mt-0.5 pr-10 text-xs text-slate-500">{t('liveMarketBrowseHint')}</p>
              </div>

              <div className="scrollable-sheet-content max-h-[min(42%,22rem)] shrink-0 overflow-x-hidden border-b border-white/5 px-3 pt-3 pb-2">
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
              </div>

              {/* Critical: flex-1 + min-h-0 so Virtuoso owns internal scroll when filters grow. */}
              <div
                className="relative min-h-0 flex-1 overflow-hidden"
                style={{ flex: '1 1 0%', minHeight: 0 }}
              >
                {loading && (
                  <p className="py-4 text-center text-xs text-slate-400">{t('loading')}</p>
                )}
                {!loading && loadError && (
                  <p className="py-4 text-center text-xs text-red-300">{loadError}</p>
                )}
                {!loading && !loadError && missions.length === 0 && (
                  <p className="py-4 text-center text-xs text-slate-400">{t('noLiveMissions')}</p>
                )}
                {!loading && !loadError && missions.length > 0 && visibleMissions.length === 0 && (
                  <p className="py-4 text-center text-xs text-slate-400">
                    {t('noMissionsMatchFilters')}
                  </p>
                )}
                {!loading && !loadError && visibleMissions.length > 0 && (
                  <div className="absolute inset-0 min-h-0" style={{ height: '100%', minHeight: 0 }}>
                    <Virtuoso
                      style={{ height: '100%', width: '100%' }}
                      data={visibleMissions}
                      computeItemKey={(_index, mission) => String(mission.id)}
                      increaseViewportBy={MARKET_LIST_OVERSCAN_PX}
                      scrollerRef={(ref) => {
                        const node = (ref as HTMLElement | null) ?? null;
                        if (marketScrollerRef.current !== node) {
                          marketScrollerRef.current = node;
                          setScrollerEpoch((n) => n + 1);
                        }
                      }}
                      itemContent={(_index, mission) => {
                        const budget = missionWorkBudgetUsd(mission);
                        const isOwnTask =
                          !!currentUserId && mission.creator_id === currentUserId;
                        const isHome =
                          missionSector(mission.service_type, mission.category) === 'home';
                        const remainingCallout = fundingFeedCallout(mission);
                        const isCrowd = isCrowdfundingPin(mission);
                        const statusLabel =
                          mission.status === 'in_progress' ? t('accepted') : mission.status;

                        return (
                          <div
                            key={mission.id}
                            data-mission-id={mission.id}
                            className="px-3 pb-3"
                            style={CARD_GPU_STYLE}
                          >
                            <MissionFeedCard
                              photoUrl={mission.photo_urls ?? mission.photos}
                              previewLat={mission.location_lat}
                              previewLng={mission.location_lng}
                              previewMissionId={mission.id}
                              placeholderVariant={isHome ? 'home' : 'city'}
                              placeholderIcon={missionPinIcon(
                                mission.service_type,
                                mission.category,
                                !!mission.is_report,
                                isCrowd
                              )}
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
                              accentCrowd={isCrowd}
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
                                    mission.status,
                                    isCrowd
                                  )}`}
                                >
                                  {t('status')}: {statusLabel}
                                </span>
                              }
                              callout={
                                remainingCallout ? (
                                  <span className="inline-flex max-w-full rounded-lg border border-violet-400/45 bg-violet-600/85 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-white shadow-[0_4px_14px_rgba(139,92,246,0.35)] backdrop-blur-sm">
                                    {remainingCallout.kind === 'locked'
                                      ? t('feedCleanerLockedNeedsMore', {
                                          amount: remainingCallout.remaining,
                                          defaultValue:
                                            'Cleaner locked in! Needs ${{amount}} more to start',
                                        })
                                      : t('feedNeedsMore', {
                                          amount: remainingCallout.remaining,
                                          defaultValue: 'Needs ${{amount}} more',
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
                          </div>
                        );
                      }}
                      components={{
                        Footer: () => (
                          <div
                            className="h-[max(2.5rem,calc(env(safe-area-inset-bottom,0px)+2rem))]"
                            aria-hidden
                          />
                        ),
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </MissionFeedErrorBoundary>

    {/* Immersive Visual Feed — mission stack mirrors the active filter state.
        Has its own ErrorBoundary (fullscreen) so a crash there does not
        blank the market sheet or the map. */}
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
