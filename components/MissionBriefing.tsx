/**
 * [[Architecture_Overview.md]]
 * Mission detail panel — bids, crowdfunding progress + Stripe contribute.
 */
import React, { useEffect, useState } from 'react';
import { MapPin, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import TranslatableMissionDescription from './TranslatableMissionDescription';
import { useMissionTextTranslation } from '../src/hooks/useMissionTextTranslation';
import {
  missionFeedPlaceholderGradient,
  type MissionFeedPlaceholderVariant,
} from '../src/lib/missionFeedVisuals';
import { extractMissionFeedDescription } from '../src/lib/missionDescription';
import { closestMarketplaceCity } from '../src/lib/egyptMarketplace';
import { formatPinLocationTag } from '../src/lib/mapboxReverseGeocode';
import { formatTokens, formatWorkBudgetUsd } from '../src/lib/formatMoney';
import { missionTokenBid, missionWorkBudgetUsd } from '../src/lib/missionBudget';
import { missionPinIcon, missionSector } from '../src/lib/serviceSectors';
import {
  formatCrowdfundingCountdownCompact,
  getCrowdfundingCountdownParts,
  getCrowdfundingExpiresAt,
  isCrowdfundingOpen,
} from '../src/lib/crowdfunding';
import { formatUsdPrice, YEARLY_SUBSCRIPTION } from '../src/lib/tokenPricing';
import { type MissionBidRow, bidWorkerDisplayName } from '../src/lib/missionBids';

export type AssignedWorkerProfile = {
  full_name?: string | null;
  avatar_url?: string | null;
  rating?: number | null;
  telegram_username?: string | null;
};
import { sanitizeIntegerUsdDigits, parseIntegerUsdFromInput } from '../src/lib/integerUsdInput';

export type MissionBriefingMission = {
  id: string;
  category: string;
  service_type?: string | null;
  amount_target: number;
  expected_price?: number | null;
  current_funding?: number | null;
  crowdfunding_mode?: boolean | null;
  crowdfunding_expires_at?: string | null;
  created_at?: string | null;
  location_lat: number;
  location_lng: number;
  status: string;
  cleaner_id?: string | null;
  creator_id?: string | null;
  description?: string | null;
  photo_urls?: string[] | null;
  completion_distance_meters?: number | null;
};

export type MissionBriefingProps = {
  mission: MissionBriefingMission;
  booting: boolean;
  sheetDragY: number;
  currentUserId: string | null | undefined;
  activeBidCount: number;
  serviceLabel: string;
  missionBids: MissionBidRow[];
  bidsLoading: boolean;
  bidsError: string | null;
  isMissionCreator: boolean;
  canPlaceBid: boolean;
  bidSubmitting: boolean;
  onAcceptBid: (bid: MissionBidRow) => void;
  onDeclineBid: (bidId: string) => void;
  onPlaceBid: (amountUsd: number) => void;
  /** Crowdfunding contribution (Garbage Removal only). */
  canContribute?: boolean;
  contributeSubmitting?: boolean;
  onContribute?: (amountUsd: number) => void;
  assignedWorker?: AssignedWorkerProfile | null;
  gpsDistanceMeters: number | null;
  gpsDistanceError: string | null;
  isExecutorViewer: boolean;
  workerHasActiveSubscription: boolean;
  leadPhoneVisible: boolean;
  unlockedLeadPhone: string | null;
  unlockLeadLoading: boolean;
  reviewedMissions: Set<string>;
  selectedRating: number;
  isSubmittingReview: boolean;
  onClose: () => void;
  onSheetTouchStart: (e: React.TouchEvent) => void;
  onSheetTouchMove: (e: React.TouchEvent) => void;
  onSheetTouchEnd: () => void;
  onViewPhotos: () => void;
  onStartWork: () => void;
  onUnlockLead: () => void;
  onSubscribe: () => void;
  onSubmitReview: (rating: number, comment: string) => void;
  onSelectRating: (rating: number) => void;
  isPlatformAdmin?: boolean;
  adminDeleteSubmitting?: boolean;
  onAdminDeleteMission?: () => void;
  /** Mission creator identity for the clickable avatar in the hero. */
  creatorAvatarUrl?: string | null;
  creatorName?: string | null;
  creatorIsVerified?: boolean | null;
  onCreatorClick?: () => void;
};

function missionLocationLine(
  mission: MissionBriefingMission,
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

function placeholderVariantFor(mission: MissionBriefingMission): MissionFeedPlaceholderVariant {
  return missionSector(mission.service_type, mission.category) === 'home' ? 'home' : 'city';
}

function statusBadgeClass(status: string): string {
  if (status === 'in_progress') {
    return 'border-cyan-400/55 bg-cyan-500/25 text-cyan-100';
  }
  if (status === 'completed') {
    return 'border-amber-400/55 bg-amber-500/25 text-amber-100';
  }
  return 'border-emerald-400/55 bg-emerald-500/25 text-emerald-100';
}

const MissionBriefing: React.FC<MissionBriefingProps> = ({
  mission,
  booting,
  sheetDragY,
  currentUserId,
  activeBidCount,
  serviceLabel,
  missionBids,
  bidsLoading,
  bidsError,
  isMissionCreator,
  canPlaceBid,
  bidSubmitting,
  onAcceptBid,
  onDeclineBid,
  onPlaceBid,
  canContribute = false,
  contributeSubmitting = false,
  onContribute,
  assignedWorker,
  gpsDistanceMeters,
  gpsDistanceError,
  isExecutorViewer,
  workerHasActiveSubscription,
  leadPhoneVisible,
  unlockedLeadPhone,
  unlockLeadLoading,
  reviewedMissions,
  selectedRating,
  isSubmittingReview,
  onClose,
  onSheetTouchStart,
  onSheetTouchMove,
  onSheetTouchEnd,
  onViewPhotos,
  onStartWork,
  onUnlockLead,
  onSubscribe,
  onSubmitReview,
  onSelectRating,
  isPlatformAdmin = false,
  adminDeleteSubmitting = false,
  onAdminDeleteMission,
  creatorAvatarUrl,
  creatorName,
  creatorIsVerified = false,
  onCreatorClick,
}) => {
  const { t } = useTranslation();
  const creatorInitial = (creatorName || '?').trim().charAt(0).toUpperCase() || '?';
  const [bidInput, setBidInput] = React.useState('');
  const photos = mission.photo_urls?.filter(Boolean) ?? [];
  const placeholderVariant = placeholderVariantFor(mission);
  const placeholderIcon = missionPinIcon(mission.service_type, mission.category);
  const feedDescription = extractMissionFeedDescription(mission.description);
  const locationSource = missionLocationLine(mission, t);
  const locationTranslation = useMissionTextTranslation(locationSource);
  const budgetValue = formatWorkBudgetUsd(missionWorkBudgetUsd(mission));
  const isInProgress = mission.status === 'in_progress';
  const showBidsSection =
    !isInProgress &&
    !isCrowdfundingOpen(mission) &&
    (isMissionCreator || canPlaceBid || missionBids.length > 0 || bidsLoading);
  const crowdfundingOpen = isCrowdfundingOpen(mission);
  const fundedUsd = Math.max(0, Math.floor(Number(mission.current_funding ?? 0)));
  const targetUsd = Math.max(0, Math.floor(Number(mission.expected_price ?? 0)));
  const fundingPct =
    targetUsd > 0 ? Math.min(100, Math.round((fundedUsd / targetUsd) * 100)) : 0;

  const [reviewComment, setReviewComment] = useState('');
  const [fundingNowMs, setFundingNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!crowdfundingOpen) return;
    setFundingNowMs(Date.now());
    const id = window.setInterval(() => setFundingNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [crowdfundingOpen, mission.id, mission.crowdfunding_expires_at]);

  const fundingCountdownParts = crowdfundingOpen
    ? getCrowdfundingCountdownParts(getCrowdfundingExpiresAt(mission), fundingNowMs)
    : null;
  const fundingCountdownLabel = formatCrowdfundingCountdownCompact(fundingCountdownParts);
  const assignedWorkerName = assignedWorker
    ? assignedWorker.full_name?.trim() ||
      (assignedWorker.telegram_username?.trim()
        ? `@${assignedWorker.telegram_username.trim()}`
        : 'Eco Hero')
    : null;
  const isOwnActive = isInProgress && mission.cleaner_id === currentUserId;
  const statusLabel = String(mission.status || '').replace(/_/g, ' ');

  return (
    <div
      className="absolute inset-0 z-[10030] flex items-end justify-center pt-[env(safe-area-inset-top)] isolate pointer-events-none"
      aria-hidden="false"
    >
      <div
        className="absolute inset-x-0 bottom-0 top-[28%] bg-gradient-to-t from-black/85 via-black/40 to-transparent backdrop-blur-[2px] pointer-events-auto"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className="relative z-[10030] w-full max-w-xl max-h-[82dvh] overflow-y-auto overflow-x-hidden overscroll-y-contain rounded-t-3xl bg-slate-950 shadow-[0_-10px_40px_rgba(0,229,255,0.12)] pb-[calc(5rem+max(2rem,env(safe-area-inset-bottom)))] pointer-events-auto touch-pan-y [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
        onClick={(e) => e.stopPropagation()}
        style={{ transform: sheetDragY > 0 ? `translateY(${sheetDragY}px)` : undefined }}
      >
        <div
          className="sticky top-0 z-20 flex justify-center pt-2 pb-1 bg-gradient-to-b from-slate-950 via-slate-950/90 to-transparent"
          onTouchStart={onSheetTouchStart}
          onTouchMove={onSheetTouchMove}
          onTouchEnd={onSheetTouchEnd}
        >
          <div className="h-1.5 w-14 rounded-full bg-white/20" aria-hidden />
        </div>

        {booting ? (
          <div className="py-16 flex flex-col items-center justify-center px-5">
            <div className="h-6 w-6 border-2 border-cyan-500/60 border-t-cyan-200 rounded-full animate-spin" />
            <p className="mt-3 text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
              {t('loading')}
            </p>
          </div>
        ) : (
          <>
            <div className="relative w-full max-h-[40vh] shrink-0 aspect-video overflow-hidden bg-slate-900">
              {photos.length > 0 ? (
                <>
                  <div
                    className="flex h-full w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain overscroll-y-none touch-pan-x [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                    style={{ WebkitOverflowScrolling: 'touch' }}
                  >
                    {photos.map((url, index) => (
                      <div
                        key={`${url}-${index}`}
                        className="relative h-full w-full shrink-0 snap-center snap-always overflow-hidden"
                      >
                        <img
                          src={url}
                          alt={`Mission photo ${index + 1}`}
                          draggable={false}
                          className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
                        />
                      </div>
                    ))}
                  </div>
                  {photos.length > 1 && (
                    <p className="pointer-events-none absolute top-12 left-1/2 z-20 -translate-x-1/2 rounded-full border border-white/20 bg-black/45 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-white/80 backdrop-blur-sm">
                      {t('swipeForMorePhotos')} · {photos.length}
                    </p>
                  )}
                </>
              ) : (
                <div
                  className={`flex h-full w-full items-center justify-center ${missionFeedPlaceholderGradient(
                    placeholderVariant
                  )}`}
                >
                  <span className="text-4xl opacity-90" aria-hidden>
                    {placeholderIcon}
                  </span>
                </div>
              )}

              <div
                className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-t from-black/95 via-black/35 to-transparent"
                aria-hidden
              />

              <button
                type="button"
                onClick={onClose}
                className="absolute right-3 top-3 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-black/55 text-white shadow-lg backdrop-blur-md transition-transform hover:bg-black/70 active:scale-95"
                aria-label={t('close')}
              >
                <X className="h-4 w-4" strokeWidth={2.25} />
              </button>

              <div className="pointer-events-none absolute left-3 top-3 z-20 flex max-w-[calc(100%-4.5rem)] flex-wrap gap-1.5">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] backdrop-blur-sm ${
                    placeholderVariant === 'home'
                      ? 'border-amber-400/50 bg-amber-500/25 text-amber-100'
                      : 'border-emerald-400/50 bg-emerald-500/25 text-emerald-100'
                  }`}
                >
                  {placeholderVariant === 'home' ? t('homeCleaning') : t('cityCleaning')}
                </span>
                {isOwnActive && (
                  <span className="rounded-full border border-sky-400/50 bg-sky-500/25 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-sky-100 backdrop-blur-sm">
                    {t('yourActiveMission')}
                  </span>
                )}
              </div>

              <div
                className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 p-4 pt-8 ${
                  onCreatorClick ? 'pr-28' : ''
                }`}
              >
                <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-300/80">
                  {t('missionBriefing')}
                </p>
                <p className="text-2xl font-black leading-none tracking-tight text-orange-300 drop-shadow-[0_2px_12px_rgba(0,0,0,0.55)] sm:text-3xl">
                  {budgetValue}
                </p>
                <div className="mt-2 flex items-start gap-1.5">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300/90" strokeWidth={2.25} />
                  <p className="line-clamp-2 text-xs font-medium leading-snug text-slate-100/90">
                    {locationTranslation.displayText}
                  </p>
                </div>
              </div>

              {onCreatorClick && (
                <button
                  type="button"
                  onClick={onCreatorClick}
                  className="pointer-events-auto absolute bottom-4 right-3 z-30 flex items-center gap-2 rounded-full border border-emerald-300/50 bg-black/55 py-1 pl-1 pr-2.5 text-emerald-100 shadow-lg backdrop-blur-md transition-transform hover:border-emerald-200/80 active:scale-95"
                  aria-label={t('viewCreatorProfile')}
                  title={creatorName || t('viewCreatorProfile')}
                >
                  <span className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-white/20 bg-slate-800">
                    {creatorAvatarUrl ? (
                      <img
                        src={creatorAvatarUrl}
                        alt=""
                        draggable={false}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-xs font-black uppercase text-emerald-200">
                        {creatorInitial}
                      </span>
                    )}
                    {creatorIsVerified && (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-slate-950 bg-cyan-400 text-[8px] font-black text-slate-950"
                        aria-hidden
                      >
                        ✓
                      </span>
                    )}
                  </span>
                  <span className="max-w-[5.5rem] truncate text-[11px] font-bold">
                    {creatorName || t('publicProfileAnonymous')}
                  </span>
                </button>
              )}
            </div>

            <div className="relative z-[1] space-y-5 px-5 pt-5 pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] backdrop-blur-sm ${statusBadgeClass(
                    mission.status
                  )}`}
                >
                  {t('status')}: {statusLabel}
                </span>
                <span className="text-[10px] font-medium text-slate-400">
                  {t('missionTokenBidLabel')}: {formatTokens(missionTokenBid(mission))}
                </span>
                {activeBidCount > 0 && (
                  <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-sky-400">
                    {t('lockedDeposit')}
                  </span>
                )}
              </div>

              {feedDescription && (
                <section>
                  <TranslatableMissionDescription
                    text={feedDescription}
                    autoTranslate
                    showTranslateButton
                    clampClassName=""
                    className="text-sm font-medium leading-relaxed text-slate-200"
                  />
                </section>
              )}

              {crowdfundingOpen && (
                <section className="border-t border-white/5 pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400/90">
                      {t('crowdfundingCampaign')}
                    </h3>
                    {fundingCountdownParts && (
                      <p
                        className={`shrink-0 text-[10px] font-black uppercase tracking-[0.12em] tabular-nums ${
                          fundingCountdownParts.expired
                            ? 'text-red-300'
                            : 'text-amber-200/90'
                        }`}
                      >
                        {fundingCountdownParts.expired
                          ? t('crowdfundingExpiredShort', { defaultValue: 'Expired' })
                          : t('crowdfundingTimeLeft', {
                              time: fundingCountdownLabel,
                              defaultValue: 'Ends in: {{time}}',
                            })}
                      </p>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                    {t('crowdfundingProgressHint', {
                      raised: formatWorkBudgetUsd(fundedUsd),
                      target: formatWorkBudgetUsd(targetUsd),
                    })}
                  </p>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-amber-400/80 transition-all"
                      style={{ width: `${fundingPct}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[10px] font-bold tabular-nums text-amber-200/90">
                    {fundingPct}%
                  </p>
                  {canContribute && onContribute && (
                    <form
                      className="mt-4 flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const amount = parseIntegerUsdFromInput(bidInput);
                        if (amount <= 0) return;
                        onContribute(amount);
                        setBidInput('');
                      }}
                    >
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        pattern="\d*"
                        value={bidInput}
                        onChange={(e) => setBidInput(sanitizeIntegerUsdDigits(e.target.value))}
                        placeholder={t('contributionAmountLabel')}
                        className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-amber-400/40 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                      />
                      <button
                        type="submit"
                        disabled={
                          contributeSubmitting ||
                          parseIntegerUsdFromInput(bidInput) <= 0 ||
                          !!fundingCountdownParts?.expired
                        }
                        className="shrink-0 rounded-xl border border-amber-400/40 bg-amber-500/90 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.14em] text-black transition-all hover:bg-amber-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {contributeSubmitting ? t('processing') : t('contributeWithStripe')}
                      </button>
                    </form>
                  )}
                  {!canContribute && !isMissionCreator && (
                    <p className="mt-3 text-xs italic text-slate-500">{t('signInToContribute')}</p>
                  )}
                  {isMissionCreator && (
                    <p className="mt-3 text-xs text-slate-500">{t('crowdfundingOwnerWait')}</p>
                  )}
                </section>
              )}

              {showBidsSection && (
              <section className="border-t border-white/5 pt-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                    {t('bidsAndOffers')}
                  </h3>
                  {bidsLoading && (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-500/60 border-t-cyan-300" />
                  )}
                </div>
                {bidsError && <p className="mb-2 text-xs text-red-400">{bidsError}</p>}
                <ul className="max-h-52 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {missionBids.map((bid) => {
                    const displayName = bidWorkerDisplayName(bid);
                    const avatarUrl = bid.cleaner?.avatar_url;
                    const rating = bid.cleaner?.rating;

                    return (
                      <li
                        key={bid.id}
                        className="flex items-center gap-3 border-b border-white/5 py-3 last:border-b-0"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/5">
                          {avatarUrl ? (
                            <img
                              src={avatarUrl}
                              alt={displayName}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <span className="text-[10px] font-bold text-emerald-300">
                              {(displayName || 'E')[0]}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-white">{displayName}</p>
                          {typeof rating === 'number' && !Number.isNaN(rating) && (
                            <p className="text-[10px] font-medium text-amber-300">
                              {rating.toFixed(1)} ⭐
                            </p>
                          )}
                        </div>
                        <p className="shrink-0 text-sm font-black tabular-nums text-orange-300">
                          {formatWorkBudgetUsd(Number(bid.bid_amount))}
                        </p>
                        {isMissionCreator && bid.status === 'pending' && (
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => onAcceptBid(bid)}
                              className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/15 text-base transition-transform hover:bg-emerald-500/25 active:scale-95"
                              aria-label={t('acceptBidAria')}
                            >
                              ✅
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeclineBid(bid.id)}
                              className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500/15 text-base transition-transform hover:bg-red-500/25 active:scale-95"
                              aria-label={t('declineBidAria')}
                            >
                              ❌
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                  {!bidsLoading && missionBids.length === 0 && (
                    <li className="py-4 text-center text-xs italic text-slate-500">
                      {t('noBidsYet')}
                    </li>
                  )}
                </ul>

                {canPlaceBid && !isMissionCreator && (
                  <form
                    className="mt-4 flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const amount = parseIntegerUsdFromInput(bidInput);
                      if (amount <= 0) return;
                      onPlaceBid(amount);
                      setBidInput('');
                    }}
                  >
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      pattern="\d*"
                      value={bidInput}
                      onChange={(e) => setBidInput(sanitizeIntegerUsdDigits(e.target.value))}
                      placeholder={t('bidAmountLabelUsd')}
                      className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
                    />
                    <button
                      type="submit"
                      disabled={bidSubmitting || parseIntegerUsdFromInput(bidInput) <= 0}
                      className="shrink-0 rounded-xl border border-cyan-400/35 bg-cyan-600/90 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.14em] text-white transition-all hover:bg-cyan-500/95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {bidSubmitting ? t('processing') : t('placeBid')}
                    </button>
                  </form>
                )}
              </section>
              )}

              {isInProgress && assignedWorkerName && (
                <section className="border-t border-white/5 pt-4">
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                    {t('assignedWorkerLabel')}
                  </h3>
                  <div className="mt-3 flex items-center gap-3 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10">
                      {assignedWorker?.avatar_url ? (
                        <img
                          src={assignedWorker.avatar_url}
                          alt={assignedWorkerName}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-sm font-bold text-cyan-200">
                          {assignedWorkerName[0]}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{assignedWorkerName}</p>
                      {typeof assignedWorker?.rating === 'number' &&
                        !Number.isNaN(assignedWorker.rating) && (
                          <p className="text-[10px] font-medium text-amber-300">
                            {assignedWorker.rating.toFixed(1)} ⭐
                          </p>
                        )}
                      <p className="mt-1 text-xs text-cyan-100/90">
                        {t('assignedWorkerInProgress', { name: assignedWorkerName })}
                      </p>
                    </div>
                  </div>
                </section>
              )}

              <section className="border-t border-white/5 pt-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  GPS Integrity
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-slate-300">
                  {typeof mission.completion_distance_meters === 'number'
                    ? `Verification Distance at Completion: ${
                        mission.completion_distance_meters < 1000
                          ? `${Math.round(mission.completion_distance_meters)} m`
                          : `${(mission.completion_distance_meters / 1000).toFixed(2)} km`
                      }`
                    : gpsDistanceMeters != null
                      ? `Current distance to mission: ${
                          gpsDistanceMeters < 1000
                            ? `${Math.round(gpsDistanceMeters)} m`
                            : `${(gpsDistanceMeters / 1000).toFixed(2)} km`
                        }`
                      : gpsDistanceError || 'Calculating distance...'}
                </p>
                {typeof mission.completion_distance_meters === 'number' &&
                  mission.completion_distance_meters > 500 && (
                    <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-red-300">
                      ⚠ Verification distance &gt; 500m
                    </p>
                  )}
              </section>

              {mission.status === 'completed' ? (
                <div className="space-y-4 border-t border-white/5 pt-4">
                  <p className="text-sm font-semibold text-amber-200">{t('missionAccomplished')}</p>
                  <div className="w-full rounded-full animated-border-completed">
                    <button
                      type="button"
                      onClick={onViewPhotos}
                      className="animated-border-inner w-full rounded-full py-4 text-sm font-black uppercase tracking-[0.24em] text-white bg-[#020617] hover:brightness-110 transition-all active:scale-95"
                    >
                      {t('viewPhotos')}
                    </button>
                  </div>
                  {!!currentUserId &&
                    (mission.creator_id === currentUserId ||
                      mission.cleaner_id === currentUserId) &&
                    (mission.creator_id === currentUserId
                      ? mission.cleaner_id
                      : mission.creator_id) &&
                    !reviewedMissions.has(mission.id) && (
                      <div className="space-y-3 border-t border-white/5 pt-4">
                        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-300">
                          {mission.creator_id === currentUserId
                            ? t('rateTheCleaner')
                            : t('rateCreatorTitle', { defaultValue: 'Rate the client' })}
                        </p>
                        <p className="text-[11px] text-slate-300">{t('ratingHelpsReward')}</p>
                        <div className="flex items-center gap-2">
                          {[1, 2, 3, 4, 5].map((star) => {
                            const active = star <= selectedRating;
                            return (
                              <button
                                key={star}
                                type="button"
                                disabled={isSubmittingReview}
                                onClick={() => onSelectRating(star)}
                                className={`text-2xl transition-transform ${
                                  active ? 'scale-110 text-amber-300' : 'scale-100 text-slate-600'
                                } hover:scale-110`}
                              >
                                ⭐
                              </button>
                            );
                          })}
                        </div>
                        {selectedRating > 0 && (
                          <>
                            <textarea
                              value={reviewComment}
                              onChange={(e) => setReviewComment(e.target.value)}
                              maxLength={1000}
                              rows={2}
                              placeholder={t('reviewCommentPlaceholder', {
                                defaultValue: 'Leave a short comment (optional)',
                              })}
                              className="w-full resize-none rounded-xl border border-white/12 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-amber-400/50"
                            />
                            <button
                              type="button"
                              disabled={isSubmittingReview}
                              onClick={() => onSubmitReview(selectedRating, reviewComment)}
                              className="mt-2 w-full rounded-full bg-amber-500 py-2.5 text-[11px] font-black uppercase tracking-[0.18em] text-black hover:bg-amber-400 disabled:cursor-wait disabled:opacity-60"
                            >
                              {isSubmittingReview ? t('submitting') : t('submitRating')}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                </div>
              ) : mission.status === 'in_progress' && mission.cleaner_id !== currentUserId ? (
                <p className="border-t border-white/5 pt-4 text-sm font-semibold text-sky-200">
                  {t('workInProgress')}
                </p>
              ) : mission.status === 'in_progress' && mission.cleaner_id === currentUserId ? (
                <div className="border-t border-white/5 pt-4">
                  <div className="w-full rounded-full animated-border-city">
                    <button
                      type="button"
                      onClick={onStartWork}
                      className="animated-border-inner w-full rounded-full py-4 text-sm font-black uppercase tracking-[0.24em] text-white bg-[#020617] hover:brightness-110 transition-all active:scale-95"
                    >
                      {t('startWorkUploadProof')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 border-t border-white/5 pt-4">
                  <div className="flex items-center justify-between gap-4 py-1">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                      {t('serviceRequested')}
                    </span>
                    <span className="text-right text-sm font-semibold text-white">{serviceLabel}</span>
                  </div>

                  {isExecutorViewer && (
                    <div className="space-y-3">
                      {!workerHasActiveSubscription && !leadPhoneVisible && (
                        <div className="space-y-3 border-t border-white/5 pt-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-400">
                            {t('subscriptionGateTitle')}
                          </p>
                          <p className="text-xs leading-relaxed text-slate-300">
                            {t('subscriptionGateBody')}
                          </p>
                          <p className="text-lg font-black text-white">
                            {t('subscriptionGatePerYear', {
                              price: formatUsdPrice(YEARLY_SUBSCRIPTION.usd),
                            })}
                          </p>
                          <button
                            type="button"
                            onClick={onSubscribe}
                            className="flex min-h-[52px] w-full touch-manipulation items-center justify-center rounded-2xl border border-cyan-400/35 bg-cyan-600/90 px-4 text-[11px] font-bold uppercase tracking-[0.16em] text-white shadow-[0_4px_20px_rgba(34,211,238,0.35)] transition-all hover:bg-cyan-500/95 active:scale-[0.98]"
                          >
                            {t('subscribeToUnlock')}
                          </button>
                        </div>
                      )}

                      {workerHasActiveSubscription && !leadPhoneVisible && (
                        <button
                          type="button"
                          onClick={onUnlockLead}
                          disabled={unlockLeadLoading}
                          className="flex min-h-[52px] w-full touch-manipulation items-center justify-center rounded-2xl border border-cyan-400/35 bg-cyan-600/90 px-4 text-[11px] font-bold uppercase tracking-[0.16em] text-white shadow-[0_4px_20px_rgba(34,211,238,0.35)] transition-all hover:bg-cyan-500/95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {unlockLeadLoading ? t('processing') : t('unlockLead')}
                        </button>
                      )}

                      {leadPhoneVisible && unlockedLeadPhone && (
                        <div className="flex items-center justify-between gap-4 border-t border-white/5 pt-4">
                          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                            {t('contactCustomer')}
                          </span>
                          <span className="text-right text-sm font-black text-emerald-300 break-all">
                            {unlockedLeadPhone}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {isPlatformAdmin && onAdminDeleteMission && (
          <div className="border-t border-white/5 pt-4">
            <button
              type="button"
              onClick={onAdminDeleteMission}
              disabled={adminDeleteSubmitting}
              className="w-full rounded-full border border-red-500/50 bg-red-500/10 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-red-300 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {adminDeleteSubmitting ? t('processing') : t('adminDeleteMission')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default MissionBriefing;
