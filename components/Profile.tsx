import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

interface ProfileProps {
  isOpen: boolean;
  onClose: () => void;
  session: any;
  onNavigateToJob?: (lat: number, lng: number) => void;
}

interface Job {
  id: string;
  creator_id: string | null;
  cleaner_id: string | null;
  category: 'public' | 'home' | 'office' | string;
  amount_target: number;
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
  rating?: number | null;
}

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

const Profile: React.FC<ProfileProps> = ({ isOpen, onClose, session: _session, onNavigateToJob }) => {
  const [balance, setBalance] = useState(0);
  const [myHomeJobs, setMyHomeJobs] = useState<Job[]>([]);
  const [myCityJobs, setMyCityJobs] = useState<Job[]>([]);
  const [myActiveJobs, setMyActiveJobs] = useState<Job[]>([]);
  const [missionHistory, setMissionHistory] = useState<Job[]>([]);
  const [jobBidsById, setJobBidsById] = useState<Record<string, Bid[]>>({});
  const [marketplaceJobs, setMarketplaceJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [marketLoading, setMarketplaceLoading] = useState(true);
  const [marketError, setMarketplaceError] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<ProfileRow | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [showVerificationPrompt, setShowVerificationPrompt] = useState(false);
  const [paymentSyncing, setPaymentSyncing] = useState(false);
  const [reviewJob, setReviewJob] = useState<Job | null>(null);
  const [taskType, setTaskType] = useState<'city' | 'home'>('city');
  const [orderAmount, setOrderAmount] = useState('');
  const [orderLocation, setOrderLocation] = useState('');
  const [orderDescription, setOrderDescription] = useState('');
  const [orderPhoto, setOrderPhoto] = useState<File | null>(null);
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [telegramUsername, setTelegramUsername] = useState('');
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutMethod, setPayoutMethod] = useState<'InstaPay' | 'Vodafone Cash' | 'Card'>('InstaPay');
  const [payoutDetails, setPayoutDetails] = useState('');
  const [payoutSubmitting, setPayoutSubmitting] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const navigate = useNavigate();

  // Real-time wallet balance subscription
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setup = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return;

      channel = supabase
        .channel(`profiles-balance-${userId}`)
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
            if (newRow && typeof newRow.wallet_balance === 'number') {
              setBalance(newRow.wallet_balance);
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
    };
  }, []);

  // Worker proof-of-work modal (before/after photos)
  const [proofJob, setProofJob] = useState<Job | null>(null);
  const [proofPhase, setProofPhase] = useState<'before' | 'after'>('before');
  const [proofFiles, setProofFiles] = useState<File[]>([]);
  const [proofSubmitting, setProofSubmitting] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);
  const [proofSuccess, setProofSuccess] = useState<string | null>(null);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    onClose();
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setAvatarUploading(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        alert('You must be logged in to upload an avatar.');
        return;
      }
      const userId = session.user.id;
      const ext = file.name.split('.').pop() || 'jpg';
      const filePath = `${userId}/${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: false });
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

  const handleRequestPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;
    const amountNum = Number(payoutAmount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      alert('Please enter a positive payout amount.');
      return;
    }
    if (amountNum > (userProfile.wallet_balance ?? 0)) {
      alert('Payout amount cannot exceed your wallet balance.');
      return;
    }
    if (!payoutDetails.trim()) {
      alert('Please provide payment details (wallet, card, etc.).');
      return;
    }

    try {
      setPayoutSubmitting(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        alert('You must be logged in to request a payout.');
        return;
      }

      const { error } = await supabase.rpc('request_payout', {
        p_amount: amountNum,
        p_method: payoutMethod,
        p_details: payoutDetails.trim(),
      });
      if (error) {
        alert(error.message || 'Failed to request payout. Please try again.');
        return;
      }

      alert('Payout request sent! Your funds are now frozen until approval.');
      setShowPayoutModal(false);
      setPayoutAmount('');
      setPayoutDetails('');
      await fetchProfileData();
    } catch (err: any) {
      alert(err?.message || 'Failed to request payout. Please try again.');
    } finally {
      setPayoutSubmitting(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

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
        .select('id, wallet_balance, frozen_balance, is_verified, verification_status, full_name, phone_number, telegram_username, rating, avatar_url')
        .eq('id', userId)
        .maybeSingle();

      const profileRow = profile as ProfileRow | null;
      setUserProfile(profileRow ?? null);
      if (profileRow) {
        setBalance(profileRow.wallet_balance ?? 0);
        setPhoneNumber(profileRow.phone_number ?? '');
        setTelegramUsername(profileRow.telegram_username ?? '');
      }

      const { data: homeJobsData } = await supabase
        .from('missions')
        .select('id, creator_id, cleaner_id, category, amount_target, location_lat, location_lng, status, title, description, created_at, photo_urls, after_photo_urls, started_at, is_disputed')
        .eq('creator_id', userId)
        .eq('category', 'home')
        .order('created_at', { ascending: false });
      setMyHomeJobs((homeJobsData || []) as unknown as Job[]);

      const { data: cityJobsData } = await supabase
        .from('missions')
        .select('id, creator_id, cleaner_id, category, amount_target, location_lat, location_lng, status, title, description, created_at, photo_urls, after_photo_urls, started_at, is_disputed')
        .eq('creator_id', userId)
        .eq('category', 'public')
        .order('created_at', { ascending: false });
      setMyCityJobs((cityJobsData || []) as unknown as Job[]);

      const { data: activeJobsData } = await supabase
        .from('missions')
        .select('id, creator_id, cleaner_id, category, amount_target, location_lat, location_lng, status, title, description, created_at, photo_urls, after_photo_urls, started_at, is_disputed')
        .eq('cleaner_id', userId)
        .in('status', ['in_progress', 'completed', 'finished'])
        .order('created_at', { ascending: false });
      setMyActiveJobs((activeJobsData || []) as unknown as Job[]);

      const { data: historyData } = await supabase
        .from('missions')
        .select('id, creator_id, cleaner_id, category, amount_target, location_lat, location_lng, status, title, description, created_at, photo_urls, after_photo_urls, started_at, is_disputed')
        .eq('status', 'completed')
        .or(`creator_id.eq.${userId},cleaner_id.eq.${userId}`)
        .order('created_at', { ascending: false })
        .limit(100);
      setMissionHistory((historyData || []) as unknown as Job[]);

      const pendingJobIds = [
        ...(((homeJobsData || []) as unknown as Job[]).filter((j) => j.status === 'pending').map((j) => j.id)),
        ...(((cityJobsData || []) as unknown as Job[]).filter((j) => j.status === 'pending').map((j) => j.id)),
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
        .select('id, creator_id, cleaner_id, category, amount_target, location_lat, location_lng, status, title, description, created_at, photo_urls, after_photo_urls, started_at, is_disputed')
        .eq('status', 'pending')
        .is('cleaner_id', null)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        throw error;
      }

      const list = (data || []).filter((j: Job) => j.creator_id !== session.user.id);
      setMarketplaceJobs(list as Job[]);
    } catch (err) {
      console.error('Error fetching marketplace jobs:', err);
      setMarketplaceError('Failed to load marketplace. Please refresh.');
    } finally {
      setMarketplaceLoading(false);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrderError(null);
    setOrderSuccess(null);

    const amount = parseFloat(orderAmount.replace(',', '.'));
    if (isNaN(amount) || amount <= 0) {
      setOrderError('Please enter any positive USD amount.');
      return;
    }

    try {
      setOrderSubmitting(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        setOrderError('You must be signed in to create a task.');
        return;
      }

      const creatorId = session.user.id;

      const res = await fetch('/api/paymob-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'mission_creation',
          category: taskType === 'city' ? 'public' : 'home',
          amount_target: amount,
          userId: creatorId,
          // TODO: wire actual map location; using fallback center for now
          location_lat: 27.2579,
          location_lng: 33.8116,
          description: orderDescription || undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Payment init failed (${res.status})`);
      }

      const data = (await res.json()) as {
        paymentUrl?: string;
        paymentToken?: string;
      };

      if (data.paymentUrl) {
        sessionStorage.setItem('paymentReturnType', 'mission_creation');
        window.location.assign(data.paymentUrl);
        return;
      }

      if (data.paymentToken) {
        sessionStorage.setItem('paymentReturnType', 'mission_creation');
        const iframeId =
          (import.meta.env.VITE_PAYMOB_IFRAME_ID as string | undefined) || '1007120';
        const url = `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${data.paymentToken}`;
        window.location.assign(url);
        return;
      }

      throw new Error('No payment URL or token received.');
    } catch (err) {
      console.error('Create task exception:', err);
      setOrderError(
        err instanceof Error ? err.message : 'Something went wrong. Please try again.'
      );
    } finally {
      setOrderSubmitting(false);
    }
  };

  const handleAcceptBid = async (job: Job, bid: Bid) => {
    if (!window.confirm(`Accept bid of $${bid.bid_amount} from this worker?`)) return;
    try {
      const { error: jobErr } = await supabase
        .from('missions')
        .update({
          cleaner_id: bid.cleaner_id,
          amount_target: bid.bid_amount,
          status: 'in_progress',
        })
        .eq('id', job.id);
      if (jobErr) throw jobErr;

      await supabase.from('mission_bids').update({ status: 'accepted' }).eq('id', bid.id);

      const { data: otherBids } = await supabase
        .from('mission_bids')
        .select('id')
        .eq('mission_id', job.id)
        .neq('id', bid.id)
        .eq('status', 'pending');
      if (otherBids && otherBids.length > 0) {
        await supabase
          .from('mission_bids')
          .update({ status: 'rejected' })
          .eq('mission_id', job.id)
          .neq('id', bid.id);
      }

      await fetchProfileData();
    } catch (err) {
      console.error(err);
      alert('Failed to accept bid. Please try again.');
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
    setProofJob(job);
    setProofPhase(phase);
    setProofFiles([]);
    setProofError(null);
    setProofSuccess(null);
  };

  const closeProofModal = () => {
    if (proofSubmitting) return;
    setProofJob(null);
    setProofFiles([]);
    setProofError(null);
    setProofSuccess(null);
  };

  const submitProof = async (e: React.FormEvent) => {
    e.preventDefault();
    setProofError(null);
    setProofSuccess(null);
    if (!proofJob) return;
    if (!proofFiles.length) {
      setProofError("Please upload photos before continuing.");
      return;
    }

    try {
      setProofSubmitting(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) throw new Error('You must be signed in.');

      const uploadedUrls: string[] = [];
      for (const file of proofFiles) {
        const ext = file.name.split('.').pop() || 'jpg';
        const fileName = `job_${proofJob.id}_${proofPhase}_${session.user.id}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('order-photos')
          .upload(fileName, file, { upsert: false });
        if (uploadError) throw uploadError;
        const { data: { publicUrl } } = supabase.storage.from('order-photos').getPublicUrl(fileName);
        uploadedUrls.push(publicUrl);
      }

      if (proofPhase === 'before') {
        const { error: updateErr } = await supabase
          .from('missions')
          .update({
            photo_urls: [...(proofJob.photo_urls || []), ...uploadedUrls],
            started_at: new Date().toISOString(),
          })
          .eq('id', proofJob.id);
        if (updateErr) throw updateErr;
        setProofSuccess('Before photos uploaded. Mission started.');
      } else {
        const { error: updateErr } = await supabase
          .from('missions')
          .update({
            after_photo_urls: [...(proofJob.after_photo_urls || []), ...uploadedUrls],
            status: 'completed',
          })
          .eq('id', proofJob.id);
        if (updateErr) throw updateErr;
        setProofSuccess('80% Proof complete. For 100% Proof & fast payout, send video proof to Telegram Team Checker.');
      }

      await fetchProfileData();
      await fetchMarketplaceJobs();

      setTimeout(() => closeProofModal(), 2500);
    } catch (err: any) {
      console.error('Proof upload error:', err);
      setProofError(err?.message || 'Failed to upload photos. Please try again.');
    } finally {
      setProofSubmitting(false);
    }
  };

  const handleConfirmReleasePay = async (job: Job) => {
    if (!job.cleaner_id) {
      alert('No worker assigned to this job yet.');
      return;
    }
    if (!window.confirm('Confirm completion and release payment to the worker?')) return;
    try {
      const exchangeRate = 50;
      const payoutEgp = Math.round((job.amount_target || 0) * exchangeRate);

      const { data: workerProfile, error: workerErr } = await supabase
        .from('profiles')
        .select('id, wallet_balance')
        .eq('id', job.cleaner_id)
        .maybeSingle();
      if (workerErr) throw workerErr;

      const currentBalance = (workerProfile?.wallet_balance ?? 0) as number;
      const { error: balanceErr } = await supabase
        .from('profiles')
        .update({ wallet_balance: currentBalance + payoutEgp })
        .eq('id', job.cleaner_id);
      if (balanceErr) throw balanceErr;

      const { error: jobErr } = await supabase
        .from('missions')
        .update({ status: 'finished' })
        .eq('id', job.id);
      if (jobErr) throw jobErr;

      await fetchProfileData();
      alert('Payment released.');
    } catch (err: any) {
      console.error('Release pay error:', err);
      alert(err?.message || 'Failed to release payment.');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex justify-end"
      aria-modal="true"
      role="dialog"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Sliding drawer — Gemini-style animated border on outer edge */}
      <div
        className="relative w-full max-w-lg h-full flex flex-col animate-slide-in-right animated-border animated-border-drawer overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="animated-border-inner w-full h-full flex flex-col overflow-hidden bg-gradient-to-b from-slate-950 via-[#020617] to-slate-950">
          {/* Header — fixed at top, never scrolls */}
          <div className="flex-shrink-0 sticky top-0 z-20 flex items-center justify-between px-5 py-4 pb-4 bg-[#020617]/95 backdrop-blur border-b border-gray-800">
            <h1 className="text-lg font-bold text-white">Your Account</h1>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </div>
          {/* Scrollable content — job cards and forms */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4 pb-24">
          <div className="w-full max-w-md mx-auto flex flex-col gap-6">
        {/* HEADER: Avatar + Welcome + Wallet */}
        <header className="mb-8 text-white">
          <div className="flex items-center gap-4">
            <label className="relative inline-flex items-center justify-center h-14 w-14 rounded-full bg-gradient-to-br from-emerald-500/40 to-cyan-500/20 border border-white/20 shadow-[0_0_20px_rgba(16,185,129,0.4)] cursor-pointer overflow-hidden group">
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
            <div className="flex-1">
              <p className="text-sm text-slate-400 uppercase tracking-[0.2em]">
                Welcome {userProfile?.full_name || userEmail || 'Co-worker'}!
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

          {/* Wallet — glass panel */}
          <div className="mt-6 rounded-3xl bg-black/60 backdrop-blur-xl border border-white/10 p-5">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                Wallet
              </p>
              <button
                type="button"
                onClick={() => setShowPayoutModal(true)}
                className="text-[10px] font-bold uppercase tracking-[0.18em] px-3 py-1 rounded-full border border-white/20 text-slate-200 hover:bg-white/10 transition-all"
              >
                Withdraw
              </button>
            </div>
            <p className="text-3xl font-black text-white">
              {balance}{' '}
              <span className="text-sm font-medium text-slate-400">USD</span>
            </p>
            {userProfile?.frozen_balance && userProfile.frozen_balance > 0 && (
              <p className="mt-1 text-[11px] text-amber-300">
                Frozen: ${Number(userProfile.frozen_balance).toFixed(2)}
              </p>
            )}
          </div>

          {/* LOGOUT — highly visible */}
          <button
            type="button"
            onClick={handleLogout}
            className="mt-4 w-full py-3 rounded-full font-black text-sm uppercase tracking-[0.2em] bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500/30 hover:text-red-300 hover:border-red-400/60 transition-all"
          >
            Logout
          </button>

          {/* CONTACT INFORMATION */}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              console.log('Saving contact info...', { phoneNumber, telegramUsername });
              try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session?.user?.id) {
                  console.log('No session user found, aborting contact save.');
                  alert('You must be logged in to save contact info.');
                  return;
                }
                const updates = {
                  phone_number: phoneNumber || null,
                  telegram_username: telegramUsername || null,
                };
                const { error } = await supabase
                  .from('profiles')
                  .update(updates)
                  .eq('id', session.user.id);
                if (error) {
                  console.error('Contact info update error:', error);
                  alert(error.message || 'Failed to save contact information.');
                  return;
                }
                console.log('Contact info saved successfully.');
                alert('Contact saved!');
              } catch (err: any) {
                console.error('Contact info update error (exception):', err);
                alert(err?.message || 'Failed to save contact information.');
              }
            }}
            className="mt-4 rounded-3xl bg-black/50 backdrop-blur-xl border border-white/10 p-4 space-y-3"
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
              Contact Information
            </p>
            <p className="text-[11px] text-slate-500">
              Add WhatsApp and Telegram so we can reach you about missions and payouts.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
                  Phone (WhatsApp)
                </label>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="w-full rounded-2xl bg-black/40 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500"
                  placeholder="+20 1X XXX XXXX"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
                  Telegram Username
                </label>
                <input
                  type="text"
                  value={telegramUsername}
                  onChange={(e) => setTelegramUsername(e.target.value)}
                  className="w-full rounded-2xl bg-black/40 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500"
                  placeholder="@username"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                className="inline-flex items-center px-4 py-2 rounded-full text-[11px] font-black uppercase tracking-[0.18em] bg-slate-800 text-slate-100 hover:bg-slate-700 transition-all"
              >
                Save Contact
              </button>
            </div>
          </form>

          {/* CHANGE PASSWORD (works for magic-link users who want a password) */}
          <form
            onSubmit={handleChangePassword}
            className="mt-4 rounded-3xl bg-black/50 backdrop-blur-xl border border-white/10 p-4 space-y-3"
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
              Change Password
            </p>
            <p className="text-[11px] text-slate-500">
              You can set a password even if you signed in via Magic Link.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-2xl bg-black/40 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500"
                  placeholder="At least 8 characters"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-2xl bg-black/40 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500"
                  placeholder="Re-enter password"
                />
              </div>
            </div>
            {passwordError && (
              <p className="text-[11px] text-red-400 font-medium">{passwordError}</p>
            )}
            {passwordSuccess && (
              <p className="text-[11px] text-emerald-400 font-medium">{passwordSuccess}</p>
            )}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={passwordSubmitting}
                className="inline-flex items-center px-4 py-2 rounded-full text-[11px] font-black uppercase tracking-[0.18em] bg-emerald-500 text-black hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-wait transition-all"
              >
                {passwordSubmitting ? 'Updating...' : 'Save Password'}
              </button>
            </div>
          </form>

          <div className="mt-6 mb-4 flex items-center justify-between gap-3">
            <div className="inline-flex gap-2 rounded-full bg-slate-900/80 border border-white/5 p-1">
              <button
                type="button"
                onClick={() => setTaskType('city')}
                className={`px-4 py-2 rounded-full text-xs font-bold tracking-[0.18em] uppercase transition-all ${
                  taskType === 'city'
                    ? 'bg-[#22c55e] text-black'
                    : 'bg-transparent text-slate-400 hover:text-[#22c55e]'
                }`}
              >
                City Cleaning
              </button>
              <button
                type="button"
                onClick={() => setTaskType('home')}
                className={`px-4 py-2 rounded-full text-xs font-bold tracking-[0.18em] uppercase transition-all ${
                  taskType === 'home'
                    ? 'bg-[#f59e0b] text-black'
                    : 'bg-transparent text-slate-400 hover:text-[#f59e0b]'
                }`}
              >
                Home Cleaning
              </button>
            </div>
            <div className="animated-border rounded-full">
              <button
                type="button"
                onClick={onClose}
                className="animated-border-inner px-4 py-2.5 rounded-full text-[11px] text-white bg-[#020617] hover:brightness-110 transition-all flex items-center gap-2 font-bold uppercase tracking-[0.16em]"
              >
                <span>🗺️</span>
                <span>Close & Back to Map</span>
              </button>
            </div>
          </div>

          <form
            onSubmit={handleCreateTask}
            className="mb-10 rounded-3xl bg-black/60 backdrop-blur-xl border border-white/10 p-5 space-y-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                  Task type
                </label>
                <p className="text-sm text-slate-200 font-medium">
                  {taskType === 'city' ? 'City Cleaning Donation' : 'Home Cleaning Service'}
                </p>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                  Amount (USD)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={orderAmount}
                  onChange={(e) => setOrderAmount(e.target.value)}
                  placeholder="Any amount"
                  className="w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                  Location
                </label>
                <div className="flex items-center gap-2 rounded-2xl bg-black/40 border border-white/10 px-3 py-2.5">
                  <span className="text-slate-400 text-sm">📍</span>
                  <input
                    type="text"
                    value={orderLocation}
                    onChange={(e) => setOrderLocation(e.target.value)}
                    placeholder="City / Area (map pin coming next)"
                    className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-slate-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                  Upload photo
                </label>
                <label className="flex h-[52px] items-center justify-center rounded-2xl border border-dashed border-slate-600 bg-black/30 text-[11px] text-slate-400 cursor-pointer hover:border-teal-400 hover:text-teal-300 transition-all">
                  {orderPhoto ? 'Photo selected' : 'Tap to add reference photo'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      setOrderPhoto(file);
                    }}
                  />
                </label>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                Short description & area
              </label>
              <textarea
                value={orderDescription}
                onChange={(e) => setOrderDescription(e.target.value)}
                rows={3}
                placeholder={
                  taskType === 'city'
                    ? 'Describe the city spot you want to clean up...'
                    : 'Describe your home cleaning task and area size...'
                }
                className="w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500 resize-none"
              />
            </div>

            {orderError && (
              <p className="text-xs text-red-400 font-medium">{orderError}</p>
            )}
            {orderSuccess && (
              <p className="text-xs text-emerald-400 font-medium">{orderSuccess}</p>
            )}

            <div className={`w-full mt-1 rounded-full ${taskType === 'city' ? 'animated-border-city' : 'animated-border-home'} ${orderSubmitting ? 'opacity-60' : ''}`}>
              <button
                type="submit"
                disabled={orderSubmitting}
                className="animated-border-inner w-full rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.24em] transition-all text-white bg-[#020617] hover:brightness-110 disabled:cursor-wait active:scale-[0.98]"
              >
                {orderSubmitting ? 'Processing...' : 'Submit Task & Pay'}
              </button>
            </div>
          </form>
        </header>

        {/* MY HOME REQUESTS (from jobs table, excluding finished) */}
        <section className="mb-10 text-white">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2 uppercase tracking-[0.2em] text-slate-300">
            🏠 My Home Requests
          </h2>
          <div className="space-y-4">
            {loading ? (
              <div className="space-y-4">
                {[1, 2].map((s) => (
                  <div
                    key={s}
                    className="bg-slate-900/60 rounded-xl border border-white/5 p-4 animate-pulse"
                  >
                    <div className="flex justify-between items-center mb-3">
                      <div className="h-4 w-16 bg-slate-700 rounded-full" />
                      <div className="h-3 w-20 bg-slate-700 rounded-full" />
                    </div>
                    <div className="h-3 w-32 bg-slate-700 rounded-full" />
                  </div>
                ))}
              </div>
            ) : (myHomeJobs || []).filter((job) => job.status !== 'finished').length === 0 ? (
              <p className="text-slate-500 text-sm italic">You haven&apos;t created any home requests yet.</p>
            ) : (
              (myHomeJobs || [])
                .filter((job) => job.status !== 'finished')
                .map((job) => {
                const bids = (jobBidsById[job.id] || []).filter((b) => b.status === 'pending');
                return (
                  <div key={job.id} className="bg-slate-900/60 rounded-xl border border-white/5 p-4">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">#{shortId(job.id)}</span>
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider">{new Date(job.created_at).toLocaleDateString()}</span>
                    </div>
                    <div className="flex justify-between items-start mb-3">
                      <span className={`text-[10px] px-3 py-1 rounded-full font-bold uppercase tracking-wider ${
                        job.status === 'in_progress' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' :
                        job.status === 'completed' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' :
                        job.status === 'finished' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' :
                        job.status === 'disputed' ? 'bg-red-500/20 text-red-400 border border-red-500/40' :
                        'bg-white/10 text-slate-400 border border-white/10'
                      }`}>
                        {job.status}
                      </span>
                      <div className="flex items-center gap-2">
                        {job.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => handleDeleteJob(job.id)}
                            className="text-[10px] font-bold text-red-400 hover:text-red-300 uppercase tracking-wider"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>

                    <p className="text-sm text-slate-300 mb-1">
                      <span className="text-amber-400 font-bold">${job.amount_target}</span>
                      {job.description && (
                        <span className="ml-2 text-slate-400">— {job.description}</span>
                      )}
                    </p>

                    {job.status === 'disputed' && (
                      <div className="mt-4 p-4 rounded-2xl bg-red-500/10 border border-red-500/30">
                        <p className="text-red-300 text-sm font-medium mb-2">Mission in dispute. Contact support:</p>
                        <a href={SUPPORT_TELEGRAM} target="_blank" rel="noopener noreferrer" className="text-emerald-400 font-bold underline hover:text-emerald-300">
                          @CleanEgypt_Admin_Bot
                        </a>
                      </div>
                    )}

                    {job.status === 'pending' && bids.length > 0 && (
                      <div className="mt-4 p-4 rounded-2xl bg-black/40 border border-white/10">
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-3">
                          Bids
                        </p>
                        <div className="space-y-2">
                          {bids.map((bid) => (
                            <div
                              key={bid.id}
                              className="flex items-center justify-between gap-3 py-2 px-3 rounded-xl bg-black/40 border border-white/5"
                            >
                              <span className="text-sm font-black text-amber-400">${bid.bid_amount}</span>
                              <div className="rounded-full animated-border-home">
                                <button
                                  type="button"
                                  onClick={() => handleAcceptBid(job, bid)}
                                  className="animated-border-inner w-full rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white bg-[#020617] hover:brightness-110 transition-all active:scale-[0.98]"
                                >
                                  Accept bid
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {job.status === 'pending' && bids.length === 0 && (
                      <p className="text-slate-500 text-xs italic mt-2">No bids yet. Workers can bid from the map.</p>
                    )}

                    {/* Client actions */}
                    {job.status === 'completed' && job.cleaner_id && (
                      <div className="mt-4">
                        <button
                          type="button"
                          onClick={() => setReviewJob(job)}
                          className="w-full py-3 rounded-full bg-emerald-500 text-black font-black text-xs uppercase tracking-[0.2em] shadow-[0_0_20px_rgba(52,211,153,0.5)] hover:brightness-110 transition-all active:scale-95"
                        >
                          Review & Release Pay
                        </button>
                        <p className="mt-2 text-[10px] text-slate-500 uppercase tracking-wider text-center">
                          Worker submitted completion photos. Review before confirming or disputing.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* MY ACTIVE MISSIONS (from missions where cleaner_id = me, excluding finished) */}
        <section className="mb-10 text-white">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2 uppercase tracking-[0.2em] text-amber-400/90">
            🎯 My Active Missions
          </h2>
          {(myActiveJobs || []).filter((job) => job.status !== 'finished').length === 0 ? (
            <p className="text-slate-500 text-sm italic">You haven&apos;t taken any missions yet. Pick one from the marketplace and pay the deposit.</p>
          ) : (
            <div className="space-y-4">
              {(myActiveJobs || [])
                .filter((job) => job.status !== 'finished')
                .map((job) => {
                const isHome = job.category === 'home';
                const icon = isHome ? '🏠' : '🌆';
                const badgeColor = isHome ? 'bg-amber-400/10 text-amber-300 border-amber-500/30' : 'bg-emerald-400/10 text-emerald-300 border-emerald-500/30';
                const statusPill =
                  job.status === 'in_progress'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                    : job.status === 'completed'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-white/10 text-slate-400 border border-white/10';
                return (
                  <div
                    key={job.id}
                    className="bg-slate-900/60 rounded-xl border border-white/5 p-4"
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-[10px] text-slate-500/80 font-mono">#{shortId(job.id)}</span>
                      <span className="text-[10px] text-slate-500">{new Date(job.created_at).toLocaleDateString()}</span>
                    </div>
                    <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mb-3 ${statusPill}`}>
                      {job.status === 'in_progress' ? '🟢 In Progress' : job.status === 'completed' ? '🟠 Completed' : job.status.toUpperCase()}
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{icon}</span>
                        <div>
                          <p className={`text-[10px] uppercase font-black tracking-widest px-2 py-0.5 rounded-full border ${badgeColor}`}>
                            {job.category.toUpperCase()} Mission
                          </p>
                          <p className={`text-xl font-black mt-1 ${isHome ? 'text-amber-400' : 'text-emerald-400'}`}>${job.amount_target}</p>
                        </div>
                      </div>
                      {job.started_at && (
                        <div className="text-right">
                          <p className="text-[9px] text-slate-500 uppercase tracking-widest">Time Elapsed</p>
                          <JobTimer startedAt={job.started_at} />
                        </div>
                      )}
                    </div>
                    {job.description && (
                      <p className="text-xs text-slate-400 mt-2">{job.description}</p>
                    )}

                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => openNavigate(job)}
                        className="w-full py-3 rounded-full border border-emerald-500/50 text-emerald-300 hover:text-emerald-200 hover:border-emerald-400/70 bg-black/40 backdrop-blur-md text-[11px] font-black uppercase tracking-[0.2em] transition-all active:scale-95"
                      >
                        Navigate
                      </button>
                      <button
                        type="button"
                        onClick={() => openProofModal(job, job.started_at ? 'after' : 'before')}
                        disabled={job.status !== 'in_progress'}
                        className={`w-full py-3 rounded-full text-[11px] font-black uppercase tracking-[0.2em] transition-all active:scale-95 ${
                          job.status === 'in_progress'
                            ? 'bg-gradient-to-r from-amber-300 to-amber-500 text-black shadow-[0_0_24px_rgba(251,191,36,0.6)] hover:brightness-110'
                            : 'bg-white/5 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        {job.started_at ? "Upload 'After' photos & Finish" : "Upload 'Before' photos & Start"}
                      </button>
                    </div>

                    {job.status === 'completed' && (
                      <p className="mt-3 text-[10px] text-amber-300 uppercase tracking-wider">
                        Waiting for client to confirm & release payment
                      </p>
                    )}
                    {job.status === 'finished' && (
                      <p className="mt-3 text-[10px] text-emerald-300 uppercase tracking-wider">
                        Payment released
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* MY CITY DONATIONS (from missions table, excluding finished) */}
        <section className="mb-10 text-white">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2 uppercase tracking-[0.2em] text-slate-300">
            🏙️ My City Donations
          </h2>
          <div className="space-y-4">
            {loading ? (
              <p className="text-slate-500 text-sm italic">Loading city donations...</p>
            ) : (myCityJobs || []).filter((job) => job.status !== 'finished').length === 0 ? (
              <p className="text-slate-500 text-sm italic">You have no city donations yet.</p>
            ) : (
              (myCityJobs || [])
                .filter((job) => job.status !== 'finished')
                .map((job) => {
                  const hasCoords =
                    typeof job.location_lat === 'number' && typeof job.location_lng === 'number';
                  const displayTitle = (job.title && job.title.trim().length > 0)
                    ? job.title
                    : 'City Donation';
                  return (
                    <div key={job.id} className="bg-slate-900/60 rounded-xl border border-white/5 p-4">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] text-slate-500/80 font-mono">#{shortId(job.id)}</span>
                        <span className="text-[10px] text-slate-500">{new Date(job.created_at).toLocaleDateString()}</span>
                      </div>

                      <div className="flex items-center justify-between gap-3 mb-1">
                        <div className="flex-1">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-400 font-bold mb-1">
                            {displayTitle}
                          </p>
                          <p className="text-sm font-bold text-emerald-400 mb-1">
                            ${job.amount_target}
                          </p>
                        </div>
                        {/* VIEW ON MAP */}
                        {hasCoords && onNavigateToJob && (
                          <button
                            type="button"
                            onClick={() => {
                              onNavigateToJob(job.location_lat!, job.location_lng!);
                              onClose();
                            }}
                            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400 hover:text-emerald-300"
                          >
                            <span>View on map</span>
                            <span>↗</span>
                          </button>
                        )}
                      </div>

                      <p className="text-xs text-slate-400">
                        Your donation on the map. Workers can pick it up in the marketplace.
                      </p>

                  {(() => {
                    const bids = (jobBidsById[job.id] || []).filter((b) => b.status === 'pending');
                    if (job.status !== 'pending') return null;
                    return (
                      <div className="mt-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
                          Active bids: <span className="text-emerald-400">{bids.length}</span>
                        </p>
                        {bids.length > 0 ? (
                          <div className="space-y-2">
                            {bids.map((bid) => (
                              <div
                                key={bid.id}
                                className="flex items-center justify-between gap-3 py-2 px-3 rounded-xl bg-black/40 border border-white/5"
                              >
                                <span className="text-sm font-black text-emerald-400">${bid.bid_amount}</span>
                                <div className="rounded-full animated-border-city">
                                  <button
                                    type="button"
                                    onClick={() => handleAcceptBid(job, bid)}
                                    className="animated-border-inner w-full rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white bg-[#020617] hover:brightness-110 transition-all active:scale-[0.98]"
                                  >
                                    Accept bid
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-slate-500 text-xs italic">No bids yet.</p>
                        )}
                      </div>
                    );
                  })()}

                      {job.status === 'completed' && job.cleaner_id && (
                        <div className="mt-4">
                          <button
                            type="button"
                            onClick={() => setReviewJob(job)}
                            className="w-full py-3 rounded-full bg-emerald-500 text-black font-black text-xs uppercase tracking-[0.2em] shadow-[0_0_20px_rgba(52,211,153,0.5)] hover:brightness-110 transition-all active:scale-95"
                          >
                            Review & Release Pay
                          </button>
                          <p className="mt-2 text-[10px] text-slate-500 uppercase tracking-wider text-center">
                            Worker marked job completed. Review before confirming or disputing.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })
            )}
          </div>
        </section>

        {/* GLOBAL MARKETPLACE */}
        <section className="mb-10 text-white pointer-events-auto relative z-10">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2 uppercase tracking-[0.2em] text-emerald-400/90">
            🌍 Global Marketplace
          </h2>
          {paymentSyncing && (
            <p className="text-[11px] font-bold text-emerald-400 mb-3 animate-pulse">
              🔄 Verifying your payment...
            </p>
          )}

          {marketLoading && (
            <div className="grid grid-cols-1 gap-4 mb-2">
              {[1, 2, 3].map((skeleton) => (
                <div
                  key={skeleton}
                  className="bg-slate-900/60 rounded-xl border border-white/5 p-4 animate-pulse"
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

          {!marketLoading && !marketError && (marketplaceJobs || []).filter((job) => job.status === 'pending').length === 0 && (
            <p className="text-sm text-slate-500 italic">
              No active missions yet. Check back soon.
            </p>
          )}

          {!marketLoading && !marketError && (marketplaceJobs || []).filter((job) => job.status === 'pending').length > 0 && (
            <div className="grid grid-cols-1 gap-4 pointer-events-auto">
              {(marketplaceJobs || [])
                .filter((job) => job.status === 'pending' && job.cleaner_id == null)
                .map((job) => {
                const isHome = job.category === 'home';
                const icon = isHome ? '🏠' : '🌆';
                const badgeColor = isHome
                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';

                return (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => {
                      if (onNavigateToJob && typeof job.location_lat === 'number' && typeof job.location_lng === 'number') {
                        onNavigateToJob(job.location_lat, job.location_lng);
                      }
                      onClose();
                    }}
                    className="group w-full text-left cursor-pointer hover:opacity-95 active:scale-[0.99] transition-all relative z-10"
                  >
                    <div className={`relative z-10 bg-slate-900/60 rounded-xl border border-white/5 p-4 overflow-hidden transition-all duration-200 ${isHome ? 'group-hover:border-amber-500/50' : 'group-hover:border-emerald-500/50'}`}>
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-[10px] text-slate-500/80 font-mono">#{shortId(job.id)}</span>
                        <span className="text-[10px] text-slate-500">{new Date(job.created_at).toLocaleDateString()}</span>
                      </div>
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" aria-hidden>
                        <div className={`absolute -inset-32 ${isHome ? 'bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.12),_transparent_60%)]' : 'bg-[radial-gradient(circle_at_top,_rgba(52,211,153,0.12),_transparent_60%)]'}`} />
                      </div>

                      <div className="relative z-10 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-black/40 border border-white/10 text-xl group-hover:scale-105 transition-transform duration-200">
                            <span>{icon}</span>
                          </div>
                          <div>
                            <p className={`text-[10px] uppercase font-black tracking-widest px-2 py-0.5 rounded-full border ${badgeColor}`}>
                              {job.category.toUpperCase()} Mission
                            </p>
                            <p className={`text-2xl font-black tracking-tight mt-1 ${isHome ? 'text-amber-400' : 'text-emerald-400'}`}>${job.amount_target}</p>
                          </div>
                        </div>
                        <div className="relative z-10 text-right">
                          <p className="text-[9px] text-slate-500 mb-1 uppercase tracking-widest">View on Map</p>
                          <p className={`text-xs font-bold ${isHome ? 'text-amber-400 group-hover:text-amber-300' : 'text-emerald-400 group-hover:text-emerald-300'}`}>→</p>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* CLEANING HISTORY (finished jobs for creator or cleaner) */}
        {userProfile && (
          <section className="mb-10 text-white">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2 uppercase tracking-[0.2em] text-slate-400">
              📜 My Cleaning History
            </h2>
            <div className="space-y-4">
              {(() => {
                const uid = userProfile.id;
                const finishedJobs: Job[] = [
                  ...(myHomeJobs || []),
                  ...(myCityJobs || []),
                  ...(myActiveJobs || []),
                ].filter(
                  (job, idx, arr) =>
                    job.status === 'finished' &&
                    (job.creator_id === uid || job.cleaner_id === uid) &&
                    arr.findIndex((j) => j.id === job.id) === idx
                );

                if (finishedJobs.length === 0) {
                  return (
                    <p className="text-slate-500 text-sm italic">
                      No finished jobs yet. Completed missions will appear here.
                    </p>
                  );
                }

                return finishedJobs.map((job) => {
                  const isCreator = job.creator_id === uid;
                  const roleLabel = isCreator ? 'Creator' : 'Cleaner';
                const isHome = job.category === 'home';
                  const icon = isHome ? '🏠' : '🌆';
                  const createdDate = new Date(job.created_at).toLocaleDateString();
                  return (
                    <div
                      key={job.id}
                      className="bg-slate-900/60 rounded-xl border border-white/5 p-4 opacity-90"
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
                        Finished
                      </div>
                      <div className="flex justify-between items-center mb-2">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl opacity-90">{icon}</span>
                          <div>
                            <p className={`text-[10px] uppercase font-black tracking-widest px-2 py-0.5 rounded-full border ${isHome ? 'border-amber-500/30 text-amber-300' : 'border-emerald-500/30 text-emerald-400'}`}>
                              {job.category.toUpperCase()} Mission
                            </p>
                            <p className={`text-xl font-black mt-1 ${isHome ? 'text-amber-400' : 'text-emerald-400'}`}>
                              ${job.amount_target}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] text-slate-500 uppercase tracking-widest">
                            Role
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
          </section>
        )}

        {/* MISSION HISTORY (completed missions for creator or cleaner) */}
        {userProfile && (
          <section className="mb-10 text-white">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2 uppercase tracking-[0.2em] text-slate-300">
              🏆 Mission History
            </h2>
            {loading ? (
              <p className="text-slate-500 text-sm italic">Loading mission history...</p>
            ) : (missionHistory || []).length === 0 ? (
              <p className="text-slate-500 text-sm italic">No completed missions yet.</p>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {(missionHistory || []).map((job) => {
                  const uid = userProfile.id;
                  const isCreator = job.creator_id === uid;
                  const roleLabel = isCreator ? 'Creator' : 'Cleaner';
                  const isHome = job.category === 'home';
                  const icon = isHome ? '🏠' : '🌆';
                  const badgeColor = isHome
                    ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
                  const displayTitle =
                    job.title && job.title.trim().length > 0
                      ? job.title
                      : isHome
                        ? 'Home Mission'
                        : 'City Mission';
                  return (
                    <div
                      key={job.id}
                      className="bg-slate-900/60 rounded-xl border border-white/5 p-4"
                    >
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-[10px] text-slate-500/80 font-mono">#{shortId(job.id)}</span>
                        <span className="text-[10px] text-slate-500">{new Date(job.created_at).toLocaleDateString()}</span>
                      </div>

                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-black/40 border border-white/10 text-xl">
                            <span>{icon}</span>
                          </div>
                          <div>
                            <p className={`text-[10px] uppercase font-black tracking-widest px-2 py-0.5 rounded-full border ${badgeColor}`}>
                              {displayTitle}
                            </p>
                            <p className={`text-2xl font-black tracking-tight mt-1 ${isHome ? 'text-amber-400' : 'text-emerald-400'}`}>
                              ${job.amount_target}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] text-slate-500 uppercase tracking-widest">Role</p>
                          <p className="text-xs font-bold text-slate-200">{roleLabel}</p>
                        </div>
                      </div>

                      {typeof job.rating === 'number' && !Number.isNaN(job.rating) && (
                        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-slate-800/70 border border-amber-400/30 px-2 py-0.5">
                          <span className="text-[10px] font-bold text-amber-300">
                            {job.rating.toFixed(1)}
                          </span>
                          <span className="text-xs">⭐</span>
                        </div>
                      )}

                      {job.description && (
                        <p className="text-xs text-slate-400 mt-3">{job.description}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

          </div>
        </div>
        </div>
      </div>

      {/* Verification required modal */}
      {showVerificationPrompt && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4"
          onClick={() => setShowVerificationPrompt(false)}
        >
          <div
            className="relative z-[9999] w-full max-w-md rounded-3xl bg-black/80 backdrop-blur-xl border border-white/10 shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-white font-bold text-lg mb-2">Verification Required</p>
            <p className="text-slate-400 text-sm mb-6">
              {userProfile?.verification_status === 'pending'
                ? 'Your documents are under review. Check your profile for status updates.'
                : 'Only verified workers (with ID verification) can take home missions.'}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowVerificationPrompt(false)}
                className="flex-1 py-3 rounded-full border border-white/20 text-slate-400 hover:text-white font-bold text-sm transition-colors"
              >
                Close
              </button>
              {userProfile?.verification_status !== 'pending' ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowVerificationPrompt(false);
                    navigate('/verify');
                  }}
                  className="flex-1 py-3 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black font-black text-sm shadow-[0_0_20px_rgba(52,211,153,0.5)] transition-colors"
                >
                  Verify Now
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className="flex-1 py-3 rounded-full bg-white/10 text-slate-500 font-black text-sm cursor-not-allowed"
                >
                  Documents Pending
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Payout request modal */}
      {showPayoutModal && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4"
          onClick={() => setShowPayoutModal(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-[#020617]/95 border border-white/10 shadow-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-1">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  Request Payout
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Withdraw part of your wallet balance to your preferred method.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPayoutModal(false)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRequestPayout} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
                  Amount (USD)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={payoutAmount}
                  onChange={(e) => setPayoutAmount(e.target.value)}
                  className="w-full rounded-2xl bg-black/40 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500"
                  placeholder="Enter amount to withdraw"
                />
                {userProfile && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    Available: ${Number(userProfile.wallet_balance ?? 0).toFixed(2)}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
                  Method
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['InstaPay', 'Vodafone Cash', 'Card'] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPayoutMethod(method)}
                      className={`px-2 py-2 rounded-2xl text-[11px] font-bold uppercase tracking-[0.16em] ${
                        payoutMethod === method
                          ? 'bg-emerald-500 text-black'
                          : 'bg-black/40 border border-white/10 text-slate-300 hover:bg-black/60'
                      }`}
                    >
                      {method}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
                  Payment Details
                </label>
                <input
                  type="text"
                  value={payoutDetails}
                  onChange={(e) => setPayoutDetails(e.target.value)}
                  className="w-full rounded-2xl bg-black/40 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500"
                  placeholder={
                    payoutMethod === 'InstaPay'
                      ? 'InstaPay ID or link'
                      : payoutMethod === 'Vodafone Cash'
                        ? 'Vodafone Cash number'
                        : 'Card / bank details'
                  }
                />
              </div>

              <button
                type="submit"
                disabled={payoutSubmitting}
                className="w-full mt-2 rounded-full bg-emerald-500 text-black text-[11px] font-black uppercase tracking-[0.2em] py-3 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-wait transition-all"
              >
                {payoutSubmitting ? 'Sending Request...' : 'Submit Payout Request'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Client review modal: compare before/after & confirm or dispute */}
      {reviewJob && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={() => setReviewJob(null)}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-3xl bg-black/90 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header — fixed at top */}
            <div className="flex-shrink-0 flex justify-between items-start p-6 pb-2">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold mb-1">
                  Review proof of work
                </p>
                <h3 className="text-xl font-black text-white">
                  {reviewJob.category.toUpperCase()} • ${reviewJob.amount_target}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setReviewJob(null)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Scrollable photo grid + disclaimer */}
            <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div className="rounded-2xl bg-black/50 border border-white/10 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-3">
                    Before photos
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {(!reviewJob.photo_urls || reviewJob.photo_urls.length === 0) && (
                      <p className="text-xs text-slate-500 italic">
                        Worker did not upload before photos.
                      </p>
                    )}
                    {(reviewJob.photo_urls || []).map((url) => (
                      <div key={url} className="relative overflow-hidden rounded-xl border border-white/10 bg-black/40">
                        <img src={url} alt="Before" className="w-full h-24 object-cover" />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl bg-black/50 border border-white/10 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-3">
                    After photos
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {(!reviewJob.after_photo_urls || reviewJob.after_photo_urls.length === 0) && (
                      <p className="text-xs text-slate-500 italic">
                        Worker did not upload after photos.
                      </p>
                    )}
                    {(reviewJob.after_photo_urls || []).map((url) => (
                      <div key={url} className="relative overflow-hidden rounded-xl border border-white/10 bg-black/40">
                        <img src={url} alt="After" className="w-full h-24 object-cover" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-slate-400">
                80% Proof is based on photos. For 100% Proof & dispute resolution, our Telegram Team Checker may request video proof.
              </p>
            </div>

            {/* Sticky action buttons — always visible at bottom */}
            <div className="flex-shrink-0 sticky bottom-0 bg-black/90 backdrop-blur-md pt-4 pb-6 px-6 z-10 border-t border-gray-800">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className={`flex-1 rounded-full ${reviewJob?.category === 'home' ? 'animated-border-home' : 'animated-border-city'}`}>
                  <button
                    type="button"
                    onClick={async () => {
                      await handleConfirmReleasePay(reviewJob);
                      setReviewJob(null);
                    }}
                    className="animated-border-inner w-full rounded-full py-3 text-white bg-[#020617] font-black text-sm uppercase tracking-[0.2em] hover:brightness-110 transition-all active:scale-[0.98]"
                  >
                    Confirm & Pay
                  </button>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const { error } = await supabase
                        .from('missions')
                        .update({ is_disputed: true, status: 'disputed' })
                        .eq('id', reviewJob.id);
                      if (error) throw error;
                      await fetchProfileData();
                      try {
                        await fetch('/api/notify-dispute', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ jobId: reviewJob.id }),
                        });
                      } catch {
                        // ignore
                      }
                      alert('Dispute opened. Support (Muhamed) will review photos and Telegram video.');
                    } catch (err: any) {
                      console.error('Dispute error:', err);
                      alert(err?.message || 'Failed to open dispute.');
                    } finally {
                      setReviewJob(null);
                    }
                  }}
                  className="flex-1 py-3 rounded-full bg-red-500/20 border border-red-500/60 text-red-300 hover:bg-red-500/30 hover:text-red-200 font-black text-sm uppercase tracking-[0.2em] transition-all active:scale-95"
                >
                  Open Dispute
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Worker PoW modal: before/after photos */}
      {proofJob && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={closeProofModal}
          aria-hidden="false"
        >
          <div
            className="w-full max-w-md rounded-3xl bg-black/90 backdrop-blur-xl border border-white/10 shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-black uppercase tracking-[0.18em] text-white">
                {proofPhase === 'before' ? "Upload 'Before' photos & Start" : "Upload 'After' photos & Finish"}
              </h3>
              <button
                type="button"
                onClick={closeProofModal}
                disabled={proofSubmitting}
                className="text-slate-400 hover:text-white text-lg font-bold disabled:opacity-40 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3 mb-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1">
                Mission
              </p>
              <p className="text-white font-bold">
                {proofJob.category.toUpperCase()} • ${proofJob.amount_target}
              </p>
              {proofJob.description && (
                <p className="text-xs text-slate-400 mt-1">{proofJob.description}</p>
              )}
            </div>

            <form onSubmit={submitProof} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                  {proofPhase === 'before'
                    ? "Upload 'Before' photos (required)"
                    : "Upload 'After' photos (required)"}
                </label>
                <label className="flex h-[56px] items-center justify-center rounded-2xl border border-dashed border-amber-500/50 bg-amber-500/10 text-[11px] text-amber-200 cursor-pointer hover:border-amber-400 hover:bg-amber-500/15 transition-all">
                  {proofFiles.length > 0 ? `${proofFiles.length} photo(s) selected` : 'Tap to upload photos'}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []).slice(0, 10);
                      setProofFiles(files);
                      setProofError(null);
                      setProofSuccess(null);
                    }}
                  />
                </label>
              </div>

              {proofError && (
                <p className="text-xs text-red-400 font-medium">{proofError}</p>
              )}
              {proofSuccess && (
                <p className="text-xs text-emerald-400 font-medium">{proofSuccess}</p>
              )}

              <div className={`w-full rounded-full ${proofJob?.category === 'home' ? 'animated-border-home' : 'animated-border-city'} ${proofSubmitting ? 'opacity-60' : ''}`}>
                <button
                  type="submit"
                  disabled={proofSubmitting}
                  className="animated-border-inner w-full rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.24em] transition-all text-white bg-[#020617] hover:brightness-110 disabled:cursor-wait active:scale-[0.98]"
                >
                  {proofSubmitting
                    ? 'Submitting...'
                    : proofPhase === 'before'
                      ? "Submit & start mission"
                      : "Submit & mark completed"}
                </button>
              </div>

              <p className="text-[10px] text-slate-500 text-center uppercase tracking-wider">
                {proofPhase === 'before'
                  ? 'After you submit, the mission timer will start.'
                  : 'After you submit, the client must confirm to release payment.'}
              </p>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Profile;
