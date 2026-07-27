/**
 * [[Architecture_Overview.md]]
 * Profile floating glass card — wallet/tokens, missions, accordions, Top Up.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { supabase } from '../services/supabase';
import { Pencil, Target, Globe, Building2, Clock, Info, Lock, Coins, Store, BadgeCheck, Sparkles } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import AdminDashboard from '../src/components/AdminDashboard';
import TokenPackModal from '../src/components/TokenPackModal';
import SubscriptionModal from '../src/components/SubscriptionModal';
import LivenessCheck from '../src/components/LivenessCheck';
import PhantomCapture from '../src/components/PhantomCapture';
import VerificationModal from './VerificationModal';
import {
  CLIENT_APPROVE_RELEASE_BTN_LIST,
  CLIENT_APPROVE_RELEASE_BTN_MODAL,
  PROFILE_GLASS_PANEL,
  HOME_MIN_PRICE,
  HOME_MAX_PRICE,
  CITY_MIN_PRICE,
  CITY_MAX_PRICE,
} from '../constants';
import { YEARLY_SUBSCRIPTION } from '../src/lib/tokenPricing';
import MissionFilterPanel from './MissionFilterPanel';
import {
  sortMissions,
  filterMissionsByTags,
  DEFAULT_MISSION_SORT,
  formatSubmittedRelative,
  type MissionSortMode,
} from '../src/lib/missionFilterSort';
import {
  MARKETPLACE_ALL_CITIES_ID,
  filterMissionsByCountriesCity,
} from '../src/lib/globalMarketplace';
import { acceptMissionBid } from '../src/lib/missionBids';
import {
  normalizeBidOfferPackages,
  type BidOfferPackage,
} from '../src/lib/bidPackages';
import { useLocationCatalog } from '../src/hooks/useLocationCatalog';
import {
  filterMissionsByFreeReports,
  readShowFreeReports,
  subscribeShowFreeReports,
  writeShowFreeReports,
} from '../src/lib/showFreeReports';
import { filterMissionsByMutedCreators } from '../src/lib/mutedCreators';
import { useMutedCreators } from '../src/hooks/useMutedCreators';
import { checkHomeMissionWorkerVerification } from '../src/lib/homeMissionAccess';
import { getMissionWorkerPhone, getOwnPrivateProfile } from '../src/lib/missionContact';
import { creatorRejectProof, submitMissionProof } from '../src/lib/submitMissionProof';
import { notifyMissionEvent } from '../src/lib/notifications';
import RatingReviewModal, { type RatingTarget } from './RatingReviewModal';
import { formatTokens, formatWorkBudgetUsd } from '../src/lib/formatMoney';
import { missionWorkBudgetUsd, missionTokenBid } from '../src/lib/missionBudget';
import { isPlatformAdmin, isArchivedMissionStatus } from '../src/lib/platformAdmin';
import { adminDeleteMission } from '../src/lib/adminMission';
import {
  APP_EVENT_CREATE_MISSION,
  APP_EVENT_MISSION_COMPLETED,
  APP_EVENT_OPEN_MISSION,
  APP_SUPPORT_EMAIL,
  APP_TELEGRAM_SUPPORT,
  getAppOrigin,
} from '../src/lib/brand';
import ModeratedMissionPhoto from './ModeratedMissionPhoto';
import MissionFeedCard from './MissionFeedCard';
import ImmersiveMissionFeed from './ImmersiveMissionFeed';
import ContractorStorePanel from './ContractorStorePanel';
import { extractMissionFeedDescription } from '../src/lib/missionDescription';
import { missionPinIcon } from '../src/lib/serviceSectors';
import { fetchContractorStore } from '../src/lib/contractorStore';

const MISSION_CREATOR_EMBED = 'creator:profiles!creator_id (full_name, avatar_url)';

const MISSION_PROFILE_SELECT =
  `id, creator_id, cleaner_id, category, amount_target, expected_price, current_funding, location_lat, location_lng, country, city, status, title, description, created_at, photo_urls, after_photo_urls, started_at, is_disputed, retry_count, rejection_reason, auto_approved, ai_confidence_score, ai_verdict, ${MISSION_CREATOR_EMBED}`;

const MISSION_ACTIVE_SELECT =
  `id, creator_id, cleaner_id, category, amount_target, expected_price, current_funding, location_lat, location_lng, country, city, status, title, description, created_at, photo_urls, after_photo_urls, started_at, is_disputed, retry_count, rejection_reason, auto_approved, ${MISSION_CREATOR_EMBED}`;

/** 📍 description line → city/country → coordinates — matches Market card place line. */
function orderMissionLocationLine(job: {
  description?: string | null;
  city?: string | null;
  country?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
}): string | undefined {
  const first = String(job.description ?? '').split('\n')[0]?.trim();
  if (first?.startsWith('📍')) return first;
  const place = [job.city, job.country]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(', ');
  if (place) return `📍 ${place}`;
  if (typeof job.location_lat === 'number' && typeof job.location_lng === 'number') {
    return `📍 ${job.location_lat.toFixed(4)}, ${job.location_lng.toFixed(4)}`;
  }
  return undefined;
}

const orderStatusBadgeClass = (status: string) => {
  const key = String(status || '').toLowerCase();
  if (key === 'in_progress') return 'border-cyan-400/55 bg-cyan-500/25 text-cyan-100';
  if (key === 'review' || key === 'pending_approval')
    return 'border-amber-400/55 bg-amber-500/25 text-amber-100';
  if (key === 'funding') return 'border-violet-400/55 bg-violet-500/25 text-violet-100';
  if (key === 'pending_payment') return 'border-red-400/55 bg-red-500/25 text-red-100';
  if (key === 'completed' || key === 'finished')
    return 'border-emerald-400/55 bg-emerald-500/25 text-emerald-100';
  return 'border-white/20 bg-black/40 text-slate-200';
};

interface ProfileProps {
  isOpen: boolean;
  onClose: () => void;
  session: any;
  onNavigateToJob?: (lat: number, lng: number) => void;
  /** Opens the WebXR AR mission view (state lives in App.tsx). */
  onOpenAR?: () => void;
}

interface Job {
  id: string;
  creator_id: string | null;
  cleaner_id: string | null;
  category: 'public' | 'home' | 'office' | string;
  amount_target: number;
  expected_price?: number | null;
  current_funding?: number | null;
  crowdfunding_mode?: boolean | null;
  is_report?: boolean | null;
  location_lat?: number | null;
  location_lng?: number | null;
  country?: string | null;
  city?: string | null;
  status: string;
  title?: string | null;
  description?: string | null;
  created_at: string;
  started_at?: string | null;
  photo_urls?: string[] | null;
  after_photo_urls?: string[] | null;
  is_disputed?: boolean | null;
  retry_count?: number | null;
  rejection_reason?: string | null;
  auto_approved?: boolean | null;
  rating?: number | null;
  ai_confidence_score?: number | null;
  ai_verdict?: string | null;
  cleaner?: {
    full_name?: string | null;
    telegram_username?: string | null;
  } | null;
  creator?: {
    full_name?: string | null;
    avatar_url?: string | null;
  } | null;
}

type AfterBurstPackage = {
  files: File[];
  lat: number | null;
  lng: number | null;
  capturedAt: string;
};

type ToastState = {
  message: string;
  kind: 'success' | 'error';
} | null;

interface Bid {
  id: string;
  mission_id: string;
  cleaner_id: string;
  bid_amount: number;
  status: string;
  created_at?: string;
  offer_packages?: BidOfferPackage[];
  selected_package_id?: string | null;
}

interface ProfileRow {
  id: string;
  token_balance?: number | null;
  subscription_expires_at?: string | null;
  role?: 'cleaner' | 'customer' | string | null;
  contact_email?: string | null;
  is_verified?: boolean;
  verification_status?: string | null;
  full_name?: string | null;
  phone_number?: string | null;
  telegram_username?: string | null;
  rating?: number | null;
  avatar_url?: string | null;
}

const SUPPORT_TELEGRAM = APP_TELEGRAM_SUPPORT;

const shortId = (id: unknown): string => {
  if (id == null) return 'N/A';
  try {
    return String(id).slice(0, 8);
  } catch {
    return 'N/A';
  }
};

