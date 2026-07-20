/**
 * [[Architecture_Overview.md]]
 * Profile sidebar — wallet/tokens, missions, accordions, Top Up.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../services/supabase';
import { Pencil, Target, Globe, Building2, Clock, Info, Mail, Lock, Coins } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { useTranslation } from 'react-i18next';
import AdminDashboard from '../src/components/AdminDashboard';
import TokenPackModal from '../src/components/TokenPackModal';
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
import {
  EGYPT_MARKETPLACE_CITIES,
  MARKETPLACE_ALL_EGYPT_ID,
  filterMissionsByMarketCity,
  isValidMarketCityId,
} from '../src/lib/egyptMarketplace';
import { checkHomeMissionWorkerVerification } from '../src/lib/trustDeposit';
import { submitMissionProof } from '../src/lib/submitMissionProof';
import { formatTokens, formatWorkBudgetUsd } from '../src/lib/formatMoney';
import { missionWorkBudgetUsd, missionTokenBid } from '../src/lib/missionBudget';
import { isPlatformAdmin, isArchivedMissionStatus } from '../src/lib/platformAdmin';
import { adminDeleteMission } from '../src/lib/adminMission';
import ModeratedMissionPhoto from './ModeratedMissionPhoto';
import MissionFeedCard from './MissionFeedCard';
import { extractMissionFeedDescription } from '../src/lib/missionDescription';

const MISSION_PROFILE_SELECT =
  'id, creator_id, cleaner_id, category, amount_target, expected_price, location_lat, location_lng, status, title, description, created_at, photo_urls, after_photo_urls, started_at, is_disputed, retry_count, rejection_reason, ai_confidence_score, ai_verdict';

const MISSION_ACTIVE_SELECT =
  'id, creator_id, cleaner_id, category, amount_target, expected_price, location_lat, location_lng, status, title, description, created_at, photo_urls, after_photo_urls, started_at, is_disputed, retry_count, rejection_reason';

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
  location_lat?: number | null;
  location_lng?: number | null;
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
  rating?: number | null;
  ai_confidence_score?: number | null;
  ai_verdict?: string | null;
  cleaner?: {
    full_name?: string | null;
    telegram_username?: string | null;
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
}

interface ProfileRow {
  id: string;
  wallet_balance: number | null;
  frozen_balance: number | null;
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

const SUPPORT_TELEGRAM = 'https://t.me/CleanEgypt_Admin_Bot';

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
  const [marketCityId, setMarketCityId] = useState<string>('');
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
      (marketplaceJobs || []).filter(
        (job) =>
          ['pending', 'available', 'funding'].includes(job.status) &&
          job.cleaner_id == null
      ),
    [marketplaceJobs]
  );

  const tokenBalance = Math.max(0, Number(userProfile?.token_balance ?? 0));
  const subscriptionIsActive = useMemo(() => {
    const exp = userProfile?.subscription_expires_at
      ? Date.parse(userProfile.subscription_expires_at)
      : 0;
    return Number.isFinite(exp) && exp > Date.now();
  }, [userProfile?.subscription_expires_at]);

  const profileInfoClosedSummary = useMemo(
    () =>
      `${tokenBalance} ${t('tokens')} · ${
        subscriptionIsActive ? t('subscriptionActive') : t('subscriptionExpired')
      }`,
    [tokenBalance, subscriptionIsActive, t]
  );

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

  const profileOrdersClosedSummary = useMemo(() => {
    const openOwned = ownedOpenMissions.length;
    const activeWork = activeWorkJobs.length;
    return `${t('profileOwnedShort')}: ${openOwned} · ${t('profileActiveWorkShort')}: ${activeWork}`;
  }, [ownedOpenMissions.length, activeWorkJobs.length, t]);

  useEffect(() => {
    if (!marketCityId) return;
    if (!isValidMarketCityId(marketCityId)) {
      setMarketCityId('');
    }
  }, [marketCityId]);

  const filteredMarketplaceJobs = useMemo(() => {
    if (!marketCityId) return [] as Job[];
    return filterMissionsByMarketCity(openMarketplaceJobs, marketCityId).sort((a, b) => {
      const aAvailable = a.status === 'available' ? 1 : 0;
      const bAvailable = b.status === 'available' ? 1 : 0;
      if (aAvailable !== bAvailable) return bAvailable - aAvailable;
      return Number(b.amount_target ?? 0) - Number(a.amount_target ?? 0);
    });
  }, [openMarketplaceJobs, marketCityId]);

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
    if (!cleanerId) {
      setReviewWorkerProfile(null);
      return;
    }
    void (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, phone_number, telegram_username')
        .eq('id', cleanerId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error('Review worker profile fetch:', error);
        setReviewWorkerProfile(null);
        return;
      }
      setReviewWorkerProfile(data ?? null);
    })();
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
          'id, role, token_balance, subscription_expires_at, contact_email, is_verified, verification_status, full_name, phone_number, telegram_username, rating, avatar_url'
        )
        .eq('id', userId)
        .maybeSingle();

      const profileRow = profile as ProfileRow | null;
      setUserProfile(profileRow ?? null);
      if (profileRow) {
        setPhoneNumber(profileRow.phone_number ?? '');
        setTelegramUsername(profileRow.telegram_username ?? '');
        setContactEmail(profileRow.contact_email ?? session.user.email ?? '');
        setContactEditMode(!(profileRow.contact_email || profileRow.phone_number || profileRow.telegram_username));
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
          status,
          title,
          description,
          created_at,
          photo_urls,
          after_photo_urls,
          started_at,
          is_disputed,
          cleaner:profiles!missions_cleaner_id_fkey (
            full_name,
            telegram_username
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
          .filter((j) => ['pending', 'available'].includes(String(j.status || '').toLowerCase()))
          .map((j) => j.id)),
        ...(((cityJobsData || []) as unknown as Job[])
          .filter((j) => ['pending', 'available'].includes(String(j.status || '').toLowerCase()))
          .map((j) => j.id)),
      ];
      if (pendingJobIds.length > 0) {
        const { data: bidsData } = await supabase
          .from('mission_bids')
          .select('id, mission_id, cleaner_id, bid_amount, status, created_at')
          .in('mission_id', pendingJobIds);
        const byJob: Record<string, Bid[]> = {};
        for (const bid of (bidsData || []) as Bid[]) {
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
        .select('*')
        .in('status', ['available', 'funding', 'pending'])
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

  const handleAcceptBid = async (job: Job, bid: Bid) => {
    if (!enforceMissionStatusCooldown()) return;
    const missionValue = Number(bid.bid_amount ?? 0);
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

    if (!window.confirm(t('acceptBidConfirm', { amount: String(Math.floor(Number(bid.bid_amount) || 0)) }))) return;
    try {
      const { error: rpcErr } = await supabase.rpc('accept_mission_bid', {
        p_bid_id: bid.id,
      });
      if (rpcErr) throw rpcErr;

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
      setProofError(t('tooFarFromMission'));
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

        const effectiveLivenessLat =
          livenessLat ??
          completionLat ??
          (typeof proofJob.location_lat === 'number' ? proofJob.location_lat : null);
        const effectiveLivenessLng =
          livenessLng ??
          completionLng ??
          (typeof proofJob.location_lng === 'number' ? proofJob.location_lng : null);

        if (effectiveLivenessLat == null || effectiveLivenessLng == null) {
          setProofError('Liveness GPS is required. Please enable location and try again.');
          return;
        }

        await submitMissionProof({
          missionId: proofJob.id,
          afterPhotoUrls: [...(proofJob.after_photo_urls || []), ...uploadedUrls].slice(0, 9),
          completionLat,
          completionLng,
          completionDistanceMeters,
          proofVideoUrl,
          livenessLat: effectiveLivenessLat,
          livenessLng: effectiveLivenessLng,
        });

        const plastic = Number.parseFloat(plasticKg || '0') || 0;
        const glass = Number.parseFloat(glassKg || '0') || 0;
        const debris = Number.parseFloat(constructionKg || '0') || 0;
        const wood = Number.parseFloat(woodKg || '0') || 0;
        try {
          const origin =
            typeof window !== 'undefined' && window.location?.origin
              ? window.location.origin
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
    if (releasePaySubmitting) return false;
    try {
      setReleasePaySubmitting(true);
      const { error: rpcErr } = await supabase.rpc('confirm_mission_work_done', {
        p_mission_id: job.id,
      });
      if (rpcErr) throw rpcErr;

      setMyCityJobs((prev) => prev.filter((j) => j.id !== job.id));
      setMyHomeJobs((prev) => prev.filter((j) => j.id !== job.id));

      window.dispatchEvent(
        new CustomEvent('cleanegypt:mission-completed', { detail: { missionId: job.id } })
      );

      await fetchProfileData();
      toast.success(t('missionCompletedSuccess'));
      return true;
    } catch (err: any) {
      console.error('Confirm work done error:', err);
      toast.error(err?.message || 'Failed to close mission. Please try again.');
      return false;
    } finally {
      setReleasePaySubmitting(false);
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

  if (!isOpen) return null;

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
    <div
      className="fixed inset-0 z-[200] flex justify-end pt-[env(safe-area-inset-top)] isolate max-w-[100vw] overflow-x-hidden"
      aria-modal="true"
      role="dialog"
    >
      {/* Backdrop — above Mapbox canvas; blur reads the map behind */}
      <div
        className="absolute inset-0 z-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Sliding drawer — Gemini-style animated border on outer edge */}
      <div
        className="relative z-10 w-full min-w-0 max-w-[min(100vw,32rem)] h-[calc(100dvh-env(safe-area-inset-top))] max-h-[calc(100dvh-env(safe-area-inset-top))] flex flex-col animate-slide-in-right animated-border animated-border-drawer overflow-x-hidden min-h-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="animated-border-inner w-full min-h-0 flex-1 flex flex-col max-w-full overflow-x-hidden bg-gradient-to-b from-slate-950 via-[#020617] to-slate-950">
          {/* Header — sticky per .cursorrules; stays visible while content scrolls */}
          <div className="flex-shrink-0 sticky top-0 z-50 flex items-center justify-between px-5 pb-4 pt-[env(safe-area-inset-top)] bg-slate-950/90 backdrop-blur-xl border-b border-gray-800 shadow-lg shadow-black/40">
            <button
              type="button"
              onClick={onClose}
              className="p-2 mr-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all"
              aria-label="Close"
            >
              ✕
            </button>
            <h1 className="text-lg font-bold text-white">{t('yourAccount')}</h1>
          </div>
          {/* Scrollable content — job cards and forms */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain overflow-x-hidden p-4 flex flex-col gap-4 pb-[max(9rem,env(safe-area-inset-bottom))] max-w-full">
          <div className="w-full max-w-md mx-auto flex flex-col gap-3 min-w-0">
        {showAdmin ? (
          <AdminDashboard onBack={() => setShowAdmin(false)} />
        ) : (
          <>
        {/* HEADER: Avatar + Welcome + Wallet */}
        <header className="mb-2 text-white">
          <div className="flex items-center gap-4 min-w-0">
            <label className="relative inline-flex shrink-0 items-center justify-center h-14 w-14 rounded-full bg-gradient-to-br from-emerald-500/40 to-cyan-500/20 border border-white/20 shadow-[0_0_20px_rgba(16,185,129,0.4)] cursor-pointer overflow-hidden group">
              {avatarUploading ? (
                <div className="h-6 w-6 border-2 border-emerald-400/40 border-t-emerald-400 rounded-full animate-spin" />
              ) : userProfile?.avatar_url ? (
                <img
                  src={userProfile.avatar_url}
                  alt={userProfile.full_name || userEmail || 'Avatar'}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-xl font-black uppercase text-emerald-300">
                  {(userProfile?.full_name || userEmail || 'C')[0]}
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
              <p className="text-sm text-slate-400 uppercase tracking-[0.2em] truncate">
                {t('welcome')} {userProfile?.full_name || userEmail || t('coworker')}!
              </p>
              {userEmail && (
                <p className="mt-1 text-[10px] text-slate-500 uppercase tracking-[0.18em]">
                  {userEmail}
                </p>
              )}
              {/* Rating badge */}
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
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              <span className="inline-flex items-center rounded-full border border-lime-400/35 bg-lime-500/10 px-2.5 py-1 text-[10px] font-bold tabular-nums text-lime-200">
                {tokenBalance} {t('tokens')}
              </span>
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold ${
                  subscriptionIsActive
                    ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200'
                    : 'border-amber-400/35 bg-amber-500/10 text-amber-200'
                }`}
              >
                {t('subscriptionStatus')}:{' '}
                {subscriptionIsActive ? t('subscriptionActive') : t('subscriptionExpired')}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-400">
              {t('profileEconomyHint')}
            </p>
          </div>
        </ProfileAccordion>

        {/* KYC verification status */}
        <ProfileAccordion
          title={t('verificationStatusSection', { defaultValue: 'Verification Status' })}
          icon={<Target className="w-5 h-5 shrink-0 text-cyan-400/90" aria-hidden />}
          closedSummary={
            userProfile?.verification_status === 'pending'
              ? t('underReview', { defaultValue: 'Under Review' })
              : userProfile?.is_verified
                ? t('trusted', { defaultValue: 'Trusted' })
                : t('unverified', { defaultValue: 'Unverified' })
          }
        >
          {(() => {
            const raw = userProfile?.verification_status ?? (userProfile?.is_verified ? 'verified' : 'unverified');
            const s = String(raw || '').toLowerCase();
            const badge = s === 'verified'
              ? (
                  <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-emerald-200">
                    {t('kycTrustedBadge', { defaultValue: 'Trusted' })}
                  </span>
                )
              : s === 'pending'
                ? (
                    <span className="inline-flex items-center rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-amber-200">
                      {t('kycUnderReviewBadge', { defaultValue: 'Under Review' })}
                    </span>
                  )
                : s === 'rejected'
                  ? (
                      <span className="inline-flex items-center rounded-full border border-red-400/30 bg-red-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-red-200">
                        {t('kycRejectedBadge', { defaultValue: 'Rejected' })}
                      </span>
                    )
                  : (
                      <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-slate-200">
                        {t('kycUnverifiedBadge', { defaultValue: 'Unverified' })}
                      </span>
                    );

            return (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  {badge}
                  {s === 'pending' && (
                    <span className="text-[11px] text-slate-400">
                      {t('kycPendingHint', { defaultValue: 'We are reviewing your documents.' })}
                    </span>
                  )}
                </div>

                {s === 'unverified' || s === 'rejected' ? (
                  <button
                    type="button"
                    onClick={() => setShowVerificationModal(true)}
                    className="w-full py-3 rounded-full border border-cyan-400/35 bg-cyan-600/90 text-white font-black uppercase tracking-[0.12em] hover:bg-cyan-500/95 transition-colors shadow-[0_4px_22px_rgba(34,211,238,0.18)]"
                  >
                    {t('kycStartButton', { defaultValue: 'Start KYC' })}
                  </button>
                ) : null}

                {s === 'verified' && (
                  <p className="text-sm text-slate-300 leading-relaxed">
                    {t('kycVerifiedHint', { defaultValue: 'You can accept restricted Home/Private missions.' })}
                  </p>
                )}
              </div>
            );
          })()}
        </ProfileAccordion>

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
                  const displayTitle =
                    job.title && job.title.trim().length > 0 ? job.title : t('serviceRequestFallback');
                  const isPhantomPayment = job.status === 'pending_payment';
                  if (isPhantomPayment) {
                    const busy = phantomPaymentActionId === job.id;
                    return (
                      <div
                        key={job.id}
                        className={`${PROFILE_GLASS_PANEL} p-4 opacity-70 border border-dashed border-red-500/40`}
                      >
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-[10px] text-slate-500/80 font-mono">#{shortId(job.id)}</span>
                          <span className="text-[10px] text-slate-500">{new Date(job.created_at).toLocaleDateString()}</span>
                        </div>
                        <div className="mb-3">
                          <div className="inline-block bg-red-500/20 text-red-400 border border-red-500/50 rounded px-2 py-1 text-xs">
                            {t('paymentPendingBadge')}
                          </div>
                        </div>
                        <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-400 font-bold mb-1">
                          {displayTitle}
                        </p>
                        <p className="text-sm font-bold text-emerald-400 mb-2">
                          {formatWorkBudgetUsd(missionWorkBudgetUsd(job))}
                        </p>
                        {job.description && (
                          <p className="text-xs text-slate-400 mb-2">{job.description}</p>
                        )}
                        <p className="text-[10px] text-slate-400 mb-3 leading-snug">{t('tokenOnlyNote')}</p>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            cancelPendingPaymentMission(
                              job,
                              String(job.category || '').toLowerCase() === 'home' ? 'home' : 'city'
                            )
                          }
                          className="rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-red-300 bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {t('cancelMission')}
                        </button>
                      </div>
                    );
                  }
                  const hasCoords =
                    typeof job.location_lat === 'number' && typeof job.location_lng === 'number';
                  const statusKey = String(job.status || '').toLowerCase();
                  const openForBids = statusKey === 'pending' || statusKey === 'available';
                  return (
                    <div key={job.id} className={`${PROFILE_GLASS_PANEL} p-4`}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] text-slate-500/80 font-mono">#{shortId(job.id)}</span>
                        <span className="text-[10px] text-slate-500">{new Date(job.created_at).toLocaleDateString()}</span>
                      </div>

                      <div className="flex items-center justify-between gap-3 mb-1">
                        <div className="flex-1 min-w-0">
                          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-300">
                              {statusKey || '—'}
                            </span>
                            {job.category && (
                              <span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-cyan-200">
                                {job.category}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-400 font-bold mb-1">
                            {displayTitle}
                          </p>
                          <p className="text-sm font-bold text-emerald-400 mb-1">
                            {t('workBudgetUsdLabel')}: {formatWorkBudgetUsd(missionWorkBudgetUsd(job))}
                          </p>
                          <p className="text-[10px] font-medium text-lime-300/90 mb-1">
                            {t('missionTokenBidLabel')}: {formatTokens(missionTokenBid(job))}
                          </p>
                        </div>
                        {hasCoords && onNavigateToJob && (
                          <button
                            type="button"
                            onClick={() => {
                              onNavigateToJob(job.location_lat!, job.location_lng!);
                              onClose();
                            }}
                            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400 hover:text-emerald-300"
                          >
                            <span>{t('viewOnMap')}</span>
                            <span>↗</span>
                          </button>
                        )}
                      </div>

                      <p className="text-xs text-slate-400">{t('profileOwnedMissionHint')}</p>

                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => handleAdminDeleteMission(job.id)}
                          disabled={adminDeleteMissionId === job.id}
                          className="mt-3 w-full rounded-full border border-red-500/50 bg-red-500/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                        >
                          {adminDeleteMissionId === job.id ? t('processing') : t('adminDeleteMission')}
                        </button>
                      )}

                      {openForBids && (
                        <div className="mt-3">
                          {(() => {
                            const bids = (jobBidsById[job.id] || []).filter((b) => b.status === 'pending');
                            return (
                              <>
                                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
                                  {t('activeOffers')}:{' '}
                                  <span className="text-emerald-400">{bids.length}</span>
                                </p>
                                {bids.length > 0 ? (
                                  <div className="space-y-2">
                                    {bids.map((bid) => (
                                      <div
                                        key={bid.id}
                                        className={`flex items-center justify-between gap-3 py-2 px-3 ${PROFILE_GLASS_PANEL} !rounded-xl`}
                                      >
                                        <span className="text-sm font-black text-emerald-400">
                                          {t('workBidUsdLabel')}: {formatWorkBudgetUsd(Number(bid.bid_amount))}
                                        </span>
                                        <div className="rounded-full animated-border-city">
                                          <button
                                            type="button"
                                            onClick={() => handleAcceptBid(job, bid)}
                                            className="animated-border-inner w-full rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white bg-[#020617] hover:brightness-110 transition-all active:scale-[0.98]"
                                          >
                                            {t('acceptOffer')}
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-slate-500 text-xs italic">{t('noOffersYet')}</p>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}

                      {job.status === 'review' && job.cleaner_id && (
                        <div className="mt-4">
                          <p className="w-full py-3 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 font-black text-xs uppercase tracking-[0.2em] text-center">
                            {t('pendingReview')}
                          </p>
                          <p className="mt-2 text-[10px] text-slate-500 uppercase tracking-wider text-center">
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
                        <div className="mt-4">
                          <button
                            type="button"
                            onClick={() => setReviewJob(job)}
                            disabled={releasePaySubmitting}
                            className={CLIENT_APPROVE_RELEASE_BTN_LIST}
                          >
                            {t('reviewMissionOpenButton')}
                          </button>
                          <p className="mt-2 text-[10px] text-slate-500 uppercase tracking-wider text-center">
                            {t('workerMarkedCompletedHint')}
                          </p>
                        </div>
                      )}
                      {(job.status === 'completed' || job.status === 'finished') && job.cleaner_id && (
                        <div className="mt-4">
                          <p className="w-full py-3 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-black text-xs uppercase tracking-[0.2em] text-center">
                            {t('missionAccomplishedPaid')}
                          </p>
                        </div>
                      )}
                    </div>
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
                  const hasCoords =
                    typeof job.location_lat === 'number' && typeof job.location_lng === 'number';
                  return (
                    <div key={job.id} className={`${PROFILE_GLASS_PANEL} p-4`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-200">
                            {String(job.status || '').toLowerCase()}
                          </span>
                          <p className="mt-2 text-sm font-bold text-emerald-300">
                            {t('workBudgetUsdLabel')}: {formatWorkBudgetUsd(missionWorkBudgetUsd(job))}
                          </p>
                          {job.description && (
                            <p className="mt-1 line-clamp-2 text-xs text-slate-400">{job.description}</p>
                          )}
                        </div>
                        {hasCoords && onNavigateToJob && (
                          <button
                            type="button"
                            onClick={() => {
                              onNavigateToJob(job.location_lat!, job.location_lng!);
                              onClose();
                            }}
                            className="inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400 hover:text-emerald-300"
                          >
                            {t('viewOnMap')} ↗
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </ProfileAccordion>

        <ProfileAccordion
          title={t('selectCity')}
          icon={<Globe className="w-5 h-5 shrink-0 text-emerald-400/90" aria-hidden />}
        >
          <div className="text-white pointer-events-auto relative z-10 min-w-0">
          {paymentSyncing && (
            <p className="text-[11px] font-bold text-emerald-400 mb-3 animate-pulse">
              🔄 Verifying your payment...
            </p>
          )}

          <div className="mb-4">
            <label className="flex w-full flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                {t('selectCity')}
              </span>
              <select
                value={marketCityId}
                onChange={(e) => setMarketCityId(e.target.value)}
                className={`w-full min-w-0 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50 ${PROFILE_GLASS_PANEL} !rounded-xl`}
              >
                <option value="">{t('selectCityPlaceholder')}</option>
                <option value={MARKETPLACE_ALL_EGYPT_ID}>{t('marketplaceCityAll')}</option>
                {EGYPT_MARKETPLACE_CITIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {t(c.nameKey)}
                  </option>
                ))}
              </select>
            </label>
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

          {!marketLoading && !marketError && !marketCityId && (
            <p className="text-sm text-slate-400 italic">{t('selectCityToExplore')}</p>
          )}

          {!marketLoading && !marketError && marketCityId && filteredMarketplaceJobs.length === 0 && (
            <p className="text-sm text-slate-500 italic">{t('noMissionsInCity')}</p>
          )}

          {!marketLoading && !marketError && marketCityId && filteredMarketplaceJobs.length > 0 && (
            <div className="space-y-3 pointer-events-auto">
              {filteredMarketplaceJobs.map((job) => {
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
                    locationLine={(() => {
                      const first = String(job.description ?? '').split('\n')[0]?.trim();
                      return first?.startsWith('📍') ? first : undefined;
                    })()}
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
                  const cleanerHandle = job.cleaner?.telegram_username
                    ? `(@${job.cleaner.telegram_username})`
                    : '';
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

        <ProfileAccordion
          title={t('contactInfo')}
          icon={<Mail className="w-5 h-5 shrink-0 text-cyan-400/90" aria-hidden />}
        >
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
        </ProfileAccordion>

        <ProfileAccordion
          title={t('changePassword')}
          icon={<Lock className="w-5 h-5 shrink-0 text-slate-300/90" aria-hidden />}
        >
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
        </ProfileAccordion>

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
            href="mailto:support@cleanegypt.co"
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
        </div>

      {/* Portal — floating back to map; layered above map and form content */}
      <button
        type="button"
        onClick={onClose}
        className="pointer-events-auto fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 z-[400] flex h-[3.75rem] w-[3.75rem] -translate-x-1/2 items-center justify-center rounded-full border border-orange-400/45 bg-white/10 shadow-[0_0_28px_rgba(249,115,22,0.75),0_0_56px_rgba(234,88,12,0.35)] backdrop-blur-md transition-all hover:bg-white/15 active:scale-95"
        aria-label={t('closeBackToMap')}
        title={t('closeBackToMap')}
      >
        <span
          className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-br from-orange-500/30 via-transparent to-amber-400/25 blur-md"
          aria-hidden
        />
        <Target className="relative h-7 w-7 text-orange-100/95 drop-shadow-[0_0_12px_rgba(251,146,60,0.85)]" aria-hidden />
      </button>

      {showTerms && (
        <LegalModal
          title="Terms of Service"
          body="CleanEgypt.co operates strictly as a software-as-a-service (SaaS) digital marketplace. We provide a platform connecting end-users who request services with independent local contractors (Cleaners). We are not a charity. Access to marketplace actions is token-based. All Cleaners act as independent entities."
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
      />

      <TokenPackModal
        open={showTokenPackModal}
        userId={_session?.user?.id ?? null}
        onClose={() => setShowTokenPackModal(false)}
        onSuccess={() => void fetchProfileData()}
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
          className="fixed inset-0 z-[9999] flex items-end justify-center sm:items-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm"
          onClick={closeReviewModal}
        >
          <div
            className="relative flex w-full max-w-2xl max-h-[min(92dvh,900px)] flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl bg-cyan-950/30 backdrop-blur-md border border-cyan-500/20 shadow-[0_4px_30px_rgba(6,182,212,0.1)]"
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

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 pb-32 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

            <div className="absolute inset-x-0 bottom-0 border-t border-cyan-500/30 bg-cyan-950/95 px-5 py-4 backdrop-blur-md pb-[max(1rem,env(safe-area-inset-bottom))]">
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
                    disabled={releasePaySubmitting}
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
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => handleAdminDeleteMission(reviewJob.id)}
                      disabled={adminDeleteMissionId === reviewJob.id || releasePaySubmitting}
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
    </div>
  );
};

export default Profile;