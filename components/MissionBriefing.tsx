/**
 * [[Architecture_Overview.md]]
 * Mission detail panel — bids, crowdfunding progress + Stripe contribute.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, EyeOff, MapPin, Pencil, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import TranslatableMissionDescription from './TranslatableMissionDescription';
import { useMissionTextTranslation } from '../src/hooks/useMissionTextTranslation';
import {
  missionFeedPlaceholderGradient,
  type MissionFeedPlaceholderVariant,
} from '../src/lib/missionFeedVisuals';
import {
  extractMissionFeedDescription,
  MISSION_SHORT_DESCRIPTION_MAX,
} from '../src/lib/missionDescription';
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
import { type MissionBidRow, bidWorkerDisplayName } from '../src/lib/missionBids';
import {
  createDefaultBidPackages,
  type BidOfferPackage,
} from '../src/lib/bidPackages';
import {
  LOCKED_PHONE_MASK,
  toTelHref,
  toWhatsAppHref,
} from '../src/lib/missionContact';
import { sanitizeIntegerUsdDigits, parseIntegerUsdFromInput } from '../src/lib/integerUsdInput';
import {
  isMissionEditableStatus,
  MAX_MISSION_PHOTOS,
  updateMissionDetails,
} from '../src/lib/updateMissionDetails';
import {
  convertReportToMission,
  isGarbageZoneReport,
} from '../src/lib/garbageZoneReport';
import { CITY_MIN_PRICE, BOTTOM_SHEET_MAX_HEIGHT_STYLE } from '../constants';
import MissionChatPanel from '../src/components/chat/MissionChatPanel';
import EcoHeroesRibbon from './EcoHeroesRibbon';
import ImpactCardModal from './ImpactCardModal';
import {
  StoreBundlesShowcase,
  StoreRecurrenceBadge,
  StoreSuppliesShowcase,
  recurrenceLabelKey,
} from './StoreShowcaseSections';
import {
  fetchContractorStore,
  fetchStoreSupplies,
  normalizeRecurrenceType,
  type ContractorStore,
  type RecurrenceType,
  type StoreSupply,
} from '../src/lib/contractorStore';

export type AssignedWorkerProfile = {
  full_name?: string | null;
  avatar_url?: string | null;
  rating?: number | null;
  telegram_username?: string | null;
};

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
  country?: string | null;
  city?: string | null;
  status: string;
  cleaner_id?: string | null;
  creator_id?: string | null;
  description?: string | null;
  photo_urls?: string[] | null;
  after_photo_urls?: string[] | null;
  completion_distance_meters?: number | null;
  is_report?: boolean | null;
  recurrence_type?: RecurrenceType | string | null;
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
  onAcceptBid: (bid: MissionBidRow, packageId?: string | null) => void;
  onDeclineBid: (bidId: string) => void;
  onPlaceBid: (
    amountUsd: number,
    offerPackages?: BidOfferPackage[] | null
  ) => void;
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
  /** Local mute — hide this author's pins from map/feed (not shown on own missions). */
  onMuteCreator?: (creatorId: string) => void;
  /** Open P2P chat with this user when the briefing mounts (e.g. from notification). */
  autoOpenChatWithUserId?: string | null;
  onAutoOpenChatConsumed?: () => void;
  /** After creator edits description / appends photos. */
  onMissionUpdated?: (patch: {
    id: string;
    description: string | null;
    photo_urls: string[] | null;
  }) => void;
  /** After any user converts a free report pin into funding/available. */
  onReportConverted?: (patch: {
    id: string;
    status: string;
    is_report: boolean;
    crowdfunding_mode: boolean;
    expected_price: number | null;
    amount_target: number | null;
    current_funding: number | null;
    crowdfunding_expires_at: string | null;
  }) => void;
};