function ProfileAccordion({
  title,
  icon,
  children,
  defaultOpen = false,
  closedSummary,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  closedSummary?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`${PROFILE_GLASS_PANEL} mb-2 overflow-hidden max-w-full`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-0 items-center justify-between gap-2 px-4 py-3 text-left text-white transition-colors hover:bg-white/5"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-bold uppercase tracking-[0.16em]">
          {icon}
          <span className="truncate">{title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {!open && closedSummary ? (
            <span className="max-w-[9rem] truncate text-[10px] font-bold normal-case tracking-normal text-slate-400 sm:max-w-[12rem]">
              {closedSummary}
            </span>
          ) : null}
          <span className="text-slate-400">{open ? '▾' : '▸'}</span>
        </span>
      </button>
      {open && <div className="border-t border-white/10 px-4 pb-4 pt-3 max-w-full overflow-x-hidden">{children}</div>}
    </div>
  );
}

function JobTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    const format = (ms: number) => {
      const s = Math.floor(ms / 1000);
      const m = Math.floor(s / 60);
      const h = Math.floor(m / 60);
      if (h > 0) return `${h}h ${m % 60}m`;
      if (m > 0) return `${m}m ${s % 60}s`;
      return `${s}s`;
    };
    const tick = () => {
      const start = new Date(startedAt).getTime();
      setElapsed(format(Date.now() - start));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return <span className="tabular-nums text-emerald-400 font-bold">{elapsed}</span>;
}

const Profile: React.FC<ProfileProps> = ({ isOpen, onClose, session: _session, onNavigateToJob, onOpenAR }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isRu = (i18n.language || '').toLowerCase().startsWith('ru');
  const [showAdmin, setShowAdmin] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showRefunds, setShowRefunds] = useState(false);
  const [myHomeJobs, setMyHomeJobs] = useState<Job[]>([]);
  const [myCityJobs, setMyCityJobs] = useState<Job[]>([]);
  const [myActiveJobs, setMyActiveJobs] = useState<Job[]>([]);
  const [missionHistory, setMissionHistory] = useState<Job[]>([]);
  const [jobBidsById, setJobBidsById] = useState<Record<string, Bid[]>>({});
  const [marketplaceJobs, setMarketplaceJobs] = useState<Job[]>([]);
  // Filter & sort control bar (replaces the legacy city dropdown). Default ranking
  // is token-boost first (see DEFAULT_MISSION_SORT).
  const [marketSortMode, setMarketSortMode] = useState<MissionSortMode>(DEFAULT_MISSION_SORT);
  const [marketSelectedTags, setMarketSelectedTags] = useState<string[]>([]);
  const [marketCountryIds, setMarketCountryIds] = useState<string[]>([]);
  const [marketCityId, setMarketCityId] = useState<string>(MARKETPLACE_ALL_CITIES_ID);
  const [showFreeReports, setShowFreeReports] = useState(() => readShowFreeReports());
  // Immersive Visual Feed — stack is set by the section that opened it
  // (My Orders vs Services Market) so vertical swipe stays in-context.
  const [immersiveStartId, setImmersiveStartId] = useState<string | null>(null);
  const [immersiveMissions, setImmersiveMissions] = useState<Job[]>([]);
  const [hasContractorStore, setHasContractorStore] = useState(false);
  const openImmersiveFeed = useCallback((missionId: string, stack: Job[]) => {
    setImmersiveMissions(stack);
    setImmersiveStartId(missionId);
  }, []);
  useEffect(() => {
    if (!isOpen) {
      setImmersiveStartId(null);
      setImmersiveMissions([]);
    }
  }, [isOpen]);
  const { mutedIds, mutedCount, clearMuted } = useMutedCreators();
  const toggleMarketTag = useCallback((tag: string) => {
    setMarketSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }, []);
  const clearMarketTags = useCallback(() => setMarketSelectedTags([]), []);
  useEffect(() => subscribeShowFreeReports(setShowFreeReports), []);
  const [loading, setLoading] = useState(true);
  const [marketLoading, setMarketplaceLoading] = useState(true);
  const [marketError, setMarketplaceError] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<ProfileRow | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const isAdmin = isPlatformAdmin({
    email: userEmail ?? _session?.user?.email,
    telegramUsername: userProfile?.telegram_username,
    role: userProfile?.role,
  });
  const [adminDeleteMissionId, setAdminDeleteMissionId] = useState<string | null>(null);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [paymentSyncing, setPaymentSyncing] = useState(false);
  const [reviewJob, setReviewJob] = useState<Job | null>(null);
  const [reviewWorkerProfile, setReviewWorkerProfile] = useState<{
    full_name?: string | null;
    phone_number?: string | null;
    telegram_username?: string | null;
  } | null>(null);
  const [releasePaySubmitting, setReleasePaySubmitting] = useState(false);
  const [rejectProofSubmitting, setRejectProofSubmitting] = useState(false);
  const [ratingTarget, setRatingTarget] = useState<RatingTarget | null>(null);
  const [toastState, setToastState] = useState<ToastState>(null);
  // Mission creation is handled from the map (token-backed). Profile no longer starts checkout flows.
  /** Loading id for Retry/Cancel on `pending_payment` (Phantom Pin) cards. */
  const [phantomPaymentActionId, setPhantomPaymentActionId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [telegramUsername, setTelegramUsername] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactSubmitting, setContactSubmitting] = useState(false);
  const [contactSaved, setContactSaved] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [contactEditMode, setContactEditMode] = useState(true);
  const [passwordEditMode, setPasswordEditMode] = useState(true);
  const [showTokenPackModal, setShowTokenPackModal] = useState(false);
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const lastMissionStatusActionAtRef = useRef<number>(0);
  const toastTimerRef = useRef<number | null>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  const languageOptions = [
    { code: 'en', labelKey: 'english' as const, short: 'EN' },
    { code: 'ar', labelKey: 'arabic' as const, short: 'AR' },
    { code: 'ru', labelKey: 'russian' as const, short: 'RU' },
    { code: 'de', labelKey: 'german' as const, short: 'DE' },
    { code: 'it', labelKey: 'italian' as const, short: 'IT' },
    { code: 'es', labelKey: 'spanish' as const, short: 'ES' },
  ] as const;

  useEffect(() => {
    if (!langMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setLangMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [langMenuOpen]);

  const toast = {
    success: (message: string) => {
      setToastState({ message, kind: 'success' });
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setToastState(null), 2600);
    },
    error: (message: string) => {
      setToastState({ message, kind: 'error' });
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setToastState(null), 3000);
    },
  };

  const enforceMissionStatusCooldown = () => {
    const now = Date.now();
    if (now - lastMissionStatusActionAtRef.current < 10_000) {
      alert('Anti-spam: Please wait 10 seconds before changing mission status.');
      return false;
    }
    lastMissionStatusActionAtRef.current = now;
    return true;
  };

  const openMarketplaceJobs = useMemo(
    () =>
      (marketplaceJobs || []).filter((job) => {
        const status = String(job.status || '').toLowerCase();
        if (status === 'reported' || job.is_report) return true;
        // Crowdfunding campaigns stay public until fully funded → in_progress,
        // even when a cleaner is pre-locked during funding.
        if (status === 'funding') return true;
        return (
          ['pending', 'available', 'open'].includes(status) && job.cleaner_id == null
        );
      }),
    [marketplaceJobs]
  );

  const tokenBalance = Math.max(0, Number(userProfile?.token_balance ?? 0));

  /** Sticky header title — first name / telegram / email local-part. Never a generic "Your account". */
  const profileDisplayName = useMemo(() => {
    const full = String(userProfile?.full_name ?? '').trim();
    if (full) {
      const first = full.split(/\s+/)[0];
      return first || full;
    }
    const tg = String(userProfile?.telegram_username ?? telegramUsername ?? '')
      .trim()
      .replace(/^@+/, '');
    if (tg) return tg;
    const email = String(userEmail ?? _session?.user?.email ?? '').trim();
    if (email.includes('@')) return email.split('@')[0] || email;
    if (email) return email;
    return '';
  }, [
    userProfile?.full_name,
    userProfile?.telegram_username,
    telegramUsername,
    userEmail,
    _session?.user?.email,
  ]);

  const subscriptionIsActive = useMemo(() => {
    const exp = userProfile?.subscription_expires_at
      ? Date.parse(userProfile.subscription_expires_at)
      : 0;
    return Number.isFinite(exp) && exp > Date.now();
  }, [userProfile?.subscription_expires_at]);

  /** Current billing window derived from expires_at (yearly SaaS period). */
  const subscriptionPeriod = useMemo(() => {
    const endMs = userProfile?.subscription_expires_at
      ? Date.parse(userProfile.subscription_expires_at)
      : NaN;
    if (!Number.isFinite(endMs)) return null;
    const end = new Date(endMs);
    const start = new Date(end);
    start.setMonth(start.getMonth() - YEARLY_SUBSCRIPTION.months);
    const daysLeft = Math.max(0, Math.ceil((endMs - Date.now()) / 86_400_000));
    const locale = i18n.language || undefined;
    const fmt = (d: Date) =>
      d.toLocaleDateString(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    return {
      start,
      end,
      daysLeft,
      active: endMs > Date.now(),
      startLabel: fmt(start),
      endLabel: fmt(end),
    };
  }, [userProfile?.subscription_expires_at, i18n.language]);

  const verificationStatusKey = useMemo(() => {
    const raw =
      userProfile?.verification_status ?? (userProfile?.is_verified ? 'verified' : 'unverified');
    return String(raw || 'unverified').toLowerCase();
  }, [userProfile?.verification_status, userProfile?.is_verified]);

  const profileInfoClosedSummary = useMemo(() => {
    const verifyLabel =
      verificationStatusKey === 'pending'
        ? t('underReview', { defaultValue: 'Under Review' })
        : verificationStatusKey === 'verified'
          ? t('trusted', { defaultValue: 'Trusted' })
          : verificationStatusKey === 'rejected'
            ? t('kycRejectedBadge', { defaultValue: 'Rejected' })
            : t('unverified', { defaultValue: 'Unverified' });
    return `${tokenBalance} ${t('tokens')} · ${
      subscriptionIsActive ? t('subscriptionActive') : t('subscriptionExpired')
    } · ${verifyLabel}`;
  }, [tokenBalance, subscriptionIsActive, verificationStatusKey, t]);

  const ownedOpenMissions = useMemo(() => {
    const merged = [...(myHomeJobs || []), ...(myCityJobs || [])];
    const seen = new Set<string>();
    return merged.filter((job) => {
      if (isArchivedMissionStatus(job.status)) return false;
      if (seen.has(job.id)) return false;
      seen.add(job.id);
      return true;
    });
  }, [myHomeJobs, myCityJobs]);

  const activeWorkJobs = useMemo(
    () =>
      (myActiveJobs || []).filter((job) =>
        ['in_progress', 'review', 'pending_approval'].includes(String(job.status || '').toLowerCase())
      ),
    [myActiveJobs]
  );

  /** Contractor cabinet when the user works missions or already has a storefront. */
  const isContractorCabinet = useMemo(() => {
    if (hasContractorStore) return true;
    if (activeWorkJobs.length > 0) return true;
    const uid = userProfile?.id;
    if (!uid) return false;
    return (missionHistory || []).some((j) => j.cleaner_id === uid);
  }, [hasContractorStore, activeWorkJobs.length, userProfile?.id, missionHistory]);

  useEffect(() => {
    if (!isOpen || !userProfile?.id) {
      setHasContractorStore(false);
      return;
    }
    let cancelled = false;
    void fetchContractorStore(userProfile.id)
      .then((store) => {
        if (!cancelled) setHasContractorStore(!!store);
      })
      .catch(() => {
        if (!cancelled) setHasContractorStore(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, userProfile?.id]);

  const profileOrdersClosedSummary = useMemo(() => {
    const openOwned = ownedOpenMissions.length;
    const activeWork = activeWorkJobs.length;
    return `${t('profileOwnedShort')}: ${openOwned} · ${t('profileActiveWorkShort')}: ${activeWork}`;
  }, [ownedOpenMissions.length, activeWorkJobs.length, t]);

  // Filtered by country/city + tags + free-report visibility + muted creators, then ranked.
  // The catalog also pulls DB-wide facets so populated countries stay selectable.
  const { catalog: locationCatalog } = useLocationCatalog(openMarketplaceJobs);

  const displayedMarketplaceJobs = useMemo(
    () =>
      sortMissions(
        filterMissionsByMutedCreators(
          filterMissionsByFreeReports(
            filterMissionsByCountriesCity(
              filterMissionsByTags(openMarketplaceJobs, marketSelectedTags),
              marketCountryIds,
              marketCityId,
              locationCatalog
            ),
            showFreeReports
          ),
          mutedIds
        ),
        marketSortMode
      ),
    [
      openMarketplaceJobs,
      marketSelectedTags,
      marketCountryIds,
      marketCityId,
      locationCatalog,
      showFreeReports,
      mutedIds,
      marketSortMode,
    ]
  );

  // Real-time token balance subscription
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setup = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return;

      channel = supabase
        .channel(`profiles-tokens-${userId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'profiles',
            filter: `id=eq.${userId}`,
          },
          (payload: any) => {
            const newRow = payload.new as ProfileRow | undefined;
            if (newRow && Number.isFinite(Number(newRow.token_balance))) {
              setUserProfile((prev) =>
                !prev
                  ? prev
                  : { ...prev, token_balance: Number(newRow.token_balance) }
              );
            }
          }
        )
        .subscribe();
    };

    setup();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Worker proof-of-work modal (before/after photos)
  const [proofJob, setProofJob] = useState<Job | null>(null);
  const [proofPhase, setProofPhase] = useState<'before' | 'after'>('before');
  const [proofFiles, setProofFiles] = useState<File[]>([]);
  const [proofPreviewUrls, setProofPreviewUrls] = useState<string[]>([]);
  const [afterBurstPackages, setAfterBurstPackages] = useState<AfterBurstPackage[]>([]);
  const [showPhantomCapture, setShowPhantomCapture] = useState(false);
  const [livenessBlob, setLivenessBlob] = useState<Blob | null>(null);
  const [livenessMimeType, setLivenessMimeType] = useState<string>('video/webm');
  const [livenessLat, setLivenessLat] = useState<number | null>(null);
  const [livenessLng, setLivenessLng] = useState<number | null>(null);
  const [proofSubmitting, setProofSubmitting] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);
  const [proofSuccess, setProofSuccess] = useState<string | null>(null);
  const [proofProcessingImage, setProofProcessingImage] = useState(false);
  const [plasticKg, setPlasticKg] = useState<string>('0');
  const [glassKg, setGlassKg] = useState<string>('0');
  const [constructionKg, setConstructionKg] = useState<string>('0');
  const [woodKg, setWoodKg] = useState<string>('0');

  // Create proof preview object URLs and revoke them when the set of files changes/unmounts.
  useEffect(() => {
    const urls = proofFiles.map((file) => URL.createObjectURL(file));
    setProofPreviewUrls(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [proofFiles]);

  useEffect(() => {
    let cancelled = false;
    const cleanerId = reviewJob?.cleaner_id;
    const missionId = reviewJob?.id;
    if (!cleanerId || !missionId) {
      setReviewWorkerProfile(null);
      return;
    }
    void (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, avatar_url')
        .eq('id', cleanerId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error('Review worker profile fetch:', error);
        setReviewWorkerProfile(null);
        return;
      }
      setReviewWorkerProfile({
        full_name: (data as { full_name?: string | null } | null)?.full_name ?? null,
        telegram_username: null,
        phone_number: null,
      });
      let phone: string | null = null;
      try {
        phone = await getMissionWorkerPhone(missionId);
      } catch (e) {
        console.warn('get_mission_worker_phone failed', e);
      }
      if (cancelled) return;
      setReviewWorkerProfile((prev) =>
        prev ? { ...prev, phone_number: phone } : prev
      );    })();
    return () => {
      cancelled = true;
    };
  }, [reviewJob?.id, reviewJob?.cleaner_id]);

  const closeReviewModal = useCallback(() => {
    if (releasePaySubmitting) return;
    setReviewJob(null);
    setReviewWorkerProfile(null);
  }, [releasePaySubmitting]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    onClose();
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setAvatarUploading(true);

      if (!file.type || !file.type.startsWith('image/')) {
        alert('Only images are allowed');
        return;
      }

      const compressedAvatar = (await imageCompression(file, {
        maxSizeMB: 0.4,
        maxWidthOrHeight: 1280,
        useWebWorker: true,
        fileType: 'image/jpeg',
      })) as File;

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        alert('You must be logged in to upload an avatar.');
        return;
      }
      const userId = session.user.id;
      const fileExt = 'jpg';
      const filePath = `${userId}/${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, compressedAvatar, { upsert: false, contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from('avatars').getPublicUrl(filePath);

      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', userId);
      if (profileErr) throw profileErr;

      setUserProfile((prev) =>
        prev ? { ...prev, avatar_url: publicUrl } : prev
      );
    } catch (err: any) {
      console.error('Avatar upload error:', err);
      alert(err?.message || 'Failed to upload avatar. Please try again.');
    } finally {
      setAvatarUploading(false);
      // reset input value so the same file can be re-selected if needed
      e.target.value = '';
    }
  };

  // Token-only system: fiat withdrawals and wallet top-ups removed from UI.

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);
    setPasswordSaved(false);

    if (!newPassword || !confirmPassword) {
      setPasswordError('Please fill in both password fields.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters long.');
      return;
    }

    try {
      setPasswordSubmitting(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setPasswordError('You must be logged in to change your password.');
        return;
      }

      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) {
        setPasswordError(error.message || 'Failed to update password.');
        return;
      }

      setPasswordSuccess('Password updated successfully.');
      setPasswordSaved(true);
      setPasswordEditMode(false);
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPasswordError(err?.message || 'Failed to update password.');
    } finally {
      setPasswordSubmitting(false);
    }
  };

  const verifyJobPaymentAndRefetch = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    try {
      const res = await fetch('/api/verify-job-payment', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      await res.json().catch(() => ({}));
    } catch (e) {
      console.error('Verify job payment error:', e);
    } finally {
      sessionStorage.removeItem('paymentSuccessNeedsVerify');
    }
    await fetchProfileData();
    await fetchMarketplaceJobs();
  }, []);

  useEffect(() => {
    const runFallbackIfNeeded = async () => {
      const needsVerify = sessionStorage.getItem('paymentSuccessNeedsVerify');
      if (needsVerify !== 'job_creation') return;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setPaymentSyncing(true);
      try {
        await verifyJobPaymentAndRefetch();
      } finally {
        setPaymentSyncing(false);
      }
    };
    runFallbackIfNeeded();
  }, [verifyJobPaymentAndRefetch]);

  useEffect(() => {
    const onPaymentSuccess = () => {
      const needsVerify = sessionStorage.getItem('paymentSuccessNeedsVerify');
      setPaymentSyncing(true);
      (needsVerify === 'job_creation' ? verifyJobPaymentAndRefetch() : Promise.all([fetchProfileData(), fetchMarketplaceJobs()]))
        .finally(() => setPaymentSyncing(false));
    };
    window.addEventListener('paymentSuccess', onPaymentSuccess);
    return () => window.removeEventListener('paymentSuccess', onPaymentSuccess);
  }, [verifyJobPaymentAndRefetch]);

  useEffect(() => {
    if (!isOpen) return;
    const loadOnce = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        await fetchProfileData();
        await fetchMarketplaceJobs();
      } catch (e) {
        console.error('Profile init fetch error:', e);
      }
    };
    loadOnce();
  }, [isOpen]);

  const fetchProfileData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        setMyHomeJobs([]);
        setMyCityJobs([]);
        setMyActiveJobs([]);
        setJobBidsById({});
        setLoading(false);
        return;
      }
      const userId = session.user.id;
      setUserEmail(session.user.email ?? null);

      const { data: profile } = await supabase
        .from('profiles')
        .select(
          'id, role, is_verified, verification_status, full_name, rating, avatar_url'
        )
        .eq('id', userId)
        .maybeSingle();

      const profileRow = profile as ProfileRow | null;
      let privateProfile: Awaited<ReturnType<typeof getOwnPrivateProfile>> | null = null;
      try {
        privateProfile = await getOwnPrivateProfile();
      } catch (e) {
        console.warn('get_own_private_profile failed', e);
      }
      const ownPhone = privateProfile?.phone_number || '';
      const ownEmail = privateProfile?.contact_email || '';
      const ownTelegram = privateProfile?.telegram_username || null;
      setUserProfile(
        profileRow
          ? {
              ...profileRow,
              phone_number: ownPhone || null,
              contact_email: ownEmail || null,
              telegram_username: ownTelegram,
              token_balance: privateProfile?.token_balance ?? profileRow.token_balance ?? null,
              subscription_expires_at:
                privateProfile?.subscription_expires_at ??
                profileRow.subscription_expires_at ??
                null,
            }
          : null
      );
      if (profileRow) {
        setPhoneNumber(ownPhone);
        setTelegramUsername(ownTelegram ?? '');
        setContactEmail(ownEmail || session.user.email || '');
        setContactEditMode(!(ownEmail || ownPhone || ownTelegram));
      }

      const { data: homeJobsData } = await supabase
        .from('missions')
        .select(MISSION_PROFILE_SELECT)
        .eq('creator_id', userId)
        .eq('category', 'home')
        .order('created_at', { ascending: false });
      setMyHomeJobs((homeJobsData || []) as unknown as Job[]);

      const { data: cityJobsData } = await supabase
        .from('missions')
        .select(MISSION_PROFILE_SELECT)
        .eq('creator_id', userId)
        .eq('category', 'public')
        .order('created_at', { ascending: false });
      setMyCityJobs((cityJobsData || []) as unknown as Job[]);

      const { data: activeJobsData } = await supabase
        .from('missions')
        .select(MISSION_ACTIVE_SELECT)
        .eq('cleaner_id', userId)
        .in('status', ['in_progress', 'review', 'pending_approval', 'completed', 'finished'])
        .order('created_at', { ascending: false });
      setMyActiveJobs(
        ((activeJobsData || []) as unknown as Job[]).map((job) => ({
          ...job,
          photo_urls: Array.isArray(job.photo_urls) ? job.photo_urls.slice(0, 9) : job.photo_urls,
          after_photo_urls: Array.isArray(job.after_photo_urls) ? job.after_photo_urls.slice(0, 9) : job.after_photo_urls,
        }))
      );

      const { data: historyData } = await supabase
        .from('missions')
        .select(
          `
          id,
          creator_id,
          cleaner_id,
          category,
          amount_target,
          expected_price,
          location_lat,
          location_lng,
          country,
          city,
          status,
          title,
          description,
          created_at,
          photo_urls,
          after_photo_urls,
          started_at,
          is_disputed,
          cleaner:profiles!missions_cleaner_id_fkey (
            full_name
          )
        `
        )
        .in('status', ['completed', 'finished'])
        .or(`creator_id.eq.${userId},cleaner_id.eq.${userId}`)
        .order('created_at', { ascending: false })
        .limit(100);
      setMissionHistory((historyData || []) as unknown as Job[]);

      const pendingJobIds = [
        ...(((homeJobsData || []) as unknown as Job[])
          .filter((j) =>
            ['pending', 'available', 'funding'].includes(String(j.status || '').toLowerCase())
          )
          .map((j) => j.id)),
        ...(((cityJobsData || []) as unknown as Job[])
          .filter((j) =>
            ['pending', 'available', 'funding'].includes(String(j.status || '').toLowerCase())
          )
          .map((j) => j.id)),
      ];
      if (pendingJobIds.length > 0) {
        const { data: bidsData } = await supabase
          .from('mission_bids')
          .select(
            'id, mission_id, cleaner_id, bid_amount, status, created_at, offer_packages, selected_package_id'
          )
          .in('mission_id', pendingJobIds);
        const byJob: Record<string, Bid[]> = {};
        for (const raw of bidsData || []) {
          const bid: Bid = {
            ...(raw as Bid),
            offer_packages: normalizeBidOfferPackages(
              (raw as { offer_packages?: unknown }).offer_packages
            ),
          };
          if (!byJob[bid.mission_id]) byJob[bid.mission_id] = [];
          byJob[bid.mission_id].push(bid);
        }
        setJobBidsById(byJob);
      } else {
        setJobBidsById({});
      }
    } catch (err) {
      console.error('Error fetching profile data:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMarketplaceJobs = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) return;
      setMarketplaceLoading(true);
      setMarketplaceError(null);

      const { data, error } = await supabase
        .from('missions')
        .select(
          `
          id,
          creator_id,
          cleaner_id,
          category,
          service_type,
          amount_target,
          expected_price,
          current_funding,
          crowdfunding_mode,
          is_report,
          location_lat,
          location_lng,
          country,
          city,
          status,
          title,
          description,
          created_at,
          photo_urls,
          creator:profiles!creator_id (
            full_name,
            avatar_url
          )
        `
        )
        .in('status', ['available', 'funding', 'pending', 'reported'])
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        throw error;
      }

      setMarketplaceJobs((data || []) as Job[]);
    } catch (err) {
      console.error('Error fetching marketplace jobs:', err);
      setMarketplaceError('Failed to load marketplace. Please refresh.');
    } finally {
      setMarketplaceLoading(false);
    }
  };

  // Stripe-only gateway: removed legacy redirect + intent initialization.

  const cancelPendingPaymentMission = async (job: Job, list: 'home' | 'city') => {
    try {
      setPhantomPaymentActionId(job.id);
      const { error } = await supabase.rpc('cancel_pending_payment_mission', {
        p_mission_id: job.id,
      });
      if (error) throw error;
      if (list === 'home') {
        setMyHomeJobs((prev) => prev.filter((j) => j.id !== job.id));
      } else {
        setMyCityJobs((prev) => prev.filter((j) => j.id !== job.id));
      }
      toast.success(t('missionCancelled'));
    } catch (e) {
      console.error('cancelPendingPaymentMission:', e);
      toast.error(t('cancelMissionFailed'));
    } finally {
      setPhantomPaymentActionId(null);
    }
  };

  const handleAcceptBid = async (
    job: Job,
    bid: Bid,
    packageId?: string | null
  ) => {
    if (!enforceMissionStatusCooldown()) return;
    const packages = bid.offer_packages ?? [];
    const selectedPkg = packageId
      ? packages.find((p) => p.id === packageId)
      : packages.length === 1
        ? packages[0]
        : null;
    const missionValue = Number(selectedPkg?.price ?? bid.bid_amount ?? 0);
    if (!Number.isFinite(missionValue) || missionValue <= 0) return;

    // SaaS model: no security deposit — only home/office missions require an ID-verified worker.
    const { data: workerProf, error: workerProfErr } = await supabase
      .from('profiles')
      .select('is_verified')
      .eq('id', bid.cleaner_id)
      .maybeSingle();
    if (workerProfErr) {
      console.error(workerProfErr);
      toast.error(workerProfErr.message || 'Could not load worker profile.');
      return;
    }
    const homeOk = checkHomeMissionWorkerVerification(job.category, workerProf?.is_verified);
    if (!homeOk.ok) {
      setShowVerificationModal(true);
      return;
    }

    if (
      !window.confirm(
        t('acceptBidConfirm', { amount: String(Math.floor(missionValue)) })
      )
    ) {
      return;
    }
    try {
      await acceptMissionBid(bid.id, packageId ?? selectedPkg?.id ?? null);
      await fetchProfileData();
    } catch (err: any) {
      console.error(err);
      alert(err?.message || 'Failed to accept offer. Please try again.');
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    if (!window.confirm('Delete this request? This action cannot be undone.')) return;
    try {
      const { error } = await supabase.from('missions').delete().eq('id', jobId);
      if (error) throw error;
      setMyHomeJobs((prev) => prev.filter((j) => j.id !== jobId));
      setJobBidsById((prev) => {
        const next = { ...prev };
        delete next[jobId];
        return next;
      });
    } catch (err) {
      console.error(err);
      alert('Failed to delete. Please try again.');
    }
  };

  const openNavigate = (job: Job) => {
    const lat = job.location_lat;
    const lng = job.location_lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      alert('This job does not have coordinates yet.');
      return;
    }
    const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openProofModal = (job: Job, phase: 'before' | 'after') => {
    setProofJob({
      ...job,
      photo_urls: Array.isArray(job.photo_urls) ? job.photo_urls.slice(0, 9) : job.photo_urls,
      after_photo_urls: Array.isArray(job.after_photo_urls) ? job.after_photo_urls.slice(0, 9) : job.after_photo_urls,
    });
    setProofPhase(phase);
    setProofFiles([]);
    setLivenessBlob(null);
    setLivenessLat(null);
    setLivenessLng(null);
    setAfterBurstPackages([]);
    setShowPhantomCapture(false);
    setProofError(null);
    setProofSuccess(null);
    setPlasticKg('0');
    setGlassKg('0');
    setConstructionKg('0');
    setWoodKg('0');
  };

  const closeProofModal = () => {
    if (proofSubmitting) return;
    setProofJob(null);
    setProofFiles([]);
    setLivenessBlob(null);
    setLivenessLat(null);
    setLivenessLng(null);
    setAfterBurstPackages([]);
    setShowPhantomCapture(false);
    setProofError(null);
    setProofSuccess(null);
  };

  const submitProof = async (e: React.FormEvent) => {
    e.preventDefault();
    setProofError(null);
    setProofSuccess(null);
    if (!proofJob) return;
    if (proofPhase === 'after' && !enforceMissionStatusCooldown()) return;

    // Store the GPS used for the anti-fraud distance check so we can reuse it
    // (avoids null liveness coordinates from the recorder component timing).
    let antiFraudLat: number | null = null;
    let antiFraudLng: number | null = null;
  if (!proofFiles.length) {
    setProofError('Please upload photos before continuing.');
    return;
  }
  if (proofPhase === 'after' && !livenessBlob) {
    setProofError('Please complete the liveness check before submitting.');
    return;
  }
  if (proofFiles.length > 9) {
    setProofError('Please upload no more than 9 photos.');
    return;
  }

  const toRad = (val: number) => (val * Math.PI) / 180;
  const distanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  if (
    proofPhase === 'after' &&
    typeof proofJob.location_lat === 'number' &&
    typeof proofJob.location_lng === 'number'
  ) {
    if (!('geolocation' in navigator)) {
      setProofError(t('tooFarFromMission'));
      return;
    }

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        }),
      );
      const { latitude, longitude } = position.coords;
        antiFraudLat = latitude;
        antiFraudLng = longitude;
      const d = distanceMeters(
        latitude,
        longitude,
        proofJob.location_lat,
        proofJob.location_lng,
      );
      if (d > 200) {
        setProofError(t('tooFarFromMission'));
        return;
      }
    } catch (err) {
      console.error('Geolocation error:', err);
      setProofError(
        t('geolocateUnavailable', {
          defaultValue: 'Location unavailable. Please check your browser permissions.',
        })
      );
      return;
    }
  }

    try {
      setProofSubmitting(true);
      setProofProcessingImage(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) throw new Error('You must be signed in.');

      const uploadedUrls: string[] = [];
      const compressionOptions = {
        maxSizeMB: 0.4,
        maxWidthOrHeight: 1280,
        useWebWorker: true,
        fileType: 'image/jpeg',
      };
      for (const file of proofFiles.slice(0, 9)) {
        if (!file.type || !file.type.startsWith('image/')) {
          setProofError('Only images are allowed');
          return;
        }
        let fileToUpload: File = file;
        try {
          const compressed = await imageCompression(file, compressionOptions);
          console.log('Proof photo compression:', {
            name: file.name,
            originalMB: (file.size / 1024 / 1024).toFixed(2),
            compressedMB: (compressed.size / 1024 / 1024).toFixed(2),
          });
          fileToUpload = compressed as File;
        } catch (compressErr) {
          console.warn('Compression failed for proof photo:', file.name, compressErr);
          fileToUpload = file;
        }

        const fileExt = 'jpg';
        const safeFileName = `mission_${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('order-photos')
          .upload(safeFileName, fileToUpload, { upsert: false, contentType: 'image/jpeg' });
        if (uploadError) throw uploadError;
        const {
          data: { publicUrl },
        } = supabase.storage.from('order-photos').getPublicUrl(safeFileName);
        uploadedUrls.push(publicUrl);
      }
      setProofProcessingImage(false);

      if (proofPhase === 'before') {
        const { error: updateErr } = await supabase
          .from('missions')
          .update({
            photo_urls: [...(proofJob.photo_urls || []), ...uploadedUrls].slice(0, 9),
            started_at: new Date().toISOString(),
          })
          .eq('id', proofJob.id);
        if (updateErr) throw updateErr;
        setProofSuccess('Before photos uploaded. Mission started.');
      } else {
        // Capture completion GPS at the exact moment of submission (permanent audit trail)
        let completionLat: number | null = null;
        let completionLng: number | null = null;
        let completionDistanceMeters: number | null = null;
        if (
          typeof proofJob.location_lat === 'number' &&
          typeof proofJob.location_lng === 'number' &&
          'geolocation' in navigator
        ) {
          try {
            const position = await new Promise<GeolocationPosition>((resolve, reject) =>
              navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 10000,
              }),
            );
            completionLat = position.coords.latitude;
            completionLng = position.coords.longitude;
            completionDistanceMeters = Math.round(
              distanceMeters(
                completionLat,
                completionLng,
                proofJob.location_lat,
                proofJob.location_lng,
              ),
            );
          } catch (e) {
            // Do not block completion if GPS is unavailable; audit trail will remain empty.
            console.warn('Completion GPS capture failed:', e);
          }
        }

        // Fallback to the GPS captured during the anti-fraud distance check.
        if (completionLat == null && antiFraudLat != null) completionLat = antiFraudLat;
        if (completionLng == null && antiFraudLng != null) completionLng = antiFraudLng;
        if (
          completionDistanceMeters == null &&
          completionLat != null &&
          completionLng != null &&
          typeof proofJob.location_lat === 'number' &&
          typeof proofJob.location_lng === 'number'
        ) {
          completionDistanceMeters = Math.round(
            distanceMeters(
              completionLat,
              completionLng,
              proofJob.location_lat,
              proofJob.location_lng
            )
          );
        }
        if ((completionLat == null || completionLng == null) && afterBurstPackages.length > 0) {
          const lastBurst = afterBurstPackages[afterBurstPackages.length - 1];
          if (lastBurst?.lat != null && lastBurst?.lng != null) {
            completionLat = lastBurst.lat;
            completionLng = lastBurst.lng;
            if (
              typeof proofJob.location_lat === 'number' &&
              typeof proofJob.location_lng === 'number'
            ) {
              completionDistanceMeters = Math.round(
                distanceMeters(
                  completionLat,
                  completionLng,
                  proofJob.location_lat,
                  proofJob.location_lng
                )
              );
            }
          }
        }

        // Report submission is non-financial: evidence only → review via secure RPC.
        let proofVideoUrl: string | null = null;
        if (livenessBlob) {
          const isWebm = (livenessMimeType || '').includes('webm');
          const ext = isWebm ? 'webm' : 'mp4';
          const safeVideoName = `liveness_${proofJob.id}_${Date.now()}_${Math.random().toString(36).substring(2)}.${ext}`;
          const { error: videoUploadErr } = await supabase.storage
            .from('liveness-videos')
            .upload(safeVideoName, livenessBlob, {
              upsert: false,
              contentType: livenessMimeType || 'video/webm',
            });
          if (videoUploadErr) throw videoUploadErr;
          const {
            data: { publicUrl: videoPublicUrl },
          } = supabase.storage.from('liveness-videos').getPublicUrl(safeVideoName);
          proofVideoUrl = videoPublicUrl;
        }

        const effectiveLivenessLat = livenessLat ?? completionLat ?? antiFraudLat;
        const effectiveLivenessLng = livenessLng ?? completionLng ?? antiFraudLng;

        if (effectiveLivenessLat == null || effectiveLivenessLng == null) {
          setProofError('Worker GPS is required. Please enable location and try again.');
          return;
        }

        await submitMissionProof({
          missionId: proofJob.id,
          afterPhotoUrls: [...(proofJob.after_photo_urls || []), ...uploadedUrls].slice(0, 9),
          workerLat: effectiveLivenessLat,
          workerLng: effectiveLivenessLng,
          completionLat: completionLat ?? effectiveLivenessLat,
          completionLng: completionLng ?? effectiveLivenessLng,
          completionDistanceMeters,
          proofVideoUrl,
          livenessLat: effectiveLivenessLat,
          livenessLng: effectiveLivenessLng,
        });
        await notifyMissionEvent(proofJob.id, 'proof_uploaded');

        const plastic = Number.parseFloat(plasticKg || '0') || 0;
        const glass = Number.parseFloat(glassKg || '0') || 0;
        const debris = Number.parseFloat(constructionKg || '0') || 0;
        const wood = Number.parseFloat(woodKg || '0') || 0;
        try {
          const origin =
            typeof window !== 'undefined' && window.location?.origin
              ? getAppOrigin()
              : '';
          const notifyUrl = origin ? `${origin}/api/notify-mission-submitted` : '/api/notify-mission-submitted';
          const notifyRes = await fetch(notifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              missionId: proofJob.id,
              category: proofJob.category,
              plastic,
              glass,
              debris,
              wood,
            }),
          });
          if (!notifyRes.ok) {
            const errText = await notifyRes.text().catch(() => '');
            console.warn('notify-mission-submitted HTTP', notifyRes.status, errText);
          }
        } catch (notifyErr) {
          console.warn('notify-mission-submitted failed:', notifyErr);
        }

        setProofSuccess('Proof submitted for review. Client confirms work (P2P) — no escrow payout.');
      }

      await fetchProfileData();
      await fetchMarketplaceJobs();

      setTimeout(() => closeProofModal(), 2500);
    } catch (err: any) {
      console.error('Proof upload error:', err);
      setProofError(err?.message || 'Failed to upload photos. Please try again.');
    } finally {
      setProofProcessingImage(false);
      setProofSubmitting(false);
    }
  };

  const handleConfirmWorkDone = async (job: Job): Promise<boolean> => {
    if (!job.cleaner_id) {
      toast.error(t('reviewMissionNoContact'));
      return false;
    }
    if (releasePaySubmitting || rejectProofSubmitting) return false;
    try {
      setReleasePaySubmitting(true);
      const { error: rpcErr } = await supabase.rpc('confirm_mission_work_done', {
        p_mission_id: job.id,
      });
      if (rpcErr) throw rpcErr;

      setMyCityJobs((prev) => prev.filter((j) => j.id !== job.id));
      setMyHomeJobs((prev) => prev.filter((j) => j.id !== job.id));

      await notifyMissionEvent(job.id, 'mission_approved');

      window.dispatchEvent(
        new CustomEvent(APP_EVENT_MISSION_COMPLETED, { detail: { missionId: job.id } })
      );

      await fetchProfileData();
      toast.success(t('missionCompletedSuccess'));
      if (job.cleaner_id) {
        setRatingTarget({
          missionId: job.id,
          revieweeId: job.cleaner_id,
          role: 'worker',
          cleanerId: job.cleaner_id,
        });
      }
      return true;
    } catch (err: any) {
      console.error('Confirm work done error:', err);
      toast.error(err?.message || 'Failed to close mission. Please try again.');
      return false;
    } finally {
      setReleasePaySubmitting(false);
    }
  };

  const handleCreatorRejectProof = async (job: Job): Promise<boolean> => {
    if (releasePaySubmitting || rejectProofSubmitting) return false;
    const reason = window.prompt(
      t('creatorRejectProofPrompt', {
        defaultValue: 'What should the worker fix? (required)',
      })
    );
    if (reason == null) return false;
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.error(t('creatorRejectProofReasonRequired', { defaultValue: 'Rejection reason is required' }));
      return false;
    }
    try {
      setRejectProofSubmitting(true);
      await creatorRejectProof({ missionId: job.id, reason: trimmed });
      await notifyMissionEvent(job.id, 'proof_rejected');
      closeReviewModal();
      await fetchProfileData();
      toast.success(
        t('creatorRejectProofSuccess', {
          defaultValue: 'Proof rejected — worker can upload again.',
        })
      );
      return true;
    } catch (err: any) {
      console.error('Creator reject proof error:', err);
      toast.error(err?.message || 'Failed to reject proof. Please try again.');
      return false;
    } finally {
      setRejectProofSubmitting(false);
    }
  };

  const handleAdminDeleteMission = async (missionId: string) => {
    if (!isAdmin) return;
    if (!window.confirm(t('adminDeleteMissionConfirm'))) return;
    try {
      setAdminDeleteMissionId(missionId);
      await adminDeleteMission(missionId);
      setMyCityJobs((prev) => prev.filter((j) => j.id !== missionId));
      setMyHomeJobs((prev) => prev.filter((j) => j.id !== missionId));
      setMyActiveJobs((prev) => prev.filter((j) => j.id !== missionId));
      setMissionHistory((prev) => prev.filter((j) => j.id !== missionId));
      if (reviewJob?.id === missionId) closeReviewModal();
      await fetchProfileData();
      toast.success(t('adminDeleteMissionSuccess'));
    } catch (err: any) {
      console.error('Admin delete mission error:', err);
      toast.error(err?.message || 'Failed to delete mission.');
    } finally {
      setAdminDeleteMissionId(null);
    }
  };

  const LegalModal = ({
    title,
    body,
    onClose: close,
  }: {
    title: string;
    body: string;
    onClose: () => void;
  }) => {
    return (
      <div
        className="fixed inset-0 z-[9997] bg-black/70 backdrop-blur-sm"
        onClick={close}
        aria-hidden="false"
      >
        <div
          className="fixed inset-0 z-[9998] flex max-w-[100vw] flex-col overflow-x-hidden bg-slate-950/95 backdrop-blur-xl pt-[env(safe-area-inset-top)]"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-cyan-500/15">
            <button
              type="button"
              onClick={close}
              className="p-2 mr-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all"
              aria-label="Close"
            >
              ✕
            </button>
            <h2 className="flex-1 text-left text-sm font-black uppercase tracking-[0.2em] text-white">
              {title}
            </h2>
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-10">
            <p className="mt-5 text-sm leading-relaxed text-slate-300 whitespace-pre-wrap">
              {body}
            </p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
    <AnimatePresence>
      {isOpen && (
    <motion.div
      key="profile-overlay"
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6 isolate max-w-[100vw] overflow-hidden"
      aria-modal="true"
      role="dialog"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Backdrop — dims map behind the floating card */}
      <motion.div
        className="absolute inset-0 z-0 bg-black/65 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
      />
      {/* Floating frosted card — blooms from the bottom-center Profile FAB */}
      <motion.div
        className="relative z-10 flex h-full w-full min-w-0 max-w-lg min-h-0 flex-col overflow-hidden animated-border animated-border-profile"
        style={{
          maxHeight:
            'calc(100svh - 2rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))',
          transformOrigin: 'bottom center',
        }}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320, mass: 0.85 }}
      >
        <div className="animated-border-inner flex h-full min-h-0 w-full max-w-full flex-1 flex-col overflow-x-hidden">
          {/* Header — sticky; frosted so content can scroll under */}
          <div className="sticky top-0 z-50 flex flex-shrink-0 items-center justify-between border-b border-white/10 bg-[linear-gradient(135deg,rgba(50,50,55,0.82)_0%,rgba(40,40,45,0.9)_100%)] px-5 pb-4 pt-4 backdrop-blur-xl shadow-lg shadow-black/30">
            <button
              type="button"
              onClick={onClose}
              className="p-2 mr-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all"
              aria-label="Close"
            >
              ✕
            </button>
            {/* Personalized title only — no "Your account" / welcome filler. */}
            <h1 className="min-w-0 flex-1 truncate text-left text-lg font-bold tracking-tight text-white">
              {profileDisplayName || '…'}
            </h1>
            {isContractorCabinet && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-emerald-200">
                <Store className="h-3 w-3" aria-hidden />
                {t('profileRoleContractor', { defaultValue: 'Contractor' })}
              </span>
            )}
            {!isContractorCabinet && userProfile && (
              <span className="inline-flex shrink-0 items-center rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-cyan-200">
                {t('profileRoleCustomer', { defaultValue: 'Customer' })}
              </span>
            )}
          </div>
          {/* Scrollable content — job cards and forms */}
          <div className="flex max-w-full min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto overscroll-y-contain p-4 pb-[max(9rem,calc(env(safe-area-inset-bottom,0px)+5rem))]">
          <div className="w-full max-w-md mx-auto flex flex-col gap-3 min-w-0">
        {showAdmin ? (
          <AdminDashboard onBack={() => setShowAdmin(false)} />
        ) : (
          <>
        {/* HEADER: Avatar + rating + actions (name is ONLY in the sticky title). */}
        <header className="mb-2 text-white">
          <div className="flex items-center gap-4 min-w-0">
            <label className="relative inline-flex shrink-0 items-center justify-center h-14 w-14 rounded-full bg-gradient-to-br from-emerald-500/40 to-cyan-500/20 border border-white/20 shadow-[0_0_20px_rgba(16,185,129,0.4)] cursor-pointer overflow-hidden group">
              {avatarUploading ? (
                <div className="h-6 w-6 border-2 border-emerald-400/40 border-t-emerald-400 rounded-full animate-spin" />
              ) : userProfile?.avatar_url ? (
                <img
                  src={userProfile.avatar_url}
                  alt={profileDisplayName || 'Avatar'}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-xl font-black uppercase text-emerald-300">
                  {(profileDisplayName || 'C').charAt(0)}
                </span>
              )}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarUpload}
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] uppercase tracking-[0.18em] text-emerald-300 font-bold transition-opacity">
                Change
              </div>
            </label>
            <div className="min-w-0 flex-1">
              {/* Rating badge only — no welcome / "your account" subtitle. */}
              {userProfile?.rating != null ? (
                <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-400/40 px-2.5 py-0.5">
                  <span className="text-[11px] font-bold text-amber-300">
                    {userProfile.rating.toFixed(1)}
                  </span>
                  <span className="text-xs">⭐</span>
                </div>
              ) : (
                <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-slate-800/60 border border-slate-600/60 px-2.5 py-0.5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300">
                    New Hero
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Top up + AR toggle + language — always visible header actions */}
          <div className="mt-2 flex flex-wrap items-center justify-end gap-2" ref={langMenuRef}>
            <button
              type="button"
              onClick={() => setShowTokenPackModal(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-lime-400/45 bg-lime-500/15 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-lime-200 shadow-[0_0_12px_rgba(132,204,22,0.2)] hover:bg-lime-500/25 hover:border-lime-300/55 transition-all"
            >
              <Coins className="h-3.5 w-3.5 shrink-0 text-lime-300" aria-hidden />
              {t('topUpShort')}
            </button>
            {onOpenAR && (
              <button
                type="button"
                onClick={onOpenAR}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-cyan-400/45 bg-cyan-500/15 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.2)] hover:bg-cyan-500/25 hover:border-cyan-300/55 transition-all"
                title="AR mission view"
              >
                <Target className="h-3.5 w-3.5 shrink-0 text-cyan-300" aria-hidden />
                AR
              </button>
            )}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setLangMenuOpen((o) => !o)}
                className="inline-flex items-center gap-2 rounded-full border border-cyan-500/35 bg-cyan-950/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-200 hover:border-cyan-400/50 hover:bg-cyan-950/60 transition-all"
                aria-expanded={langMenuOpen}
                aria-haspopup="listbox"
              >
                <Globe className="h-4 w-4 text-cyan-400/90" aria-hidden />
                <span>
                  {languageOptions.find((o) => (i18n.language || '').startsWith(o.code))?.short ?? 'EN'}
                </span>
              </button>
              {langMenuOpen && (
                <div
                  className="absolute right-0 top-full z-[100] mt-2 min-w-[11rem] rounded-2xl border border-white/10 bg-[#0a1628]/98 backdrop-blur-xl py-1.5 shadow-2xl shadow-black/50 ring-1 ring-cyan-500/20"
                  role="listbox"
                >
                  {languageOptions.map(({ code, labelKey, short }) => {
                    const active = (i18n.language || '').startsWith(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => {
                          void i18n.changeLanguage(code);
                          setLangMenuOpen(false);
                        }}
                        className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                          active
                            ? 'bg-emerald-500/15 text-emerald-200'
                            : 'text-slate-300 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        <span>{t(labelKey)}</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          {short}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </header>

        <ProfileAccordion
          title={t('profileInfoOverview')}
          icon={<Info className="w-5 h-5 shrink-0 text-cyan-400/90" aria-hidden />}
          closedSummary={profileInfoClosedSummary}
        >
          <div className="space-y-4">
            {/* SaaS token wallet */}
            <div className="rounded-2xl border border-lime-400/35 bg-gradient-to-br from-lime-500/15 via-slate-950/80 to-cyan-950/40 p-4 shadow-[0_0_24px_rgba(132,204,22,0.12)] backdrop-blur-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-lime-300/90">
                    {t('tokenWalletTitle', { defaultValue: 'Token wallet' })}
                  </p>
                  <p className="mt-1.5 text-xl font-black tabular-nums tracking-tight text-lime-100 sm:text-2xl">
                    {t('tokenWalletAvailable', {
                      count: tokenBalance,
                      defaultValue: 'Available Tokens: {{count}} 🪙',
                    })}
                  </p>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                    {t('tokenWalletHint', {
                      defaultValue:
                        'Tokens boost pins and crowdfunding. Work pay is P2P between client and worker.',
                    })}
                  </p>
                </div>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-lime-400/40 bg-lime-500/15 text-lime-300 shadow-[0_0_14px_rgba(132,204,22,0.25)]">
                  <Coins className="h-5 w-5" aria-hidden />
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowTokenPackModal(true)}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-lime-400/50 bg-lime-500/20 px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] text-lime-100 shadow-[0_0_16px_rgba(132,204,22,0.22)] transition-all hover:bg-lime-500/30 hover:border-lime-300/60 active:scale-[0.98]"
              >
                <Coins className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {t('topUpTokens', { defaultValue: 'Top up tokens' })}
              </button>
            </div>

            {/* Subscription validity + double-pay protection */}
            <div
              className={`rounded-2xl border p-4 backdrop-blur-md ${
                subscriptionIsActive
                  ? 'border-emerald-400/40 bg-gradient-to-br from-emerald-500/15 via-slate-950/80 to-cyan-950/30 shadow-[0_0_22px_rgba(16,185,129,0.14)]'
                  : 'border-amber-400/35 bg-gradient-to-br from-amber-500/12 via-slate-950/80 to-rose-950/20 shadow-[0_0_18px_rgba(245,158,11,0.1)]'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles
                  className={`h-4 w-4 shrink-0 ${
                    subscriptionIsActive ? 'text-emerald-300' : 'text-amber-300'
                  }`}
                  aria-hidden
                />
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-200">
                  {t('subscriptionBannerTitle', { defaultValue: 'Subscription' })}
                </p>
                {subscriptionIsActive ? (
                  <>
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/45 bg-emerald-500/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-emerald-100">
                      <BadgeCheck className="h-3 w-3" aria-hidden />
                      {t('subscriptionActive', { defaultValue: 'Active' })}
                    </span>
                    <span className="inline-flex items-center rounded-full border border-cyan-400/40 bg-cyan-500/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-cyan-100">
                      {t('subscriptionPaidBadge', { defaultValue: 'Paid' })}
                    </span>
                  </>
                ) : (
                  <span className="inline-flex items-center rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-amber-100">
                    {t('subscriptionExpired', { defaultValue: 'Expired' })}
                  </span>
                )}
              </div>

              {subscriptionPeriod ? (
                <p className="mt-2.5 text-sm font-semibold leading-snug text-white">
                  {t('subscriptionValidRange', {
                    start: subscriptionPeriod.startLabel,
                    end: subscriptionPeriod.endLabel,
                    defaultValue:
                      'Active Subscription: Valid from {{start}} until {{end}}',
                  })}
                </p>
              ) : (
                <p className="mt-2.5 text-sm font-semibold text-slate-300">
                  {t('subscriptionNoneHint', {
                    defaultValue: 'No active subscription yet.',
                  })}
                </p>
              )}

              {subscriptionIsActive && subscriptionPeriod ? (
                <p className="mt-1 text-[11px] text-emerald-200/85">
                  {t('subscriptionDaysRemaining', {
                    count: subscriptionPeriod.daysLeft,
                    defaultValue: '{{count}} days remaining',
                  })}
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-amber-100/80">
                  {t('subscriptionExpiredHint', {
                    defaultValue:
                      'Subscribe to unlock client contacts on the map.',
                  })}
                </p>
              )}

              <button
                type="button"
                onClick={() => setShowSubscriptionModal(true)}
                title={
                  subscriptionIsActive && subscriptionPeriod
                    ? t('extendSubscriptionTooltip', {
                        count: subscriptionPeriod.daysLeft,
                        defaultValue:
                          'Adds another year after your current period ({{count}} days left). Avoids double-paying the same window.',
                      })
                    : t('subscribeNow', { defaultValue: 'Subscribe' })
                }
                className={`mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] transition-all active:scale-[0.98] ${
                  subscriptionIsActive
                    ? 'border-emerald-400/45 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25'
                    : 'border-amber-400/45 bg-amber-500/20 text-amber-50 shadow-[0_0_14px_rgba(245,158,11,0.2)] hover:bg-amber-500/30'
                }`}
              >
                {subscriptionIsActive
                  ? t('extendSubscription', { defaultValue: 'Extend subscription' })
                  : t('subscribeNow', { defaultValue: 'Subscribe' })}
              </button>
            </div>

            {/* KYC status */}
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {verificationStatusKey === 'verified' ? (
                  <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-emerald-200">
                    {t('kycTrustedBadge', { defaultValue: 'Trusted' })}
                  </span>
                ) : verificationStatusKey === 'pending' ? (
                  <span className="inline-flex items-center rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-amber-200">
                    {t('kycUnderReviewBadge', { defaultValue: 'Under Review' })}
                  </span>
                ) : verificationStatusKey === 'rejected' ? (
                  <span className="inline-flex items-center rounded-full border border-red-400/30 bg-red-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-red-200">
                    {t('kycRejectedBadge', { defaultValue: 'Rejected' })}
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-slate-200">
                    {t('kycUnverifiedBadge', { defaultValue: 'Unverified' })}
                  </span>
                )}
              </div>

              {mutedCount > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2">
                  <p className="text-[11px] font-semibold text-rose-100">
                    {t('mutedCreatorsCount', {
                      count: mutedCount,
                      defaultValue: 'Muted creators: {{count}}',
                    })}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      clearMuted();
                      toast.success(
                        t('mutedCreatorsCleared', {
                          defaultValue: 'Muted creators list cleared — pins restored',
                        })
                      );
                    }}
                    className="rounded-full border border-rose-400/40 bg-black/30 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-rose-200 transition-colors hover:bg-rose-500/20 active:scale-95"
                  >
                    {t('mutedCreatorsReset', { defaultValue: 'Reset' })}
                  </button>
                </div>
              )}

              {verificationStatusKey === 'verified' ? (
                <p className="text-[11px] leading-relaxed text-slate-300">
                  {t('kycVerifiedHint', {
                    defaultValue: 'You can accept restricted Home/Private missions.',
                  })}
                </p>
              ) : verificationStatusKey === 'pending' ? (
                <p className="text-[11px] leading-relaxed text-slate-400">
                  {t('kycPendingHint', { defaultValue: 'We are reviewing your documents.' })}
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowVerificationModal(true)}
                  className="w-full rounded-full border border-cyan-400/35 bg-cyan-600/90 py-2.5 text-[10px] font-black uppercase tracking-[0.12em] text-white shadow-[0_4px_18px_rgba(34,211,238,0.16)] transition-colors hover:bg-cyan-500/95"
                >
                  {t('kycStartButton', { defaultValue: 'Start KYC' })}
                </button>
              )}
            </div>

            {/* Contact & credentials */}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (contactSubmitting) return;
                setContactSaved(false);
                try {
                  setContactSubmitting(true);
                  const { data: { session } } = await supabase.auth.getSession();
                  if (!session?.user?.id) {
                    alert('You must be logged in to save contact info.');
                    return;
                  }
                  const updates = {
                    contact_email: contactEmail || null,
                    phone_number: phoneNumber || null,
                    telegram_username: telegramUsername || null,
                  };
                  const { error } = await supabase
                    .from('profiles')
                    .update(updates)
                    .eq('id', session.user.id);
                  if (error) {
                    alert(error.message || 'Failed to save contact information.');
                    return;
                  }
                  setContactSaved(true);
                  setContactEditMode(false);
                } catch (err: any) {
                  alert(err?.message || 'Failed to save contact information.');
                } finally {
                  setContactSubmitting(false);
                }
              }}
              className="space-y-3 w-full min-w-0"
            >
              <p className="text-[11px] text-slate-500 leading-relaxed">{t('contactInfoHint')}</p>
              {contactEditMode ? (
                <div className="flex flex-col gap-3 w-full min-w-0">
                  <div className="w-full min-w-0">
                    <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
                      {t('email')}
                    </label>
                    <input
                      type="email"
                      value={contactEmail}
                      onChange={(e) => {
                        setContactEmail(e.target.value);
                        setContactSaved(false);
                      }}
                      className={`w-full min-w-0 ${PROFILE_GLASS_PANEL} px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500`}
                      placeholder="you@example.com"
                    />
                  </div>
                  <div className="w-full min-w-0">
                    <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
                      {t('phoneWhatsApp')}
                    </label>
                    <input
                      type="tel"
                      value={phoneNumber}
                      onChange={(e) => {
                        setPhoneNumber(e.target.value);
                        setContactSaved(false);
                      }}
                      className={`w-full min-w-0 ${PROFILE_GLASS_PANEL} px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500`}
                      placeholder="+20 1X XXX XXXX"
                    />
                  </div>
                  <div className="w-full min-w-0">
                    <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
                      {t('telegramUsername')}
                    </label>
                    <input
                      type="text"
                      value={telegramUsername}
                      onChange={(e) => {
                        setTelegramUsername(e.target.value);
                        setContactSaved(false);
                      }}
                      className={`w-full min-w-0 ${PROFILE_GLASS_PANEL} px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500`}
                      placeholder="@username"
                    />
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 flex items-start justify-between gap-2 w-full min-w-0">
                  <div className="flex flex-col gap-2 text-xs text-slate-300 w-full min-w-0">
                    <p className="break-all">
                      <span className="text-slate-500">{t('email')}: </span>
                      {contactEmail || '—'}
                    </p>
                    <p className="break-all">
                      <span className="text-slate-500">{t('phoneWhatsApp')}: </span>
                      {phoneNumber || '—'}
                    </p>
                    <p className="break-all">
                      <span className="text-slate-500">{t('telegramUsername')}: </span>
                      {telegramUsername || '—'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setContactEditMode(true)}
                    className="h-7 w-7 shrink-0 rounded-full border border-white/15 bg-white/5 text-slate-300 hover:text-white hover:bg-white/10 inline-flex items-center justify-center transition-all active:scale-95"
                    aria-label="Edit contacts"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <div className="flex justify-end">
                {contactEditMode ? (
                  <button
                    type="submit"
                    disabled={contactSubmitting}
                    className="inline-flex items-center justify-center rounded-full px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] bg-slate-800 text-slate-100 hover:bg-slate-700 disabled:opacity-60 disabled:cursor-wait active:scale-95"
                  >
                    {contactSubmitting ? t('processing') : t('saveContact')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setContactEditMode(true)}
                    className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-400 hover:text-cyan-300"
                  >
                    {t('edit')}
                  </button>
                )}
              </div>
            </form>

            <div className="border-t border-white/10" />

            {/* Security — change password */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 shrink-0 text-slate-300/90" aria-hidden />
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-300">
                  {t('changePassword')}
                </p>
              </div>

              <form onSubmit={handleChangePassword} className="space-y-3">
                <p className="text-[11px] text-slate-500">{t('changePasswordHint')}</p>
                {passwordEditMode ? (
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
                        {t('newPassword')}
                      </label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => {
                          setNewPassword(e.target.value);
                          setPasswordSaved(false);
                        }}
                        className={`w-full ${PROFILE_GLASS_PANEL} px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500`}
                        placeholder="At least 8 characters"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
                        {t('confirmPassword')}
                      </label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => {
                          setConfirmPassword(e.target.value);
                          setPasswordSaved(false);
                        }}
                        className={`w-full ${PROFILE_GLASS_PANEL} px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500`}
                        placeholder="Re-enter password"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-400">{t('passwordSetHint')}</p>
                    <button
                      type="button"
                      onClick={() => setPasswordEditMode(true)}
                      className="h-7 w-7 shrink-0 rounded-full border border-white/15 bg-white/5 text-slate-300 hover:text-white hover:bg-white/10 inline-flex items-center justify-center transition-all active:scale-95"
                      aria-label="Edit password"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {passwordError && (
                  <p className="text-[11px] text-red-400 font-medium">{passwordError}</p>
                )}
                {passwordSuccess && (
                  <p className="text-[11px] text-emerald-400 font-medium">{passwordSuccess}</p>
                )}
                <div className="flex justify-end">
                  {passwordEditMode ? (
                    <button
                      type="submit"
                      disabled={passwordSubmitting}
                      className="inline-flex items-center justify-center rounded-full px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] bg-emerald-500 text-black hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-wait active:scale-95"
                    >
                      {passwordSubmitting ? t('processing') : t('savePassword')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPasswordEditMode(true)}
                      className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-400 hover:text-cyan-300"
                    >
                      {t('edit')}
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        </ProfileAccordion>

        {/* MY STORE — contractor storefront (office, coverage, services, materials) */}
        {(isContractorCabinet || !!userProfile) && userProfile?.id && (
          <ProfileAccordion
            title={t('myStore', { defaultValue: 'My Store' })}
            icon={<Store className="w-5 h-5 shrink-0 text-emerald-400/90" aria-hidden />}
            closedSummary={
              hasContractorStore
                ? t('storePublishedBadge', { defaultValue: 'Storefront is live' })
                : t('storeOpenCta', { defaultValue: 'Open your business storefront' })
            }
            defaultOpen={false}
          >
            <ContractorStorePanel
              userId={userProfile.id}
              embedded
              onStorePresenceChange={setHasContractorStore}
            />
          </ProfileAccordion>
        )}

        {/* MY ORDERS — owned pins (home + public) + active worker jobs */}
        <ProfileAccordion
          title={t('myOrders')}
          icon={<Building2 className="w-5 h-5 shrink-0 text-amber-400/90" aria-hidden />}
          closedSummary={profileOrdersClosedSummary}
        >
          <div className="space-y-5">
            <div className="space-y-3">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                {t('profileOwnedMissions')}
              </p>
              {loading ? (
                <p className="text-slate-500 text-sm italic">{t('loading')}</p>
              ) : ownedOpenMissions.length === 0 ? (
                <p className="text-slate-500 text-sm italic">{t('customerNoOrdersEmpty')}</p>
              ) : (
                ownedOpenMissions.map((job) => {
                  const isPhantomPayment = job.status === 'pending_payment';
                  const isHome = String(job.category || '').toLowerCase() === 'home';
                  const icon = missionPinIcon(undefined, job.category);
                  const hasPhoto = Array.isArray(job.photo_urls) && !!job.photo_urls[0];
                  const statusKey = String(job.status || '').toLowerCase();
                  const openForBids =
                    (statusKey === 'pending' ||
                      statusKey === 'available' ||
                      statusKey === 'funding') &&
                    !job.cleaner_id;
                  const waitingSelectedCleaner =
                    statusKey === 'funding' && !!job.cleaner_id;
                  const creatorAvatar =
                    job.creator?.avatar_url ?? userProfile?.avatar_url ?? null;
                  const creatorName =
                    job.creator?.full_name ??
                    userProfile?.full_name ??
                    null;
                  const creatorId = job.creator_id ?? userProfile?.id ?? null;

                  const locate = () => {
                    if (
                      onNavigateToJob &&
                      typeof job.location_lat === 'number' &&
                      typeof job.location_lng === 'number'
                    ) {
                      onNavigateToJob(job.location_lat, job.location_lng);
                    }
                    onClose();
                  };

                  const fundingCallout = (() => {
                    if (!waitingSelectedCleaner) return undefined;
                    const target = Math.max(
                      0,
                      Math.floor(Number(job.expected_price ?? job.amount_target ?? 0))
                    );
                    const raised = Math.max(0, Math.floor(Number(job.current_funding ?? 0)));
                    const remaining = Math.max(0, target - raised);
                    return (
                      <span className="inline-flex max-w-full rounded-lg border border-violet-400/45 bg-violet-600/85 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-white shadow-[0_4px_14px_rgba(139,92,246,0.35)] backdrop-blur-sm">
                        {t('feedCleanerLockedNeedsMore', {
                          amount: remaining,
                          defaultValue:
                            'Cleaner locked in! Needs ${{amount}} more to start',
                        })}
                      </span>
                    );
                  })();

                  const orderFooter = (
                    <div className="space-y-3">
                      <p className="text-[10px] font-medium text-lime-300/90">
                        {t('missionTokenBidLabel')}: {formatTokens(missionTokenBid(job))}
                      </p>
                      <p className="text-xs text-slate-400">{t('profileOwnedMissionHint')}</p>

                      {isPhantomPayment && (
                        <>
                          <p className="text-[10px] text-slate-400 leading-snug">
                            {t('tokenOnlyNote')}
                          </p>
                          <button
                            type="button"
                            disabled={phantomPaymentActionId === job.id}
                            onClick={() =>
                              cancelPendingPaymentMission(
                                job,
                                isHome ? 'home' : 'city'
                              )
                            }
                            className="rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-red-300 bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {t('cancelMission')}
                          </button>
                        </>
                      )}

                      {isAdmin && !isPhantomPayment && (
                        <button
                          type="button"
                          onClick={() => handleAdminDeleteMission(job.id)}
                          disabled={adminDeleteMissionId === job.id}
                          className="w-full rounded-full border border-red-500/50 bg-red-500/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                        >
                          {adminDeleteMissionId === job.id
                            ? t('processing')
                            : t('adminDeleteMission')}
                        </button>
                      )}

                      {openForBids && (
                        <div>
                          {(() => {
                            const bids = (jobBidsById[job.id] || []).filter(
                              (b) => b.status === 'pending'
                            );
                            return (
                              <>
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                                  {t('activeOffers')}:{' '}
                                  <span className="text-emerald-400">{bids.length}</span>
                                </p>
                                {bids.length > 0 ? (
                                  <div className="space-y-2">
                                    {bids.map((bid) => {
                                      const packages = bid.offer_packages ?? [];
                                      if (packages.length > 0) {
                                        return (
                                          <div
                                            key={bid.id}
                                            className={`space-y-2 px-3 py-2 ${PROFILE_GLASS_PANEL} !rounded-xl`}
                                          >
                                            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                                              {t('bidPackagesLabel', {
                                                defaultValue: 'Tiered offers',
                                              })}
                                            </p>
                                            {packages.map((pkg) => (
                                              <div
                                                key={pkg.id}
                                                className="rounded-lg border border-violet-400/25 bg-violet-500/10 px-2.5 py-2"
                                              >
                                                <div className="flex items-start justify-between gap-2">
                                                  <div className="min-w-0">
                                                    <p className="text-xs font-bold text-white">
                                                      {pkg.title}
                                                    </p>
                                                    {pkg.description && (
                                                      <p className="mt-0.5 text-[10px] text-slate-400">
                                                        {pkg.description}
                                                      </p>
                                                    )}
                                                  </div>
                                                  <span className="shrink-0 text-sm font-black text-emerald-400">
                                                    {formatWorkBudgetUsd(pkg.price)}
                                                  </span>
                                                </div>
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    handleAcceptBid(job, bid, pkg.id)
                                                  }
                                                  className="mt-2 w-full rounded-full border border-emerald-400/40 bg-emerald-500/20 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-50"
                                                >
                                                  {t('acceptPackageOffer', {
                                                    defaultValue: 'Accept this package',
                                                  })}
                                                </button>
                                              </div>
                                            ))}
                                          </div>
                                        );
                                      }
                                      return (
                                      <div
                                        key={bid.id}
                                        className={`flex items-center justify-between gap-3 px-3 py-2 ${PROFILE_GLASS_PANEL} !rounded-xl`}
                                      >
                                        <span className="text-sm font-black text-emerald-400">
                                          {t('workBidUsdLabel')}:{' '}
                                          {formatWorkBudgetUsd(Number(bid.bid_amount))}
                                        </span>
                                        <div className="rounded-full animated-border-city">
                                          <button
                                            type="button"
                                            onClick={() => handleAcceptBid(job, bid)}
                                            className="animated-border-inner w-full rounded-full bg-[#020617] px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white transition-all hover:brightness-110 active:scale-[0.98]"
                                          >
                                            {t('acceptOffer')}
                                          </button>
                                        </div>
                                      </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <p className="text-xs italic text-slate-500">
                                    {t('noOffersYet')}
                                  </p>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}

                      {job.status === 'review' && job.cleaner_id && (
                        <div>
                          <p className="w-full rounded-full border border-amber-500/30 bg-amber-500/10 py-3 text-center text-xs font-black uppercase tracking-[0.2em] text-amber-300">
                            {t('pendingReview')}
                          </p>
                          <p className="mt-2 text-center text-[10px] uppercase tracking-wider text-slate-500">
                            {t('reviewMissionAwaitingPayment')}
                          </p>
                          <button
                            type="button"
                            onClick={() => setReviewJob(job)}
                            disabled={releasePaySubmitting}
                            className={`mt-3 ${CLIENT_APPROVE_RELEASE_BTN_LIST}`}
                          >
                            {t('reviewMissionOpenButton')}
                          </button>
                        </div>
                      )}
                      {job.status === 'pending_approval' && job.cleaner_id && (
                        <div>
                          <button
                            type="button"
                            onClick={() => setReviewJob(job)}
                            disabled={releasePaySubmitting}
                            className={CLIENT_APPROVE_RELEASE_BTN_LIST}
                          >
                            {t('reviewMissionOpenButton')}
                          </button>
                          <p className="mt-2 text-center text-[10px] uppercase tracking-wider text-slate-500">
                            {t('workerMarkedCompletedHint')}
                          </p>
                        </div>
                      )}
                      {(job.status === 'completed' || job.status === 'finished') &&
                        job.cleaner_id && (
                          <p className="w-full rounded-full border border-emerald-500/30 bg-emerald-500/10 py-3 text-center text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
                            {t('missionAccomplishedPaid')}
                          </p>
                        )}
                    </div>
                  );

                  return (
                    <MissionFeedCard
                      key={job.id}
                      photo={
                        hasPhoto ? (
                          <ModeratedMissionPhoto
                            url={job.photo_urls![0]}
                            alt=""
                            showSafeBadge={false}
                            className="h-full w-full"
                            imgClassName="h-full w-full object-cover"
                          />
                        ) : undefined
                      }
                      placeholderVariant={isHome ? 'home' : 'city'}
                      placeholderIcon={icon}
                      budgetValue={formatWorkBudgetUsd(missionWorkBudgetUsd(job))}
                      metaLine={`#${shortId(job.id)} · ${new Date(job.created_at).toLocaleDateString()}`}
                      locationLine={orderMissionLocationLine(job)}
                      description={extractMissionFeedDescription(job.description)}
                      submittedLabel={`${t('submittedLabel')}: ${formatSubmittedRelative(
                        job.created_at,
                        i18n.language
                      )}`}
                      topLeftBadge={
                        <span className="rounded-full border border-emerald-400/50 bg-emerald-500/30 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-emerald-100 backdrop-blur-sm">
                          {t('yourTaskBadge')}
                        </span>
                      }
                      statusBadge={
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] backdrop-blur-sm ${orderStatusBadgeClass(
                            statusKey
                          )}`}
                        >
                          {isPhantomPayment
                            ? t('paymentPendingBadge')
                            : `${t('status')}: ${statusKey || '—'}`}
                        </span>
                      }
                      callout={fundingCallout}
                      onPhotoClick={() => openImmersiveFeed(job.id, ownedOpenMissions)}
                      photoAriaLabel={t('immersiveOpenFeed', {
                        defaultValue: 'Open visual feed',
                      })}
                      onLocate={
                        typeof job.location_lat === 'number' &&
                        typeof job.location_lng === 'number'
                          ? locate
                          : undefined
                      }
                      locateAriaLabel={t('locateOnMap')}
                      creatorAvatarUrl={creatorAvatar}
                      creatorName={creatorName}
                      creatorAriaLabel={t('viewCreatorProfile')}
                      onCreatorClick={
                        creatorId
                          ? () => {
                              onClose();
                              navigate(`/profile/${creatorId}`);
                            }
                          : undefined
                      }
                      footer={orderFooter}
                    />
                  );
                })
              )}
            </div>

            <div className="space-y-3 border-t border-white/10 pt-4">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                {t('profileActiveWork')}
              </p>
              {loading ? (
                <p className="text-slate-500 text-sm italic">{t('loading')}</p>
              ) : activeWorkJobs.length === 0 ? (
                <p className="text-slate-500 text-sm italic">{t('profileActiveWorkEmpty')}</p>
              ) : (
                activeWorkJobs.map((job) => {
                  const isHome = String(job.category || '').toLowerCase() === 'home';
                  const icon = missionPinIcon(undefined, job.category);
                  const hasPhoto = Array.isArray(job.photo_urls) && !!job.photo_urls[0];
                  const statusKey = String(job.status || '').toLowerCase();

                  return (
                    <MissionFeedCard
                      key={job.id}
                      photo={
                        hasPhoto ? (
                          <ModeratedMissionPhoto
                            url={job.photo_urls![0]}
                            alt=""
                            showSafeBadge={false}
                            className="h-full w-full"
                            imgClassName="h-full w-full object-cover"
                          />
                        ) : undefined
                      }
                      placeholderVariant={isHome ? 'home' : 'city'}
                      placeholderIcon={icon}
                      budgetValue={formatWorkBudgetUsd(missionWorkBudgetUsd(job))}
                      metaLine={`#${shortId(job.id)} · ${new Date(job.created_at).toLocaleDateString()}`}
                      locationLine={orderMissionLocationLine(job)}
                      description={extractMissionFeedDescription(job.description)}
                      submittedLabel={`${t('submittedLabel')}: ${formatSubmittedRelative(
                        job.created_at,
                        i18n.language
                      )}`}
                      statusBadge={
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] backdrop-blur-sm ${orderStatusBadgeClass(
                            statusKey
                          )}`}
                        >
                          {t('status')}: {statusKey || '—'}
                        </span>
                      }
                      onPhotoClick={() => openImmersiveFeed(job.id, activeWorkJobs)}
                      photoAriaLabel={t('immersiveOpenFeed', {
                        defaultValue: 'Open visual feed',
                      })}
                      onLocate={
                        onNavigateToJob &&
                        typeof job.location_lat === 'number' &&
                        typeof job.location_lng === 'number'
                          ? () => {
                              onNavigateToJob(job.location_lat!, job.location_lng!);
                              onClose();
                            }
                          : undefined
                      }
                      locateAriaLabel={t('locateOnMap')}
                      creatorAvatarUrl={job.creator?.avatar_url ?? null}
                      creatorName={job.creator?.full_name ?? null}
                      creatorAriaLabel={t('viewCreatorProfile')}
                      onCreatorClick={
                        job.creator_id
                          ? () => {
                              onClose();
                              navigate(`/profile/${job.creator_id}`);
                            }
                          : undefined
                      }
                      footer={
                        job.rejection_reason ? (
                          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-100">
                            <span className="font-black uppercase tracking-wider text-amber-300">
                              {t('creatorRejectProofReasonLabel', {
                                defaultValue: 'Fix requested',
                              })}
                              :{' '}
                            </span>
                            {job.rejection_reason}
                          </p>
                        ) : undefined
                      }
                    />
                  );
                })
              )}
            </div>
          </div>
        </ProfileAccordion>

        <ProfileAccordion
          title={t('serviceMarketplace')}
          icon={<Globe className="w-5 h-5 shrink-0 text-emerald-400/90" aria-hidden />}
        >
          <div className="text-white pointer-events-auto relative z-10 w-full max-w-full min-w-0 overflow-x-hidden">
          {paymentSyncing && (
            <p className="text-[11px] font-bold text-emerald-400 mb-3 animate-pulse">
              🔄 Verifying your payment...
            </p>
          )}

          <div className="mb-4 w-full max-w-full min-w-0">
            <MissionFilterPanel
              sortMode={marketSortMode}
              onSortChange={setMarketSortMode}
              selectedTags={marketSelectedTags}
              onToggleTag={toggleMarketTag}
              onClearTags={clearMarketTags}
              resultCount={displayedMarketplaceJobs.length}
              countryIds={marketCountryIds}
              onCountryIdsChange={setMarketCountryIds}
              cityId={marketCityId}
              onCityChange={setMarketCityId}
              locationCatalog={locationCatalog}
              showFreeReports={showFreeReports}
              onShowFreeReportsChange={(show) => {
                setShowFreeReports(show);
                writeShowFreeReports(show);
              }}
            />
          </div>

          {marketLoading && (
            <div className="grid grid-cols-1 gap-4 mb-2">
              {[1, 2, 3].map((skeleton) => (
                <div
                  key={skeleton}
                  className={`${PROFILE_GLASS_PANEL} p-4 animate-pulse`}
                >
                  <div className="h-3 w-24 bg-slate-700 rounded-full mb-3" />
                  <div className="h-6 w-32 bg-slate-600 rounded-full mb-4" />
                  <div className="h-3 w-20 bg-slate-700 rounded-full ml-auto" />
                </div>
              ))}
            </div>
          )}

          {marketError && !marketLoading && (
            <p className="text-sm text-red-400 mb-4">{marketError}</p>
          )}

          {!marketLoading && !marketError && displayedMarketplaceJobs.length === 0 && (
            <p className="text-sm text-slate-500 italic">{t('noMissionsMatchFilters')}</p>
          )}

          {!marketLoading && !marketError && displayedMarketplaceJobs.length > 0 && (
            <div className="space-y-3 pointer-events-auto">
              {displayedMarketplaceJobs.map((job) => {
                  const isHome = job.category === 'home';
                  const icon = isHome ? '🏠' : '🌆';

                  return (
                  <MissionFeedCard
                    key={job.id}
                    photo={
                      Array.isArray(job.photo_urls) && job.photo_urls[0] ? (
                        <ModeratedMissionPhoto
                          url={job.photo_urls[0]}
                          alt=""
                          showSafeBadge={false}
                          className="h-full w-full"
                          imgClassName="h-full w-full object-cover"
                        />
                      ) : undefined
                    }
                    placeholderVariant={isHome ? 'home' : 'city'}
                    placeholderIcon={icon}
                    budgetValue={formatWorkBudgetUsd(missionWorkBudgetUsd(job))}
                    metaLine={`#${shortId(job.id)} · ${new Date(job.created_at).toLocaleDateString()}`}
                    locationLine={orderMissionLocationLine(job)}
                    description={extractMissionFeedDescription(job.description)}
                    statusBadge={
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] backdrop-blur-sm ${
                          isHome
                            ? 'border-amber-400/50 bg-amber-500/25 text-amber-100'
                            : 'border-emerald-400/50 bg-emerald-500/25 text-emerald-100'
                        }`}
                      >
                        {(job.category || 'UNKNOWN').toUpperCase()}
                      </span>
                    }
                    callout={(() => {
                      const status = String(job.status || '').toLowerCase();
                      if (status !== 'funding' || !job.cleaner_id) return undefined;
                      const target = Math.max(
                        0,
                        Math.floor(Number(job.expected_price ?? job.amount_target ?? 0))
                      );
                      const raised = Math.max(0, Math.floor(Number(job.current_funding ?? 0)));
                      const remaining = Math.max(0, target - raised);
                      return (
                        <span className="inline-flex max-w-full rounded-lg border border-violet-400/45 bg-violet-600/85 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-white shadow-[0_4px_14px_rgba(139,92,246,0.35)] backdrop-blur-sm">
                          {t('feedCleanerLockedNeedsMore', {
                            amount: remaining,
                            defaultValue:
                              'Cleaner locked in! Needs ${{amount}} more to start',
                          })}
                        </span>
                      );
                    })()}
                    onPhotoClick={() => openImmersiveFeed(job.id, displayedMarketplaceJobs)}
                    photoAriaLabel={t('immersiveOpenFeed', {
                      defaultValue: 'Open visual feed',
                    })}
                    onLocate={() => {
                      if (
                        onNavigateToJob &&
                        typeof job.location_lat === 'number' &&
                        typeof job.location_lng === 'number'
                      ) {
                        onNavigateToJob(job.location_lat, job.location_lng);
                      }
                      onClose();
                    }}
                    locateAriaLabel={t('locateOnMap')}
                    creatorAvatarUrl={job.creator?.avatar_url ?? null}
                    creatorName={job.creator?.full_name ?? null}
                    creatorAriaLabel={t('viewCreatorProfile')}
                    onCreatorClick={
                      job.creator_id
                        ? () => {
                            onClose();
                            navigate(`/profile/${job.creator_id}`);
                          }
                        : undefined
                    }
                  />
                );
              })}
            </div>
          )}
          </div>
        </ProfileAccordion>

        {/* HISTORY: cleaning + mission */}
        {userProfile && (
          <ProfileAccordion
            title={t('history')}
            icon={<Clock className="w-5 h-5 shrink-0 text-slate-300/90" aria-hidden />}
          >
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-slate-400">
              📜 {t('myCleaningHistory')}
            </h3>
            <div className="space-y-4">
              {(() => {
                const uid = userProfile.id;
                const finishedJobs: Job[] = [
                  ...(myHomeJobs || []),
                  ...(myCityJobs || []),
                  ...(myActiveJobs || []),
                  ...(missionHistory || []),
                ].filter(
                  (job, idx, arr) =>
                    isArchivedMissionStatus(job.status) &&
                    (job.creator_id === uid || job.cleaner_id === uid) &&
                    arr.findIndex((j) => j.id === job.id) === idx
                );

                if (finishedJobs.length === 0) {
                  return (
                    <p className="text-slate-500 text-sm italic">
                      {t('noFinishedJobsYet')}
                    </p>
                  );
                }

                return finishedJobs.map((job) => {
                  const isCreator = job.creator_id === uid;
                  const roleLabel = isCreator ? t('creator') : t('cleaner');
                const isHome = job.category === 'home';
                  const icon = isHome ? '🏠' : '🌆';
                  const createdDate = new Date(job.created_at).toLocaleDateString();
                  return (
                    <div
                      key={job.id}
                      className={`${PROFILE_GLASS_PANEL} p-4 opacity-90`}
                    >
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] text-slate-600 font-mono">
                          #{shortId(job.id)}
                        </span>
                        <span className="text-[10px] text-slate-600">
                          {createdDate}
                        </span>
                      </div>
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-700/40 text-slate-200 text-[10px] font-bold uppercase tracking-wider mb-3 border border-slate-500/60">
                        {job.status === 'completed' ? 'COMPLETED' : t('finished')}
                      </div>
                      <div className="flex justify-between items-center mb-2">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl opacity-90">{icon}</span>
                          <div>
                            <p className={`text-[10px] uppercase font-black tracking-widest px-2 py-0.5 rounded-full border ${isHome ? 'border-amber-500/30 text-amber-300' : 'border-emerald-500/30 text-emerald-400'}`}>
                              {(job.category || 'UNKNOWN').toUpperCase()} Mission
                            </p>
                            <p className={`text-xl font-black mt-1 ${isHome ? 'text-amber-400' : 'text-emerald-400'}`}>
                              {formatWorkBudgetUsd(missionWorkBudgetUsd(job))}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] text-slate-500 uppercase tracking-widest">
                            {t('role')}
                          </p>
                          <p className="text-xs font-bold text-slate-200">
                            {roleLabel}
                          </p>
                        </div>
                      </div>
                      {job.description && (
                        <p className="text-xs text-slate-400 mt-1">{job.description}</p>
                      )}
                      {(() => {
                        const revieweeId = isCreator ? job.cleaner_id : job.creator_id;
                        if (!revieweeId) return null;
                        return (
                          <button
                            type="button"
                            onClick={() =>
                              setRatingTarget({
                                missionId: job.id,
                                revieweeId,
                                role: isCreator ? 'worker' : 'creator',
                                cleanerId: job.cleaner_id,
                              })
                            }
                            className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-amber-200 transition-colors hover:bg-amber-500/20"
                          >
                            ⭐ {t('rateLeaveReview', { defaultValue: 'Rate & review' })}
                          </button>
                        );
                      })()}
                    </div>
                  );
                });
              })()}
            </div>

            <h3 className="mb-3 mt-8 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-slate-300">
              🏆 {t('missionHistory')}
            </h3>
            {loading ? (
              <p className="text-slate-500 text-sm italic">{t('loadingMissionHistory')}...</p>
            ) : (missionHistory || []).length === 0 ? (
              <p className="text-slate-500 text-sm italic">{t('noCompletedMissionsYet')}</p>
            ) : (
              <div className="space-y-3">
                {(missionHistory || []).map((job) => {
                  const uid = userProfile.id;
                  const isCreator = job.creator_id === uid;
                  const roleLabel = isCreator ? t('creator') : t('cleaner');
                  const isHome = job.category === 'home';
                  const icon = isHome ? '🏠' : '🌆';
                  const displayTitle =
                    job.title && job.title.trim().length > 0
                      ? job.title
                      : isHome
                        ? t('homeMission')
                        : t('cityMission');
                  const cleanerName = job.cleaner?.full_name || t('newHero');
                  const cleanerHandle = '';
                  const hasPhoto = Array.isArray(job.photo_urls) && !!job.photo_urls[0];

                  return (
                    <MissionFeedCard
                      key={job.id}
                      photo={
                        hasPhoto ? (
                          <ModeratedMissionPhoto
                            url={job.photo_urls![0]}
                            alt=""
                            showSafeBadge={false}
                            className="h-full w-full"
                            imgClassName="h-full w-full object-cover"
                          />
                        ) : undefined
                      }
                      placeholderVariant={isHome ? 'home' : 'city'}
                      placeholderIcon={icon}
                      budgetValue={formatWorkBudgetUsd(missionWorkBudgetUsd(job))}
                      metaLine={`#${shortId(job.id)} · ${new Date(job.created_at).toLocaleDateString()}`}
                      locationLine={displayTitle}
                      description={extractMissionFeedDescription(job.description)}
                      statusBadge={
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] backdrop-blur-sm ${
                            isHome
                              ? 'border-amber-400/50 bg-amber-500/25 text-amber-100'
                              : 'border-emerald-400/50 bg-emerald-500/25 text-emerald-100'
                          }`}
                        >
                          {roleLabel}
                        </span>
                      }
                      topLeftBadge={
                        typeof job.rating === 'number' && !Number.isNaN(job.rating) ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-black/50 px-2 py-0.5 text-[10px] font-bold text-amber-200 backdrop-blur-sm">
                            {job.rating.toFixed(1)} ⭐
                          </span>
                        ) : undefined
                      }
                      onLocate={
                        onNavigateToJob &&
                        typeof job.location_lat === 'number' &&
                        typeof job.location_lng === 'number'
                          ? () => {
                              onNavigateToJob(job.location_lat!, job.location_lng!);
                              onClose();
                            }
                          : undefined
                      }
                      locateAriaLabel={t('locateOnMap')}
                      footer={
                        <>
                          {job.cleaner_id && (
                            <p className="mt-1 text-[11px] text-slate-500">
                              {t('cleaner')}:{' '}
                              <span className="font-semibold text-slate-300">{cleanerName}</span>{' '}
                              {cleanerHandle}
                            </p>
                          )}
                        </>
                      }
                    />
                  );
                })}
              </div>
            )}
          </ProfileAccordion>
        )}

        {/* Admin Panel button — only for admin */}
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowAdmin(true)}
            className="w-full px-6 py-2 rounded-full border border-orange-500/50 text-orange-400 bg-orange-500/10 hover:bg-orange-500/20 hover:shadow-[0_0_15px_rgba(249,115,22,0.3)] font-black text-sm uppercase tracking-[0.2em] transition-all"
          >
            👑 Admin Panel
          </button>
        )}

        <button
          type="button"
          onClick={handleLogout}
          className="mt-2 w-full px-6 py-2.5 rounded-full font-black text-sm uppercase tracking-[0.2em] border border-orange-500/50 text-orange-400 bg-orange-500/10 hover:bg-orange-500/20 hover:shadow-[0_0_15px_rgba(249,115,22,0.3)] transition-all"
        >
          {t('logout')}
        </button>

        {/* Legal footer (Stripe compliance) */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[10px] text-cyan-500/50">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setShowTerms(true);
            }}
            className="hover:text-orange-400 transition-colors"
          >
            {t('termsOfService')}
          </a>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setShowRefunds(true);
            }}
            className="hover:text-orange-400 transition-colors"
          >
            {t('refundPolicy')}
          </a>
          <a
            href={`mailto:${APP_SUPPORT_EMAIL}`}
            className="hover:text-orange-400 transition-colors"
          >
            {t('contactSupport')}
          </a>
        </div>

          </>
        )}
          </div>
        </div>
        </div>
      </motion.div>

      {/* Floating back-to-map — portal to <body>, above map chrome.
          Exact center via 5-col grid column 3. Plain <button> (no framer
          transform) so nothing can fight geometric centering. MapPicker's
          own FAB is suppressed while this overlay is open. */}
      {createPortal(
        <div
          className="pointer-events-none fixed inset-x-0 bottom-[max(5rem,calc(env(safe-area-inset-bottom,0px)+1.25rem))] z-[10030]"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
            width: '100%',
            alignItems: 'center',
            justifyItems: 'center',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{ gridColumn: '3 / 4' }}
            className="pointer-events-auto relative flex h-[3.75rem] w-[3.75rem] items-center justify-center rounded-full border border-orange-400/45 bg-white/10 shadow-[0_0_28px_rgba(249,115,22,0.75),0_0_56px_rgba(234,88,12,0.35)] backdrop-blur-md transition-transform hover:bg-white/15 active:scale-95"
            aria-label={t('closeBackToMap')}
            title={t('closeBackToMap')}
          >
            <span
              className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-br from-orange-500/30 via-transparent to-amber-400/25 blur-md"
              aria-hidden
            />
            <Target className="relative h-7 w-7 text-orange-100/95 drop-shadow-[0_0_12px_rgba(251,146,60,0.85)]" aria-hidden />
          </button>
        </div>,
        document.body
      )}

      {showTerms && (
        <LegalModal
          title="Terms of Service"
          body="Garbagin operates strictly as a software-as-a-service (SaaS) digital marketplace. We provide a platform connecting end-users who request services with independent local contractors (Cleaners). We are not a charity. Access to marketplace actions is token-based. All Cleaners act as independent entities."
          onClose={() => setShowTerms(false)}
        />
      )}

      {showRefunds && (
        <LegalModal
          title="Refund Policy"
          body="Token purchases and subscriptions are digital services. Once a token pack or subscription is activated, it is generally non-refundable unless required by applicable law. If a payment succeeds but tokens/subscription are not credited due to a technical error, support will resolve it after verification."
          onClose={() => setShowRefunds(false)}
        />
      )}

      <VerificationModal
        open={showVerificationModal}
        onClose={() => setShowVerificationModal(false)}
        onSubmitted={() => void fetchProfileData()}
        userId={_session?.user?.id ?? null}
      />

      <TokenPackModal
        open={showTokenPackModal}
        userId={_session?.user?.id ?? null}
        onClose={() => setShowTokenPackModal(false)}
        onSuccess={() => void fetchProfileData()}
        initialMode="tokens"
      />

      <SubscriptionModal
        open={showSubscriptionModal}
        userId={_session?.user?.id ?? null}
        onClose={() => setShowSubscriptionModal(false)}
        onSuccess={() => void fetchProfileData()}
      />

      <RatingReviewModal
        target={ratingTarget}
        onClose={() => setRatingTarget(null)}
        onSubmitted={() => void fetchProfileData()}
        toast={toast}
      />

      {toastState && (
        <div className="fixed top-5 right-5 z-[10001]">
          <div
            className={`rounded-2xl px-4 py-3 text-sm font-bold shadow-xl border ${
              toastState.kind === 'success'
                ? 'bg-emerald-500/95 text-black border-emerald-300/60'
                : 'bg-red-500/95 text-white border-red-300/60'
            }`}
          >
            {toastState.message}
          </div>
        </div>
      )}

      {/* Client review modal: proof photos + work-done confirmation */}
      {reviewJob && (
        <div
          className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={closeReviewModal}
        >
          <div
            className="ce-bottom-sheet relative flex w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-cyan-500/20 bg-cyan-950/30 shadow-[0_4px_30px_rgba(6,182,212,0.1)] backdrop-blur-md sm:rounded-3xl"
            style={{
              maxHeight: 'min(85svh, 85dvh, 900px)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-cyan-500/20 p-5 pb-4">
              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  {t('reviewMissionTitle')}
                </p>
                <h3 className="text-xl font-black text-white">
                  {(reviewJob.category || 'UNKNOWN').toUpperCase()} •{' '}
                  {formatWorkBudgetUsd(missionWorkBudgetUsd(reviewJob))}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeReviewModal}
                disabled={releasePaySubmitting}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-slate-400 hover:text-white disabled:opacity-50"
                aria-label={t('close')}
              >
                ✕
              </button>
            </div>

            <div className="ce-bottom-sheet-body min-h-0 flex-1 px-5 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3">
                <p className="text-sm font-semibold leading-relaxed text-amber-100">
                  {t('reviewMissionWorkerDone', {
                    amount: formatWorkBudgetUsd(missionWorkBudgetUsd(reviewJob)),
                  })}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-amber-100/85">
                  {t('reviewMissionPayInstructions')}
                </p>
              </div>

              <div className={`mt-4 p-4 ${PROFILE_GLASS_PANEL}`}>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  {t('reviewMissionWorkerContact')}
                </p>
                {reviewWorkerProfile?.full_name && (
                  <p className="text-sm font-semibold text-white">{reviewWorkerProfile.full_name}</p>
                )}
                {reviewWorkerProfile?.phone_number && (
                  <p className="mt-1 text-sm text-emerald-300">{reviewWorkerProfile.phone_number}</p>
                )}
                {reviewWorkerProfile?.telegram_username && (
                  <p className="mt-1 text-sm text-cyan-300">
                    @{reviewWorkerProfile.telegram_username.replace(/^@/, '')}
                  </p>
                )}
                {!reviewWorkerProfile?.phone_number && !reviewWorkerProfile?.telegram_username && (
                  <p className="text-xs leading-relaxed text-slate-400">{t('reviewMissionNoContact')}</p>
                )}
              </div>

              <div className={`mt-4 p-4 ${PROFILE_GLASS_PANEL}`}>
                <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  {t('reviewMissionProofTitle')}
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(!reviewJob.after_photo_urls || reviewJob.after_photo_urls.length === 0) && (
                    <p className="col-span-full text-xs italic text-slate-500">
                      Worker did not upload after photos yet.
                    </p>
                  )}
                  {(reviewJob.after_photo_urls || []).map((url, idx) => (
                    <div
                      key={`after-${idx}-${url.slice(0, 32)}`}
                      className={`relative overflow-hidden ${PROFILE_GLASS_PANEL} !rounded-xl`}
                    >
                      <ModeratedMissionPhoto
                        url={url}
                        alt="After"
                        imgClassName="h-32 w-full object-cover"
                        showSafeBadge
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="ce-bottom-sheet-footer border-t border-cyan-500/30 bg-cyan-950/95 px-5 pt-4 backdrop-blur-md">
              {(reviewJob.status === 'completed' || reviewJob.status === 'finished') ? (
                <p className="w-full rounded-full border border-emerald-500/30 bg-emerald-500/10 py-3 text-center text-sm font-black uppercase tracking-[0.2em] text-emerald-400">
                  MISSION ACCOMPLISHED
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await handleConfirmWorkDone(reviewJob);
                      if (ok) closeReviewModal();
                    }}
                    disabled={releasePaySubmitting || rejectProofSubmitting}
                    className={CLIENT_APPROVE_RELEASE_BTN_MODAL}
                  >
                    {releasePaySubmitting && (
                      <span
                        className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-black/30 border-t-black"
                        aria-hidden
                      />
                    )}
                    <span>
                      {releasePaySubmitting ? t('processing') : t('confirmPaymentCloseMission')}
                    </span>
                  </button>
                  {(reviewJob.status === 'review' || reviewJob.status === 'pending_approval') && (
                    <button
                      type="button"
                      onClick={() => void handleCreatorRejectProof(reviewJob)}
                      disabled={releasePaySubmitting || rejectProofSubmitting}
                      className="w-full rounded-full border border-amber-500/45 bg-amber-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
                    >
                      {rejectProofSubmitting
                        ? t('processing')
                        : t('creatorRejectProof', { defaultValue: 'Reject proof — request redo' })}
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => handleAdminDeleteMission(reviewJob.id)}
                      disabled={
                        adminDeleteMissionId === reviewJob.id ||
                        releasePaySubmitting ||
                        rejectProofSubmitting
                      }
                      className="w-full rounded-full border border-red-500/50 bg-red-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                    >
                      {adminDeleteMissionId === reviewJob.id
                        ? t('processing')
                        : t('adminDeleteMission')}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}


      {showPhantomCapture && proofJob && proofPhase === 'after' && (
        <PhantomCapture
          currentIndex={
            Array.isArray(proofJob.photo_urls) && proofJob.photo_urls.length > 0
              ? Math.min(afterBurstPackages.length, proofJob.photo_urls.length - 1)
              : 0
          }
          totalScenes={
            Array.isArray(proofJob.photo_urls) && proofJob.photo_urls.length > 0
              ? proofJob.photo_urls.length
              : 1
          }
          referencePhotoUrl={
            Array.isArray(proofJob.photo_urls) && proofJob.photo_urls.length > 0
              ? proofJob.photo_urls[Math.min(afterBurstPackages.length, proofJob.photo_urls.length - 1)] || null
              : null
          }
          onClose={() => setShowPhantomCapture(false)}
          onCaptured={(result) => {
            setAfterBurstPackages((prev) => {
              // Reuse the initial GPS for subsequent captures to avoid repeated geolocation pings.
              const first = prev[0];
              const normalized =
                (result.lat == null || result.lng == null) && first?.lat != null && first?.lng != null
                  ? { ...result, lat: first.lat, lng: first.lng }
                  : result;
              return [...prev, normalized];
            });
            setProofFiles((prev) => [...prev, ...result.files].slice(0, 9));
            setShowPhantomCapture(false);
            setProofError(null);
            setProofSuccess(null);
          }}
        />
      )}
    </motion.div>
      )}
    </AnimatePresence>

    {/* Immersive Visual Feed — stack mirrors the section that opened it. */}
    <ImmersiveMissionFeed
      open={isOpen && !!immersiveStartId}
      missions={immersiveMissions}
      startMissionId={immersiveStartId}
      onClose={() => {
        setImmersiveStartId(null);
        setImmersiveMissions([]);
      }}
      onOpenCreator={(creatorId) => {
        setImmersiveStartId(null);
        setImmersiveMissions([]);
        onClose();
        navigate(`/profile/${creatorId}`);
      }}
      onShowOnMap={(job) => {
        setImmersiveStartId(null);
        setImmersiveMissions([]);
        if (
          onNavigateToJob &&
          typeof job.location_lat === 'number' &&
          typeof job.location_lng === 'number'
        ) {
          onNavigateToJob(job.location_lat, job.location_lng);
        }
        onClose();
      }}
      onContact={(job) => {
        // MapPicker listens for this event and opens the mission briefing,
        // where the contact panel enforces the bid-acceptance privacy lock.
        setImmersiveStartId(null);
        setImmersiveMissions([]);
        onClose();
        window.dispatchEvent(
          new CustomEvent(APP_EVENT_OPEN_MISSION, {
            detail: { missionId: job.id },
          })
        );
      }}
      onMessage={(job) => {
        setImmersiveStartId(null);
        setImmersiveMissions([]);
        onClose();
        window.dispatchEvent(
          new CustomEvent(APP_EVENT_OPEN_MISSION, {
            detail: { missionId: job.id, openChatWith: job.creator_id ?? null },
          })
        );
      }}
      onOpenProfile={() => {
        setImmersiveStartId(null);
        setImmersiveMissions([]);
      }}
      onCreateMission={() => {
        // MapPicker listens for this event and drops the draft mission pin
        // at the user's current location (same UX as tapping the map).
        setImmersiveStartId(null);
        setImmersiveMissions([]);
        onClose();
        window.dispatchEvent(new CustomEvent(APP_EVENT_CREATE_MISSION));
      }}
    />
    </>
  );
};

export default Profile;