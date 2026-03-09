import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

interface ProfileProps {
  isOpen: boolean;
  onClose: () => void;
  session: any;
}

interface Job {
  id: string;
  creator_id: string | null;
  worker_id: string | null;
  task_type: 'city' | 'home' | string;
  amount: number;
  status: string;
  description?: string | null;
  created_at: string;
}

interface Bid {
  id: string;
  job_id: string;
  worker_id: string;
  bid_amount: number;
  status: string;
  created_at?: string;
}

interface ProfileRow {
  id: string;
  balance_egp: number | null;
  is_verified?: boolean;
  verification_status?: string | null;
  full_name?: string | null;
}

const SUPPORT_TELEGRAM = 'https://t.me/cleanegypt';

const shortId = (id: unknown): string => {
  if (id == null) return 'N/A';
  try {
    return String(id).slice(0, 8);
  } catch {
    return 'N/A';
  }
};

const Profile: React.FC<ProfileProps> = ({ isOpen, onClose, session: _session }) => {
  const [balance, setBalance] = useState(0);
  const [myHomeJobs, setMyHomeJobs] = useState<Job[]>([]);
  const [myCityJobs, setMyCityJobs] = useState<Job[]>([]);
  const [myActiveJobs, setMyActiveJobs] = useState<Job[]>([]);
  const [jobBidsById, setJobBidsById] = useState<Record<string, Bid[]>>({});
  const [marketplaceJobs, setMarketplaceJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [marketLoading, setMarketplaceLoading] = useState(true);
  const [marketError, setMarketplaceError] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<ProfileRow | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [showVerificationPrompt, setShowVerificationPrompt] = useState(false);
  const [paymentSyncing, setPaymentSyncing] = useState(false);
  const [taskType, setTaskType] = useState<'city' | 'home'>('city');
  const [orderAmount, setOrderAmount] = useState('');
  const [orderLocation, setOrderLocation] = useState('');
  const [orderDescription, setOrderDescription] = useState('');
  const [orderPhoto, setOrderPhoto] = useState<File | null>(null);
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    onClose();
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
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      const profileRow = profile as ProfileRow | null;
      setUserProfile(profileRow ?? null);
      if (profileRow) {
        setBalance(profileRow.balance_egp ?? 0);
      }

      const { data: homeJobsData } = await supabase
        .from('jobs')
        .select('id, creator_id, worker_id, task_type, amount, status, description, created_at')
        .eq('creator_id', userId)
        .eq('task_type', 'home')
        .order('created_at', { ascending: false });
      setMyHomeJobs((homeJobsData || []) as Job[]);

      const { data: cityJobsData } = await supabase
        .from('jobs')
        .select('id, creator_id, worker_id, task_type, amount, status, description, created_at')
        .eq('creator_id', userId)
        .eq('task_type', 'city')
        .order('created_at', { ascending: false });
      setMyCityJobs((cityJobsData || []) as Job[]);

      const { data: activeJobsData } = await supabase
        .from('jobs')
        .select('id, creator_id, worker_id, task_type, amount, status, description, created_at')
        .eq('worker_id', userId)
        .in('status', ['in_progress', 'in_review'])
        .order('created_at', { ascending: false });
      setMyActiveJobs((activeJobsData || []) as Job[]);

      const pendingHomeJobIds = ((homeJobsData || []) as Job[])
        .filter((j) => j.status === 'pending')
        .map((j) => j.id);
      if (pendingHomeJobIds.length > 0) {
        const { data: bidsData } = await supabase
          .from('bids')
          .select('id, job_id, worker_id, bid_amount, status, created_at')
          .in('job_id', pendingHomeJobIds);
        const byJob: Record<string, Bid[]> = {};
        for (const bid of (bidsData || []) as Bid[]) {
          if (!byJob[bid.job_id]) byJob[bid.job_id] = [];
          byJob[bid.job_id].push(bid);
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
        .from('jobs')
        .select('id, creator_id, worker_id, task_type, amount, status, description, created_at')
        .eq('status', 'pending')
        .is('worker_id', null)
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
          type: 'job_creation',
          userId: creatorId,
          amount,
          taskType,
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
        sessionStorage.setItem('paymentReturnType', 'job_creation');
        window.location.assign(data.paymentUrl);
        return;
      }

      if (data.paymentToken) {
        sessionStorage.setItem('paymentReturnType', 'job_creation');
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
        .from('jobs')
        .update({
          worker_id: bid.worker_id,
          amount: bid.bid_amount,
          status: 'in_progress',
        })
        .eq('id', job.id);
      if (jobErr) throw jobErr;

      await supabase.from('bids').update({ status: 'accepted' }).eq('id', bid.id);

      const { data: otherBids } = await supabase
        .from('bids')
        .select('id')
        .eq('job_id', job.id)
        .neq('id', bid.id)
        .eq('status', 'pending');
      if (otherBids && otherBids.length > 0) {
        await supabase
          .from('bids')
          .update({ status: 'rejected' })
          .eq('job_id', job.id)
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
      const { error } = await supabase.from('jobs').delete().eq('id', jobId);
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
      {/* Sliding drawer */}
      <div
        className="relative w-full max-w-lg h-full overflow-y-auto bg-gradient-to-b from-slate-950 via-black to-slate-950 shadow-2xl animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 bg-black/80 backdrop-blur-xl border-b border-white/10">
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
        <div className="px-5 py-6 flex flex-col items-center">
          <div className="w-full max-w-md">
        {/* HEADER: Welcome + Wallet */}
        <header className="mb-8 text-white">
          <p className="text-sm text-slate-400 uppercase tracking-[0.2em]">
            Welcome {userProfile?.full_name || userEmail || 'Co-worker'}!
          </p>
          {userEmail && (
            <p className="mt-1 text-[10px] text-slate-500 uppercase tracking-[0.18em]">
              {userEmail}
            </p>
          )}

          {/* Wallet — glass panel */}
          <div className="mt-6 rounded-3xl bg-black/60 backdrop-blur-xl border border-white/10 p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1">
              Wallet
            </p>
            <p className="text-3xl font-black text-white">
              {balance}{' '}
              <span className="text-sm font-medium text-slate-400">EGP</span>
            </p>
          </div>

          {/* LOGOUT — highly visible */}
          <button
            type="button"
            onClick={handleLogout}
            className="mt-4 w-full py-3 rounded-full font-black text-sm uppercase tracking-[0.2em] bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500/30 hover:text-red-300 hover:border-red-400/60 transition-all"
          >
            Logout
          </button>

          <div className="mt-6 mb-4 flex items-center justify-between gap-3">
            <div className="inline-flex gap-2 rounded-full bg-slate-900/80 border border-white/5 p-1">
              <button
                type="button"
                onClick={() => setTaskType('city')}
                className={`px-4 py-2 rounded-full text-xs font-bold tracking-[0.18em] uppercase transition-all ${
                  taskType === 'city'
                    ? 'bg-gradient-to-r from-emerald-400 to-emerald-500 text-black shadow-[0_0_18px_rgba(16,185,129,0.6)]'
                    : 'bg-transparent text-slate-400 hover:text-emerald-300'
                }`}
              >
                City Cleaning
              </button>
              <button
                type="button"
                onClick={() => setTaskType('home')}
                className={`px-4 py-2 rounded-full text-xs font-bold tracking-[0.18em] uppercase transition-all ${
                  taskType === 'home'
                    ? 'bg-gradient-to-r from-amber-300 to-amber-500 text-black shadow-[0_0_18px_rgba(251,191,36,0.6)]'
                    : 'bg-transparent text-slate-400 hover:text-amber-200'
                }`}
              >
                Home Cleaning
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[11px] text-slate-300 hover:text-white hover:border-emerald-500/40 hover:shadow-[0_0_16px_rgba(16,185,129,0.25)] transition-all flex items-center gap-2 font-bold uppercase tracking-[0.16em]"
            >
              <span>🗺️</span>
              <span>Close & Back to Map</span>
            </button>
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

            <button
              type="submit"
              disabled={orderSubmitting}
              className={`w-full mt-1 rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.24em] transition-all ${
                taskType === 'city'
                  ? 'bg-gradient-to-r from-emerald-400 to-emerald-500 text-black shadow-[0_0_24px_rgba(16,185,129,0.7)] hover:brightness-110'
                  : 'bg-gradient-to-r from-amber-300 to-amber-500 text-black shadow-[0_0_24px_rgba(251,191,36,0.7)] hover:brightness-110'
              } ${orderSubmitting ? 'opacity-60 cursor-wait' : 'active:scale-95'}`}
            >
              {orderSubmitting ? 'Processing...' : 'Submit Task & Pay'}
            </button>
          </form>
        </header>

        {/* MY HOME REQUESTS (from jobs table) */}
        <section className="mb-10 text-white">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2 uppercase tracking-[0.2em] text-slate-300">
            🏠 My Home Requests
          </h2>
          <div className="space-y-4">
            {loading ? (
              <div className="space-y-3">
                {[1, 2].map((s) => (
                  <div
                    key={s}
                    className="rounded-3xl bg-black/60 backdrop-blur-xl border border-white/10 p-5 animate-pulse"
                  >
                    <div className="flex justify-between items-center mb-3">
                      <div className="h-4 w-16 bg-slate-700 rounded-full" />
                      <div className="h-3 w-20 bg-slate-700 rounded-full" />
                    </div>
                    <div className="h-3 w-32 bg-slate-700 rounded-full" />
                  </div>
                ))}
              </div>
            ) : (myHomeJobs || []).length === 0 ? (
              <p className="text-slate-500 text-sm italic">You haven&apos;t created any home requests yet.</p>
            ) : (
              (myHomeJobs || []).map((job) => {
                const bids = (jobBidsById[job.id] || []).filter((b) => b.status === 'pending');
                return (
                  <div key={job.id} className="rounded-3xl bg-black/60 backdrop-blur-xl border border-white/10 p-5">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">#{shortId(job.id)}</span>
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider">{new Date(job.created_at).toLocaleDateString()}</span>
                    </div>
                    <div className="flex justify-between items-start mb-3">
                      <span className={`text-[10px] px-3 py-1 rounded-full font-bold uppercase tracking-wider ${
                        job.status === 'in_progress' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' :
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
                      <span className="text-amber-400 font-bold">${job.amount}</span>
                      {job.description && (
                        <span className="ml-2 text-slate-400">— {job.description}</span>
                      )}
                    </p>

                    {job.status === 'disputed' && (
                      <div className="mt-4 p-4 rounded-2xl bg-red-500/10 border border-red-500/30">
                        <p className="text-red-300 text-sm font-medium mb-2">Mission in dispute. Contact support:</p>
                        <a href={SUPPORT_TELEGRAM} target="_blank" rel="noopener noreferrer" className="text-emerald-400 font-bold underline hover:text-emerald-300">
                          {SUPPORT_TELEGRAM}
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
                              <button
                                type="button"
                                onClick={() => handleAcceptBid(job, bid)}
                                className="px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.16em] bg-emerald-500 text-black shadow-[0_0_20px_rgba(52,211,153,0.5)] hover:brightness-110 transition-all active:scale-95"
                              >
                                Accept bid
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {job.status === 'pending' && bids.length === 0 && (
                      <p className="text-slate-500 text-xs italic mt-2">No bids yet. Workers can bid from the map.</p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* MY ACTIVE MISSIONS (from jobs where worker_id = me) */}
        <section className="mb-10 text-white">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2 uppercase tracking-[0.2em] text-amber-400/90">
            🎯 My Active Missions
          </h2>
          {(myActiveJobs || []).length === 0 ? (
            <p className="text-slate-500 text-sm italic">You haven&apos;t taken any missions yet. Pick one from the marketplace and pay the deposit.</p>
          ) : (
            <div className="space-y-4">
              {(myActiveJobs || []).map((job) => {
                const isHome = job.task_type === 'home';
                const icon = isHome ? '🏠' : '🌆';
                const badgeColor = isHome ? 'bg-amber-400/10 text-amber-300 border-amber-500/30' : 'bg-emerald-400/10 text-emerald-300 border-emerald-500/30';
                return (
                  <div
                    key={job.id}
                    className="rounded-3xl bg-black/60 backdrop-blur-xl border border-white/10 p-5"
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-[10px] text-slate-500/80 font-mono">#{shortId(job.id)}</span>
                      <span className="text-[10px] text-slate-500">{new Date(job.created_at).toLocaleDateString()}</span>
                    </div>
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider mb-3 border border-emerald-500/40">
                      🟢 In Progress
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{icon}</span>
                        <div>
                          <p className={`text-[10px] uppercase font-black tracking-widest px-2 py-0.5 rounded-full border ${badgeColor}`}>
                            {job.task_type} Mission
                          </p>
                          <p className="text-xl font-black mt-1">${job.amount}</p>
                        </div>
                      </div>
                    </div>
                    {job.description && (
                      <p className="text-xs text-slate-400 mt-2">{job.description}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* MY CITY DONATIONS (from jobs table) */}
        <section className="mb-10 text-white">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2 uppercase tracking-[0.2em] text-slate-300">
            🏙️ My City Donations
          </h2>
          <div className="space-y-4">
            {loading ? (
              <p className="text-slate-500 text-sm italic">Loading city donations...</p>
            ) : (myCityJobs || []).length === 0 ? (
              <p className="text-slate-500 text-sm italic">You have no city donations yet.</p>
            ) : (
              (myCityJobs || []).map((job) => (
                <div key={job.id} className="rounded-3xl bg-black/60 backdrop-blur-xl border border-white/10 p-5">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] text-slate-500/80 font-mono">#{shortId(job.id)}</span>
                    <span className="text-[10px] text-slate-500">{new Date(job.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-400 font-bold mb-1">
                    City Donation
                  </p>
                  <p className="text-sm font-bold text-emerald-400 mb-1">${job.amount}</p>
                  <p className="text-xs text-slate-400">
                    Your donation on the map. Workers can pick it up in the marketplace.
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        {/* GLOBAL MARKETPLACE */}
        <section className="text-white pointer-events-auto relative z-10">
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
                  className="rounded-3xl bg-black/60 backdrop-blur-xl border border-white/10 p-5 animate-pulse"
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
                .filter((job) => job.status === 'pending' && job.worker_id == null)
                .map((job) => {
                const isHome = job.task_type === 'home';
                const icon = isHome ? '🏠' : '🌆';
                const badgeColor = isHome
                  ? 'bg-amber-400/10 text-amber-300 border-amber-500/30'
                  : 'bg-emerald-400/10 text-emerald-300 border-emerald-500/30';

                return (
                  <button
                    key={job.id}
                    type="button"
                    onClick={onClose}
                    className="group w-full text-left cursor-pointer hover:opacity-95 active:scale-[0.99] transition-all relative z-10"
                  >
                    <div className="relative z-10 rounded-3xl bg-black/60 backdrop-blur-xl border border-white/10 p-5 overflow-hidden transition-all duration-200 group-hover:border-emerald-500/40 group-hover:shadow-[0_0_24px_rgba(52,211,153,0.25)]">
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-[10px] text-slate-500/80 font-mono">#{shortId(job.id)}</span>
                        <span className="text-[10px] text-slate-500">{new Date(job.created_at).toLocaleDateString()}</span>
                      </div>
                      {/* Декоративный градиент — pointer-events-none, не блокирует клики */}
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" aria-hidden>
                        <div className="absolute -inset-32 bg-[radial-gradient(circle_at_top,_rgba(52,211,153,0.15),_transparent_60%)]" />
                      </div>

                      <div className="relative z-10 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-black/40 border border-white/10 text-xl group-hover:scale-105 transition-transform duration-200">
                            <span>{icon}</span>
                          </div>
                          <div>
                            <p className={`text-[10px] uppercase font-black tracking-widest px-2 py-0.5 rounded-full border ${badgeColor}`}>
                              {job.task_type.toUpperCase()} Mission
                            </p>
                            <p className="text-2xl font-black tracking-tight mt-1">${job.amount}</p>
                          </div>
                        </div>
                        <div className="relative z-10 text-right">
                          <p className="text-[9px] text-slate-500 mb-1 uppercase tracking-widest">View on Map</p>
                          <p className="text-xs font-bold text-emerald-400 group-hover:text-emerald-300">→</p>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

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
    </div>
  );
};

export default Profile;