function missionLocationLine(
  mission: MissionBriefingMission,
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
  const lat = Number(mission.location_lat);
  const lng = Number(mission.location_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return t('pinLocationLabel');
  const hub = closestMarketplaceCity(lat, lng);
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
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
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
  onMuteCreator,
  autoOpenChatWithUserId = null,
  onAutoOpenChatConsumed,
  onMissionUpdated,
  onReportConverted,
}) => {
  const { t } = useTranslation();
  const creatorInitial = String(creatorName || '?').trim().charAt(0).toUpperCase() || '?';
  const [bidInput, setBidInput] = React.useState('');
  const [useTieredOffers, setUseTieredOffers] = React.useState(false);
  const [offerPackages, setOfferPackages] = React.useState<BidOfferPackage[]>(
    () => createDefaultBidPackages(50, 75)
  );
  const [chatPeer, setChatPeer] = useState<{
    id: string;
    name?: string | null;
  } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editBody, setEditBody] = useState('');
  const [editFiles, setEditFiles] = useState<File[]>([]);
  const [editPreviews, setEditPreviews] = useState<string[]>([]);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertBudget, setConvertBudget] = useState('50');
  const [convertCrowdfund, setConvertCrowdfund] = useState(true);
  const [convertSubmitting, setConvertSubmitting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [impactOpen, setImpactOpen] = useState(false);
  const [cleanerStore, setCleanerStore] = useState<ContractorStore | null>(null);
  const [cleanerSupplies, setCleanerSupplies] = useState<StoreSupply[]>([]);

  useEffect(() => {
    const cleanerId = mission.cleaner_id ? String(mission.cleaner_id) : '';
    if (!cleanerId) {
      setCleanerStore(null);
      setCleanerSupplies([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const store = await fetchContractorStore(cleanerId);
        if (cancelled) return;
        if (store?.is_published) {
          setCleanerStore(store);
          try {
            setCleanerSupplies(await fetchStoreSupplies(store.id));
          } catch {
            if (!cancelled) setCleanerSupplies([]);
          }
        } else {
          setCleanerStore(null);
          setCleanerSupplies([]);
        }
      } catch (err) {
        console.warn('MissionBriefing cleaner store load failed', err);
        if (!cancelled) {
          setCleanerStore(null);
          setCleanerSupplies([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mission.cleaner_id]);

  const missionRecurrence = normalizeRecurrenceType(mission.recurrence_type);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const photos = (mission?.photo_urls ?? []).filter(
    (u): u is string => typeof u === 'string' && u.length > 0
  );
  const placeholderVariant = placeholderVariantFor(mission);
  const isReportPin = isGarbageZoneReport(mission);
  const placeholderIcon = missionPinIcon(
    mission?.service_type,
    mission?.category,
    isReportPin
  );
  const feedDescription = extractMissionFeedDescription(mission?.description);
  const canEditMission =
    isMissionCreator &&
    !!currentUserId &&
    currentUserId === mission.creator_id &&
    isMissionEditableStatus(mission.status);
  const photoSlotsLeft = Math.max(0, MAX_MISSION_PHOTOS - photos.length - editFiles.length);
  const locationSource = missionLocationLine(mission, t);
  const locationTranslation = useMissionTextTranslation(locationSource);
  const budgetValue = formatWorkBudgetUsd(missionWorkBudgetUsd(mission));
  const isInProgress = String(mission?.status || '').toLowerCase() === 'in_progress';
  const isCompletedStatus = ['completed', 'finished'].includes(
    String(mission?.status || '').toLowerCase()
  );
  const isFundingStatus = String(mission.status || '').toLowerCase() === 'funding';
  const acceptedFundingBid = missionBids.find(
    (b) => String(b.status || '').toLowerCase() === 'accepted'
  );
  const hasPreselectedCleanerDuringFunding =
    isFundingStatus && (!!mission.cleaner_id || !!acceptedFundingBid);
  const showBidsSection =
    !isReportPin &&
    !isInProgress &&
    (isMissionCreator || canPlaceBid || missionBids.length > 0 || bidsLoading);
  const crowdfundingOpen = isCrowdfundingOpen(mission);
  const isCrowdfundingMissionFlag = !!mission.crowdfunding_mode;
  const fundedUsd = Math.max(0, Math.floor(Number(mission.current_funding ?? 0)));
  const targetUsd = Math.max(0, Math.floor(Number(mission.expected_price ?? 0)));
  const fundingPct =
    targetUsd > 0 ? Math.min(100, Math.round((fundedUsd / targetUsd) * 100)) : 0;

  const revealedPhone =
    leadPhoneVisible && unlockedLeadPhone?.trim() ? unlockedLeadPhone.trim() : null;
  const telHref = useMemo(
    () => (revealedPhone ? toTelHref(revealedPhone) : ''),
    [revealedPhone]
  );
  const whatsappHref = useMemo(
    () => (revealedPhone ? toWhatsAppHref(revealedPhone) : null),
    [revealedPhone]
  );

  const isAssignedCleaner =
    !!currentUserId && !!mission.cleaner_id && mission.cleaner_id === currentUserId;
  const hasAcceptedBid =
    !!currentUserId &&
    missionBids.some(
      (b) =>
        b.cleaner_id === currentUserId &&
        String(b.status || '').toLowerCase() === 'accepted'
    );
  const hasPendingBid =
    !!currentUserId &&
    missionBids.some(
      (b) =>
        b.cleaner_id === currentUserId &&
        ['pending', 'active'].includes(String(b.status || '').toLowerCase())
    );
  const canWorkerChat =
    !!currentUserId &&
    !!mission.creator_id &&
    mission.creator_id !== currentUserId &&
    (isAssignedCleaner || hasAcceptedBid || hasPendingBid);
  const contactUnlocked = isAssignedCleaner || hasAcceptedBid || !!revealedPhone;
  /** Private missions: show contact panel to workers (role cleaner OR contracted). */
  const showWorkerContactPanel =
    !isCrowdfundingMissionFlag &&
    !!currentUserId &&
    (isExecutorViewer || contactUnlocked || isAssignedCleaner);

  const openWorkerClientChat = () => {
    if (!mission.creator_id) return;
    setChatPeer({
      id: mission.creator_id,
      name: creatorName,
    });
  };

  const closeEditModal = () => {
    editPreviews.forEach((url) => URL.revokeObjectURL(url));
    setEditOpen(false);
    setEditBody('');
    setEditFiles([]);
    setEditPreviews([]);
    setEditError(null);
    setEditSubmitting(false);
  };

  const openEditModal = () => {
    editPreviews.forEach((url) => URL.revokeObjectURL(url));
    setEditBody(feedDescription || '');
    setEditFiles([]);
    setEditPreviews([]);
    setEditError(null);
    setEditOpen(true);
  };

  const onPickEditPhotos = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const incoming = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    const room = Math.max(0, MAX_MISSION_PHOTOS - photos.length - editFiles.length);
    const nextFiles = [...editFiles, ...incoming.slice(0, room)];
    editPreviews.forEach((url) => URL.revokeObjectURL(url));
    setEditFiles(nextFiles);
    setEditPreviews(nextFiles.map((f) => URL.createObjectURL(f)));
    setEditError(null);
  };

  const saveMissionEdits = async () => {
    if (editSubmitting) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      const result = await updateMissionDetails({
        missionId: mission.id,
        currentDescription: mission.description,
        currentPhotoUrls: mission.photo_urls,
        nextBodyText: editBody,
        newPhotoFiles: editFiles,
      });
      onMissionUpdated?.({
        id: mission.id,
        description: result.description,
        photo_urls: result.photo_urls,
      });
      closeEditModal();
    } catch (err: any) {
      setEditError(
        err?.message ||
          t('missionUpdateFailed', { defaultValue: 'Could not update mission.' })
      );
    } finally {
      setEditSubmitting(false);
    }
  };

  const submitReportConversion = async () => {
    if (convertSubmitting) return;
    if (!currentUserId) {
      setConvertError(t('signInToContribute', { defaultValue: 'Sign in to continue.' }));
      return;
    }
    const amount = parseIntegerUsdFromInput(convertBudget);
    if (amount < CITY_MIN_PRICE) {
      setConvertError(
        t('cityPriceRangeUsd', {
          min: CITY_MIN_PRICE,
          max: 10000,
          defaultValue: `Budget must be at least $${CITY_MIN_PRICE}`,
        })
      );
      return;
    }
    setConvertSubmitting(true);
    setConvertError(null);
    try {
      const row = await convertReportToMission({
        missionId: mission.id,
        expectedPriceUsd: amount,
        crowdfundingMode: convertCrowdfund,
      });
      onReportConverted?.({
        id: row.id,
        status: row.status,
        is_report: !!row.is_report,
        crowdfunding_mode: !!row.crowdfunding_mode,
        expected_price: row.expected_price,
        amount_target: row.amount_target,
        current_funding: row.current_funding,
        crowdfunding_expires_at: row.crowdfunding_expires_at,
      });
      setConvertOpen(false);
    } catch (err: any) {
      setConvertError(
        err?.message ||
          t('reportZoneConvertFailed', { defaultValue: 'Could not convert this report.' })
      );
    } finally {
      setConvertSubmitting(false);
    }
  };

  const workerChatButton = canWorkerChat ? (
    <button
      type="button"
      onClick={openWorkerClientChat}
      className="flex min-h-[48px] w-full touch-manipulation items-center justify-center gap-2 rounded-2xl border border-violet-400/40 bg-violet-600/85 px-4 text-[11px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_4px_16px_rgba(139,92,246,0.28)] transition-all hover:bg-violet-500/95 active:scale-[0.98]"
    >
      <span aria-hidden>💬</span>
      {t('missionChatWithClient', { defaultValue: 'Chat with Client' })}
    </button>
  ) : null;

  const [reviewComment, setReviewComment] = useState('');
  const [fundingNowMs, setFundingNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!crowdfundingOpen) return;
    setFundingNowMs(Date.now());
    const id = window.setInterval(() => setFundingNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [crowdfundingOpen, mission.id, mission.crowdfunding_expires_at]);

  // Prefill proposed USD price with campaign target (worker may raise or lower).
  useEffect(() => {
    if (!canPlaceBid) return;
    const target = Math.floor(Number(mission.expected_price ?? 0));
    if (target >= 1) setBidInput(String(target));
  }, [canPlaceBid, mission.id, mission.expected_price]);

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

  useEffect(() => {
    const peerId = autoOpenChatWithUserId?.trim();
    if (!peerId || !mission.id) return;
    if (peerId === currentUserId) {
      onAutoOpenChatConsumed?.();
      return;
    }
    const bidMatch = missionBids.find((b) => b.cleaner_id === peerId);
    const peerName =
      peerId === mission.creator_id
        ? creatorName
        : peerId === mission.cleaner_id
          ? assignedWorkerName
          : bidMatch
            ? bidWorkerDisplayName(bidMatch)
            : null;
    setChatPeer({ id: peerId, name: peerName });
    onAutoOpenChatConsumed?.();
  }, [
    autoOpenChatWithUserId,
    mission.id,
    mission.creator_id,
    mission.cleaner_id,
    currentUserId,
    creatorName,
    assignedWorkerName,
    missionBids,
    onAutoOpenChatConsumed,
  ]);

  const isOwnActive = isInProgress && mission.cleaner_id === currentUserId;
  const statusLabel = isReportPin
    ? t('reportZoneBadge', { defaultValue: 'Reported Zone' })
    : String(mission?.status || '').replace(/_/g, ' ');
  const statusBadgeTone = isReportPin
    ? 'border-rose-400/55 bg-rose-500/25 text-rose-100'
    : statusBadgeClass(String(mission?.status || ''));

  const workerContactPanel =
    showWorkerContactPanel ? (
      <div className="space-y-3">
        {workerChatButton}
        {revealedPhone ? (
          <>
            <div className="flex items-center justify-between gap-4">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                {t('contactCustomer')}
              </span>
              {telHref ? (
                <a
                  href={telHref}
                  className="text-right text-sm font-black text-emerald-300 break-all underline-offset-2 hover:underline"
                >
                  {revealedPhone}
                </a>
              ) : (
                <span className="text-right text-sm font-black text-emerald-300 break-all">
                  {revealedPhone}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              {telHref ? (
                <a
                  href={telHref}
                  className="flex min-h-[48px] flex-1 touch-manipulation items-center justify-center gap-1.5 rounded-2xl border border-emerald-400/35 bg-emerald-600/90 px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_4px_16px_rgba(16,185,129,0.25)]"
                >
                  <span aria-hidden>📞</span>
                  {t('callClient')}
                </a>
              ) : null}
              {whatsappHref ? (
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-[48px] flex-1 touch-manipulation items-center justify-center gap-1.5 rounded-2xl border border-cyan-400/35 bg-cyan-600/90 px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_4px_16px_rgba(34,211,238,0.25)]"
                >
                  <span aria-hidden>💬</span>
                  WhatsApp
                </a>
              ) : null}
            </div>
          </>
        ) : contactUnlocked && !unlockLeadLoading ? (
          <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-[11px] font-semibold text-slate-400">
            {t('contactUnavailable')}
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                {t('contactCustomer')}
              </span>
              <span className="font-mono text-sm text-slate-500">{LOCKED_PHONE_MASK}</span>
            </div>
            <p className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2.5 text-[11px] font-semibold leading-relaxed text-amber-100/90">
              {unlockLeadLoading
                ? t('processing')
                : `🔒 ${t('phoneLockedUntilBidAccepted')}`}
            </p>
            {!workerHasActiveSubscription && !contactUnlocked && (
              <button
                type="button"
                onClick={onSubscribe}
                className="flex min-h-[44px] w-full touch-manipulation items-center justify-center rounded-2xl border border-cyan-400/35 bg-cyan-600/90 px-4 text-[10px] font-bold uppercase tracking-[0.14em] text-white"
              >
                {t('subscribeToUnlock')}
              </button>
            )}
          </>
        )}
      </div>
    ) : workerChatButton ? (
      <div className="space-y-3">{workerChatButton}</div>
    ) : null;

  return (
    <>
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
        className="ce-bottom-sheet glass-panel relative z-[10030] flex w-full max-w-xl flex-col overflow-hidden rounded-t-3xl pointer-events-auto shadow-[0_-10px_40px_rgba(0,229,255,0.12)]"
        onClick={(e) => e.stopPropagation()}
        style={{
          ...BOTTOM_SHEET_MAX_HEIGHT_STYLE,
          transform: sheetDragY > 0 ? `translateY(${sheetDragY}px)` : undefined,
        }}
      >
        <div
          className="z-20 flex shrink-0 justify-center bg-gradient-to-b from-slate-950 via-slate-950/90 to-transparent pb-1 pt-2"
          onTouchStart={onSheetTouchStart}
          onTouchMove={onSheetTouchMove}
          onTouchEnd={onSheetTouchEnd}
        >
          <div className="h-1.5 w-14 rounded-full bg-white/20" aria-hidden />
        </div>

        <div className="ce-bottom-sheet-body scrollable-sheet-content min-h-0 flex-1 touch-pan-y [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
        {booting ? (
          <div className="flex flex-col items-center justify-center px-5 py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-500/60 border-t-cyan-200" />
            <p className="mt-3 text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
              {t('loading')}
            </p>
          </div>
        ) : (
          <>
            {/* Immersive magazine hero — kept short on mobile so CTAs stay reachable */}
            <div className="relative w-full shrink-0 overflow-hidden bg-slate-900 min-h-[min(38svh,16rem)] sm:min-h-[22rem]">
              <div className="absolute inset-0">
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
              </div>

              {/* Seamless fade into drawer `bg-slate-950` (#020617) before Bids */}
              <div
                className="pointer-events-none absolute inset-0 z-[5] bg-gradient-to-t from-[#020617] via-[#020617]/90 from-0% via-35% to-transparent to-75%"
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
                {isReportPin ? (
                  <span className="rounded-full border border-rose-400/55 bg-rose-500/30 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-rose-100 backdrop-blur-sm">
                    {t('reportZoneBadge', { defaultValue: 'Reported Zone' })}
                  </span>
                ) : (
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] backdrop-blur-sm ${
                      placeholderVariant === 'home'
                        ? 'border-amber-400/50 bg-amber-500/25 text-amber-100'
                        : 'border-emerald-400/50 bg-emerald-500/25 text-emerald-100'
                    }`}
                  >
                    {placeholderVariant === 'home' ? t('homeCleaning') : t('cityCleaning')}
                  </span>
                )}
                {isOwnActive && (
                  <span className="rounded-full border border-sky-400/50 bg-sky-500/25 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-sky-100 backdrop-blur-sm">
                    {t('yourActiveMission')}
                  </span>
                )}
                {missionRecurrence !== 'one_time' && (
                  <span className="rounded-full border border-fuchsia-400/50 bg-fuchsia-500/25 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-fuchsia-100 backdrop-blur-sm">
                    {t(recurrenceLabelKey(missionRecurrence), {
                      defaultValue: missionRecurrence,
                    })}
                  </span>
                )}
              </div>

              {/* Editorial stack over the fade — price overlays preserved; status + copy sit on top */}
              <div className="pointer-events-none relative z-10 flex min-h-[min(38vh,16rem)] flex-col justify-end sm:min-h-[22rem]">
                <div className="relative px-4 pb-3 pt-24">
                  <div
                    className={
                      onCreatorClick || (onMuteCreator && !isMissionCreator && mission.creator_id)
                        ? 'pr-36'
                        : ''
                    }
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

                  {(onCreatorClick ||
                    (onMuteCreator && !isMissionCreator && !!mission.creator_id)) && (
                    <div className="pointer-events-auto absolute bottom-3 right-3 z-30 flex max-w-[min(100%,14rem)] items-center gap-1.5">
                      {onMuteCreator && !isMissionCreator && mission.creator_id && (
                        <button
                          type="button"
                          onClick={() => onMuteCreator(String(mission.creator_id))}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-rose-400/40 bg-black/60 text-rose-200 shadow-lg backdrop-blur-md transition-transform hover:border-rose-300/70 hover:bg-rose-500/20 active:scale-95"
                          aria-label={t('muteCreatorAction', {
                            defaultValue: 'Hide creator',
                          })}
                          title={t('muteCreatorAction', { defaultValue: 'Hide creator' })}
                        >
                          <EyeOff className="h-4 w-4" strokeWidth={2.25} aria-hidden />
                        </button>
                      )}
                      {onCreatorClick && (
                        <button
                          type="button"
                          onClick={onCreatorClick}
                          className="flex min-w-0 items-center gap-2 rounded-full border border-emerald-300/50 bg-black/55 py-1 pl-1 pr-2.5 text-emerald-100 shadow-lg backdrop-blur-md transition-transform hover:border-emerald-200/80 active:scale-95"
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
                  )}
                </div>

                <div className="pointer-events-auto relative z-10 space-y-3 px-5 pb-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] backdrop-blur-sm ${statusBadgeTone}`}
                    >
                      {t('status')}: {statusLabel}
                    </span>
                    <span className="text-[10px] font-medium text-slate-200/90 drop-shadow-sm">
                      {isReportPin
                        ? t('reportZoneFreeLabel', { defaultValue: 'Free civic report' })
                        : `${t('missionTokenBidLabel')}: ${formatTokens(missionTokenBid(mission))}`}
                    </span>
                    {activeBidCount > 0 && (
                      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-sky-300 drop-shadow-sm">
                        {t('activeBidsOnMission')}
                      </span>
                    )}
                    {canEditMission && (
                      <button
                        type="button"
                        onClick={openEditModal}
                        className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/35 bg-black/50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.18)] backdrop-blur-md transition-transform hover:border-cyan-300/55 hover:bg-black/65 active:scale-95"
                      >
                        <Pencil className="h-3 w-3" strokeWidth={2.5} aria-hidden />
                        {t('edit')}
                      </button>
                    )}
                  </div>

                  {feedDescription && (
                    <section>
                      <TranslatableMissionDescription
                        text={feedDescription}
                        autoTranslate
                        showTranslateButton
                        clampClassName=""
                        className="text-sm font-medium leading-relaxed text-slate-100 drop-shadow-[0_1px_8px_rgba(0,0,0,0.65)]"
                      />
                    </section>
                  )}

                  {canEditMission && !feedDescription && (
                    <button
                      type="button"
                      onClick={openEditModal}
                      className="text-left text-xs font-medium text-cyan-300/90 underline-offset-2 hover:underline"
                    >
                      {t('editMissionAddDetails', {
                        defaultValue: 'Add description or photos',
                      })}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="relative z-[1] space-y-5 bg-[#020617] px-5 pt-1 pb-1">
              {isReportPin && (
                <section className="border-t border-white/5 pt-4">
                  <p className="text-[11px] leading-relaxed text-slate-300">
                    {t('reportZoneBridgeHint', {
                      defaultValue:
                        'Civic report — free. Launch crowdfunding or set a bounty so cleaners can take it on.',
                    })}
                  </p>
                  {currentUserId ? (
                    <button
                      type="button"
                      onClick={() => {
                        setConvertBudget(String(Math.max(CITY_MIN_PRICE, 50)));
                        setConvertCrowdfund(true);
                        setConvertError(null);
                        setConvertOpen(true);
                      }}
                      className="mt-3 w-full rounded-full border border-amber-400/50 bg-gradient-to-r from-amber-500/90 to-rose-500/90 py-3.5 text-[11px] font-black uppercase tracking-[0.16em] text-slate-950 shadow-[0_0_24px_rgba(251,191,36,0.35)] transition-transform active:scale-[0.98]"
                    >
                      {t('reportZoneConvertCta', {
                        defaultValue: '🚀 Launch Crowdfunding / Set bounty',
                      })}
                    </button>
                  ) : (
                    <p className="mt-3 text-xs italic text-slate-500">
                      {t('signInToContribute', {
                        defaultValue: 'Sign in to convert this report.',
                      })}
                    </p>
                  )}
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
                  {hasPreselectedCleanerDuringFunding && (
                    <p className="mt-2 rounded-xl border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-[11px] font-semibold leading-relaxed text-violet-100/95">
                      {t('selectedCleanerWaitingFunds', {
                        defaultValue:
                          'Selected Cleaner — waiting for remaining funds',
                      })}
                    </p>
                  )}
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-amber-400/80 transition-all"
                      style={{ width: `${fundingPct}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[10px] font-bold tabular-nums text-amber-200/90">
                    {fundingPct}%
                  </p>

                  <EcoHeroesRibbon
                    missionId={mission.id}
                    refreshKey={`${fundedUsd}-${mission.crowdfunding_expires_at ?? ''}`}
                  />

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
                <ul className="max-h-72 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {missionBids.map((bid) => {
                    const displayName = bidWorkerDisplayName(bid);
                    const avatarUrl = bid.cleaner?.avatar_url;
                    const rating = bid.cleaner?.rating;
                    const bidStatus = String(bid.status || '').toLowerCase();
                    const isAcceptedBid = bidStatus === 'accepted';
                    const packages = bid.offer_packages ?? [];
                    const showWaitingFundsBadge =
                      isAcceptedBid && hasPreselectedCleanerDuringFunding;
                    const canChatWithBidder =
                      isMissionCreator &&
                      !!bid.cleaner_id &&
                      (bidStatus === 'pending' || bidStatus === 'accepted');
                    const canAcceptOrDecline =
                      isMissionCreator &&
                      bidStatus === 'pending' &&
                      !mission.cleaner_id &&
                      !acceptedFundingBid;

                    return (
                      <li
                        key={bid.id}
                        className="border-b border-white/5 py-3 last:border-b-0"
                      >
                        <div className="flex items-center gap-3">
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
                            <p className="truncate text-sm font-semibold text-white">
                              {displayName}
                            </p>
                            {typeof rating === 'number' && !Number.isNaN(rating) && (
                              <p className="text-[10px] font-medium text-amber-300">
                                {rating.toFixed(1)} ⭐
                              </p>
                            )}
                          </div>
                          {packages.length === 0 && (
                            <p className="shrink-0 text-sm font-black tabular-nums text-orange-300">
                              {formatWorkBudgetUsd(Number(bid.bid_amount))}
                            </p>
                          )}
                          {canChatWithBidder && (
                            <button
                              type="button"
                              onClick={() =>
                                setChatPeer({ id: bid.cleaner_id, name: displayName })
                              }
                              className="shrink-0 rounded-full border border-violet-400/35 bg-violet-600/80 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-white transition-transform hover:bg-violet-500/90 active:scale-95"
                              aria-label={t('missionChatOpen', { defaultValue: 'Chat' })}
                            >
                              💬 {t('missionChatOpen', { defaultValue: 'Chat' })}
                            </button>
                          )}
                          {canAcceptOrDecline && packages.length === 0 && (
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
                          {canAcceptOrDecline && packages.length > 0 && (
                            <button
                              type="button"
                              onClick={() => onDeclineBid(bid.id)}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-base"
                              aria-label={t('declineBidAria')}
                            >
                              ❌
                            </button>
                          )}
                        </div>

                        {packages.length > 0 && (
                          <div className="mt-2 space-y-2 pl-12">
                            <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">
                              {t('bidPackagesLabel', {
                                defaultValue: 'Tiered offers',
                              })}
                            </p>
                            {packages.map((pkg) => {
                              const isSelected =
                                isAcceptedBid &&
                                bid.selected_package_id === pkg.id;
                              return (
                                <div
                                  key={pkg.id}
                                  className={`rounded-xl border px-3 py-2 ${
                                    isSelected
                                      ? 'border-emerald-400/50 bg-emerald-500/15'
                                      : 'border-white/10 bg-white/5'
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="text-xs font-bold text-white">
                                        {pkg.title}
                                      </p>
                                      {pkg.description && (
                                        <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
                                          {pkg.description}
                                        </p>
                                      )}
                                      <p
                                        className={`mt-1 text-[9px] font-black uppercase tracking-[0.12em] ${
                                          pkg.includes_supplies
                                            ? 'text-cyan-300'
                                            : 'text-slate-400'
                                        }`}
                                      >
                                        {pkg.includes_supplies
                                          ? t('bidPackageAllInclusive', {
                                              defaultValue: 'All-inclusive supplies',
                                            })
                                          : t('bidPackageCustomerSupplies', {
                                              defaultValue: 'Customer supplies',
                                            })}
                                      </p>
                                    </div>
                                    <p className="shrink-0 text-sm font-black tabular-nums text-orange-300">
                                      {formatWorkBudgetUsd(pkg.price)}
                                    </p>
                                  </div>
                                  {canAcceptOrDecline && (
                                    <button
                                      type="button"
                                      onClick={() => onAcceptBid(bid, pkg.id)}
                                      className="mt-2 w-full rounded-full border border-emerald-400/45 bg-emerald-500/20 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-50"
                                    >
                                      {t('acceptPackageOffer', {
                                        defaultValue: 'Accept this package',
                                      })}
                                    </button>
                                  )}
                                  {isSelected && (
                                    <p className="mt-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-300">
                                      {t('packageAcceptedBadge', {
                                        defaultValue: 'Accepted package',
                                      })}
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {showWaitingFundsBadge && (
                          <p className="mt-2 rounded-lg border border-violet-400/25 bg-violet-500/10 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-violet-200">
                            {t('selectedCleanerWaitingFunds', {
                              defaultValue:
                                'Selected Cleaner — waiting for remaining funds',
                            })}
                          </p>
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
                    className="mt-4 space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (useTieredOffers) {
                        const pkgs = offerPackages.filter(
                          (p) => p.title.trim() && p.price >= 1
                        );
                        if (pkgs.length === 0) return;
                        const minPrice = Math.min(...pkgs.map((p) => p.price));
                        onPlaceBid(minPrice, pkgs);
                        return;
                      }
                      const amount = parseIntegerUsdFromInput(bidInput);
                      if (amount <= 0) return;
                      onPlaceBid(amount, null);
                    }}
                  >
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-violet-400/25 bg-violet-500/10 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={useTieredOffers}
                        onChange={(e) => {
                          setUseTieredOffers(e.target.checked);
                          if (e.target.checked) {
                            const base = parseIntegerUsdFromInput(bidInput) || 50;
                            setOfferPackages(
                              createDefaultBidPackages(base, Math.ceil(base * 1.35))
                            );
                          }
                        }}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-violet-400/50 bg-black/40 text-violet-400"
                      />
                      <span className="min-w-0">
                        <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-violet-200">
                          {t('bidTieredOffersToggle', {
                            defaultValue: 'Attach tiered packages',
                          })}
                        </span>
                        <span className="mt-1 block text-[11px] leading-snug text-slate-400">
                          {t('bidTieredOffersHint', {
                            defaultValue:
                              'Option A = basic labor · Option B = all-inclusive with your store supplies.',
                          })}
                        </span>
                      </span>
                    </label>

                    {!useTieredOffers ? (
                      <>
                        <label className="block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                          {t('proposeYourPriceUsd', {
                            defaultValue: 'Your proposed price (USD)',
                          })}
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            pattern="\d*"
                            value={bidInput}
                            onChange={(e) =>
                              setBidInput(sanitizeIntegerUsdDigits(e.target.value))
                            }
                            placeholder={t('bidAmountLabelUsd')}
                            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
                          />
                          <button
                            type="submit"
                            disabled={
                              bidSubmitting ||
                              parseIntegerUsdFromInput(bidInput) <= 0
                            }
                            className="shrink-0 rounded-xl border border-cyan-400/35 bg-cyan-600/90 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.14em] text-white transition-all hover:bg-cyan-500/95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {bidSubmitting ? t('processing') : t('placeBid')}
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="space-y-2">
                        {offerPackages.map((pkg, idx) => (
                          <div
                            key={pkg.id}
                            className="space-y-1.5 rounded-xl border border-violet-400/25 bg-violet-500/5 p-3"
                          >
                            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-200">
                              {pkg.tier === 'all_inclusive'
                                ? t('bidPackageOptionB', {
                                    defaultValue: 'Option B — All-inclusive',
                                  })
                                : t('bidPackageOptionA', {
                                    defaultValue: 'Option A — Basic labor',
                                  })}
                            </p>
                            <input
                              type="text"
                              value={pkg.title}
                              onChange={(e) =>
                                setOfferPackages((prev) =>
                                  prev.map((p, i) =>
                                    i === idx
                                      ? { ...p, title: e.target.value }
                                      : p
                                  )
                                )
                              }
                              className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-white outline-none focus:border-violet-400/40"
                            />
                            <textarea
                              value={pkg.description}
                              rows={2}
                              onChange={(e) =>
                                setOfferPackages((prev) =>
                                  prev.map((p, i) =>
                                    i === idx
                                      ? { ...p, description: e.target.value }
                                      : p
                                  )
                                )
                              }
                              className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-white outline-none focus:border-violet-400/40"
                            />
                            <input
                              type="number"
                              min={1}
                              step={1}
                              value={pkg.price || ''}
                              onChange={(e) =>
                                setOfferPackages((prev) =>
                                  prev.map((p, i) =>
                                    i === idx
                                      ? {
                                          ...p,
                                          price: Math.max(
                                            1,
                                            Math.floor(Number(e.target.value) || 0)
                                          ),
                                        }
                                      : p
                                  )
                                )
                              }
                              placeholder={t('bidAmountLabelUsd')}
                              className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-violet-400/40"
                            />
                          </div>
                        ))}
                        <button
                          type="submit"
                          disabled={
                            bidSubmitting ||
                            offerPackages.every(
                              (p) => !p.title.trim() || p.price < 1
                            )
                          }
                          className="w-full rounded-xl border border-cyan-400/35 bg-cyan-600/90 py-2.5 text-[10px] font-black uppercase tracking-[0.14em] text-white disabled:opacity-50"
                        >
                          {bidSubmitting
                            ? t('processing')
                            : t('placeTieredBid', {
                                defaultValue: 'Submit packaged offers',
                              })}
                        </button>
                      </div>
                    )}
                    {isCrowdfundingMissionFlag && (
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-300/90">
                        {t('bidCostsOneToken', {
                          defaultValue: 'Costs 1 Token to place this bid',
                        })}
                      </p>
                    )}
                    {crowdfundingOpen && targetUsd > 0 && (
                      <p className="text-[10px] text-slate-500">
                        {t('crowdBidVsTargetHint', {
                          defaultValue:
                            'Campaign target: {{target}}. You may bid higher or lower.',
                          target: formatWorkBudgetUsd(targetUsd),
                        })}
                      </p>
                    )}
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
                  {isMissionCreator && mission.cleaner_id && (
                    <button
                      type="button"
                      onClick={() =>
                        setChatPeer({
                          id: mission.cleaner_id as string,
                          name: assignedWorkerName,
                        })
                      }
                      className="mt-3 flex min-h-[44px] w-full touch-manipulation items-center justify-center gap-2 rounded-2xl border border-violet-400/40 bg-violet-600/85 px-4 text-[11px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_4px_16px_rgba(139,92,246,0.28)] transition-all hover:bg-violet-500/95 active:scale-[0.98]"
                    >
                      <span aria-hidden>💬</span>
                      {t('missionChatWithWorker', { defaultValue: 'Chat with Worker' })}
                    </button>
                  )}
                </section>
              )}

              <section className="border-t border-white/5 pt-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  GPS Integrity
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-slate-300">
                  {typeof mission?.completion_distance_meters === 'number' &&
                  Number.isFinite(mission.completion_distance_meters)
                    ? `Verification Distance at Completion: ${
                        mission.completion_distance_meters < 1000
                          ? `${Math.round(mission.completion_distance_meters)} m`
                          : `${(mission.completion_distance_meters / 1000).toFixed(2)} km`
                      }`
                    : typeof gpsDistanceMeters === 'number' && Number.isFinite(gpsDistanceMeters)
                      ? `Current distance to mission: ${
                          gpsDistanceMeters < 1000
                            ? `${Math.round(gpsDistanceMeters)} m`
                            : `${(gpsDistanceMeters / 1000).toFixed(2)} km`
                        }`
                      : gpsDistanceError || 'Calculating distance...'}
                </p>
                {typeof mission?.completion_distance_meters === 'number' &&
                  Number.isFinite(mission.completion_distance_meters) &&
                  mission.completion_distance_meters > 500 && (
                    <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-red-300">
                      ⚠ Verification distance &gt; 500m
                    </p>
                  )}
              </section>
            </div>
          </>
        )}
        </div>

        {!booting && (
          <div className="ce-bottom-sheet-footer shrink-0 px-5 pt-3">
              {isCompletedStatus ? (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-amber-200">{t('missionAccomplished')}</p>
                  <div className="w-full rounded-full animated-border-completed">
                    <button
                      type="button"
                      onClick={onViewPhotos}
                      className="animated-border-inner w-full rounded-full bg-[#020617] py-4 text-sm font-black uppercase tracking-[0.24em] text-white transition-all hover:brightness-110 active:scale-95"
                    >
                      {t('viewPhotos')}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setImpactOpen(true)}
                    className="w-full rounded-full border border-cyan-400/50 bg-cyan-500/15 py-3.5 text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100 shadow-[0_0_22px_rgba(34,211,238,0.28)] transition-transform hover:bg-cyan-500/25 active:scale-[0.98]"
                  >
                    {t('impactCardCta', { defaultValue: '🏆 Share Impact Card' })}
                  </button>
                  {!!currentUserId &&
                    (mission.creator_id === currentUserId ||
                      mission.cleaner_id === currentUserId) &&
                    (mission.creator_id === currentUserId
                      ? mission.cleaner_id
                      : mission.creator_id) &&
                    !reviewedMissions.has(mission.id) && (
                      <div className="space-y-3 border-t border-white/5 pt-3">
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
                <p className="text-sm font-semibold text-sky-200">
                  {t('workInProgress')}
                </p>
              ) : mission.status === 'in_progress' && mission.cleaner_id === currentUserId ? (
                <div className="space-y-3">
                  {workerContactPanel}
                  <div className="w-full rounded-full animated-border-city">
                    <button
                      type="button"
                      onClick={onStartWork}
                      className="animated-border-inner w-full rounded-full bg-[#020617] py-4 text-sm font-black uppercase tracking-[0.24em] text-white transition-all hover:brightness-110 active:scale-95"
                    >
                      {t('startWorkUploadProof')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4 py-1">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                      {t('serviceRequested')}
                    </span>
                    <span className="text-right text-sm font-semibold text-white">{serviceLabel}</span>
                  </div>

                  {missionRecurrence !== 'one_time' && (
                    <p className="rounded-xl border border-fuchsia-400/25 bg-fuchsia-500/10 px-3 py-2 text-[11px] font-semibold text-fuchsia-100">
                      {t('missionRecurrenceRequest', {
                        defaultValue: 'Recurring request: {{cadence}}',
                        cadence: t(recurrenceLabelKey(missionRecurrence), {
                          defaultValue: missionRecurrence,
                        }),
                      })}
                    </p>
                  )}

                  {cleanerStore &&
                    (cleanerStore.service_bundles.length > 0 ||
                      cleanerSupplies.length > 0 ||
                      cleanerStore.supported_recurrence_types.some(
                        (r) => r !== 'one_time'
                      )) && (
                      <section className="space-y-3 rounded-xl border border-emerald-400/20 bg-emerald-500/5 p-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-200/90">
                          {t('missionCleanerStoreShowcase', {
                            defaultValue: 'Assigned contractor store',
                          })}
                        </p>
                        <StoreRecurrenceBadge
                          supported={cleanerStore.supported_recurrence_types}
                          primary={cleanerStore.recurrence_type}
                        />
                        <StoreBundlesShowcase bundles={cleanerStore.service_bundles} />
                        <StoreSuppliesShowcase supplies={cleanerSupplies} compact />
                      </section>
                    )}

                  {workerContactPanel}
                  {isExecutorViewer && isCrowdfundingMissionFlag && (
                    <p className="border-t border-white/5 pt-3 text-[11px] leading-relaxed text-slate-500">
                      {t('crowdfundingNoPrivatePhone')}
                    </p>
                  )}
                </div>
              )}

              {isPlatformAdmin && onAdminDeleteMission && (
                <div className="mt-3 border-t border-white/5 pt-3">
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
        )}
      </div>
    </div>

    {editOpen && (
      <div
        className="absolute inset-0 z-[10080] flex items-end justify-center pointer-events-auto"
        role="dialog"
        aria-modal="true"
        aria-label={t('editMissionTitle', { defaultValue: 'Edit mission' })}
      >
        <button
          type="button"
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          aria-label={t('close')}
          onClick={closeEditModal}
        />
        <div
          className="ce-bottom-sheet relative z-[1] flex w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-slate-950/95 shadow-[0_-16px_48px_rgba(34,211,238,0.16)]"
          style={{ maxHeight: 'min(78svh, 78dvh, 36rem)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="ce-bottom-sheet-body px-5 pt-4">
          <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-white/15" aria-hidden />
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-sm font-black uppercase tracking-[0.18em] text-cyan-200">
              {t('editMissionTitle', { defaultValue: 'Edit mission' })}
            </h3>
            <button
              type="button"
              onClick={closeEditModal}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-slate-200 transition-transform active:scale-95"
              aria-label={t('close')}
            >
              <X className="h-4 w-4" strokeWidth={2.25} />
            </button>
          </div>

          <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
            {t('editMissionDescriptionLabel', { defaultValue: 'Description' })}
          </label>
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value.slice(0, MISSION_SHORT_DESCRIPTION_MAX))}
            maxLength={MISSION_SHORT_DESCRIPTION_MAX}
            rows={4}
            placeholder={t('editMissionDescriptionPlaceholder', {
              defaultValue: 'Describe what needs to be done…',
            })}
            className="mb-2 w-full resize-none rounded-2xl border border-white/12 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400/45 focus:ring-1 focus:ring-cyan-500/25"
          />
          <p className="mb-4 text-right text-[10px] tabular-nums text-slate-500">
            {editBody.length}/{MISSION_SHORT_DESCRIPTION_MAX}
          </p>

          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
            {t('editMissionPhotos', { defaultValue: 'Photos' })}
          </p>
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {photos.map((url) => (
              <div
                key={url}
                className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-white/15 bg-slate-900"
              >
                <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
              </div>
            ))}
            {editPreviews.map((url) => (
              <div
                key={url}
                className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-cyan-400/40 bg-slate-900"
              >
                <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
                <span className="absolute bottom-1 left-1 rounded bg-cyan-500/90 px-1 text-[8px] font-black uppercase text-black">
                  NEW
                </span>
              </div>
            ))}
            {photoSlotsLeft > 0 && (
              <button
                type="button"
                onClick={() => editFileInputRef.current?.click()}
                className="flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-cyan-400/40 bg-cyan-500/10 text-cyan-200 transition-colors hover:bg-cyan-500/20 active:scale-95"
              >
                <Camera className="h-4 w-4" strokeWidth={2.25} aria-hidden />
                <span className="text-[8px] font-black uppercase tracking-[0.12em]">+</span>
              </button>
            )}
          </div>
          <input
            ref={editFileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              onPickEditPhotos(e.target.files);
              e.target.value = '';
            }}
          />
          <p className="mb-4 text-[11px] leading-relaxed text-slate-500">
            {t('editMissionPhotosHint', {
              defaultValue: 'New photos are appended (max {{max}} total).',
              max: MAX_MISSION_PHOTOS,
            })}
          </p>

          {editError && (
            <p className="mb-3 text-[11px] font-medium text-red-400">{editError}</p>
          )}
          </div>

          <div className="ce-bottom-sheet-footer flex gap-2 border-t border-white/10 px-5 pt-3">
            <button
              type="button"
              onClick={closeEditModal}
              disabled={editSubmitting}
              className="flex-1 rounded-full border border-white/15 bg-white/5 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-slate-200 transition-transform active:scale-95 disabled:opacity-50"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={saveMissionEdits}
              disabled={editSubmitting}
              className="flex-1 rounded-full border border-cyan-400/40 bg-cyan-500/90 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-black shadow-[0_0_18px_rgba(34,211,238,0.25)] transition-transform hover:bg-cyan-400 active:scale-95 disabled:cursor-wait disabled:opacity-60"
            >
              {editSubmitting
                ? t('processing')
                : t('saveMissionChanges', { defaultValue: 'Save changes' })}
            </button>
          </div>
        </div>
      </div>
    )}

    {convertOpen && (
      <div
        className="absolute inset-0 z-[10080] flex items-end justify-center pointer-events-auto"
        role="dialog"
        aria-modal="true"
        aria-label={t('reportZoneConvertTitle', { defaultValue: 'Convert report' })}
      >
        <button
          type="button"
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          aria-label={t('close')}
          onClick={() => setConvertOpen(false)}
        />
        <div
          className="ce-bottom-sheet relative z-[1] flex w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-slate-950/95 shadow-[0_-16px_48px_rgba(251,191,36,0.18)]"
          style={{ maxHeight: 'min(78svh, 78dvh, 36rem)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="ce-bottom-sheet-body px-5 pt-4">
          <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-white/15" aria-hidden />
          <h3 className="mb-1 text-sm font-black uppercase tracking-[0.18em] text-amber-200">
            {t('reportZoneConvertTitle', { defaultValue: 'Launch paid cleanup' })}
          </h3>
          <p className="mb-4 text-[11px] leading-relaxed text-slate-400">
            {t('reportZoneConvertHint', {
              defaultValue:
                'Set a target bounty. Crowdfunding collects community funds; direct mode opens the pin for bids immediately.',
            })}
          </p>

          <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
            {t('missionWorkBudgetLabel', { defaultValue: 'Target (USD)' })}
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={convertBudget}
            onChange={(e) => setConvertBudget(sanitizeIntegerUsdDigits(e.target.value))}
            className="mb-4 w-full rounded-2xl border border-white/12 bg-black/40 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400/45"
            placeholder="50"
          />

          <label className="mb-4 flex items-center gap-2 text-xs text-slate-200">
            <input
              type="checkbox"
              checked={convertCrowdfund}
              onChange={(e) => setConvertCrowdfund(e.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-black/40 text-amber-500 focus:ring-amber-400/40"
            />
            {t('crowdfundingModeLabel', { defaultValue: 'Crowdfunding mode' })}
          </label>

          {convertError && (
            <p className="mb-3 text-[11px] font-medium text-red-400">{convertError}</p>
          )}
          </div>

          <div className="ce-bottom-sheet-footer flex gap-2 border-t border-white/10 px-5 pt-3">
            <button
              type="button"
              onClick={() => setConvertOpen(false)}
              disabled={convertSubmitting}
              className="flex-1 rounded-full border border-white/15 bg-white/5 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-slate-200 active:scale-95 disabled:opacity-50"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={submitReportConversion}
              disabled={convertSubmitting}
              className="flex-1 rounded-full border border-amber-400/40 bg-amber-500/90 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-black active:scale-95 disabled:cursor-wait disabled:opacity-60"
            >
              {convertSubmitting
                ? t('processing')
                : t('reportZoneConvertConfirm', { defaultValue: 'Convert & go live' })}
            </button>
          </div>
        </div>
      </div>
    )}

    <ImpactCardModal
      open={impactOpen}
      mission={mission}
      locationLabel={locationTranslation.displayText || locationSource}
      serviceLabel={serviceLabel}
      onClose={() => setImpactOpen(false)}
    />

    <MissionChatPanel
      open={!!chatPeer}
      missionId={mission.id}
      otherUserId={chatPeer?.id || ''}
      otherUserName={chatPeer?.name}
      onClose={() => setChatPeer(null)}
    />
    </>
  );
};

export default MissionBriefing;
