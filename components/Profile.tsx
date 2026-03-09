import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

type MissionType = 'home' | 'city' | string | null;

interface Pyramid {
  id: string;
  status: string;
  created_at: string;
  creator_id?: string | null;
  worker_id?: string | null;
  mission_type: MissionType;
  target_amount: number | null;
  current_amount: number | null;
  final_price_egp?: number | null;
  work_started_at?: string | null;
  work_finished_at?: string | null;
  photo_after_url?: string | null;
  worker_photo_start_url?: string | null;
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

/** Живой таймер: сколько времени прошло с startedAt (ISO строка). Обновляется каждую секунду. */
function MissionTimer({ startedAt }: { startedAt: string }) {
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
  return <span className="tabular-nums text-teal-400 font-bold">{elapsed}</span>;
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

const Profile: React.FC = () => {
  const [balance, setBalance] = useState(0);
  const [myPyramids, setMyPyramids] = useState<Pyramid[]>([]);
  const [myHomeJobs, setMyHomeJobs] = useState<Job[]>([]);
  const [jobBidsById, setJobBidsById] = useState<Record<string, Bid[]>>({});
  const [myActiveMissions, setMyActiveMissions] = useState<Pyramid[]>([]);
  const [marketplaceJobs, setMarketplaceJobs] = useState<Pyramid[]>([]);
  const [loading, setLoading] = useState(true);
  const [marketLoading, setMarketplaceLoading] = useState(true);
  const [marketError, setMarketplaceError] = useState<string | null>(null);
  const [selectedMission, setSelectedMission] = useState<Pyramid | null>(null);
  const [isPaymentLoading, setIsPaymentLoading] = useState(false);
  const [userProfile, setUserProfile] = useState<ProfileRow | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [showVerificationPrompt, setShowVerificationPrompt] = useState(false);
  const [photoUploadingMissionId, setPhotoUploadingMissionId] = useState<string | null>(null);
  const [startMissionLoadingId, setStartMissionLoadingId] = useState<string | null>(null);
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

  useEffect(() => {
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const params = new URLSearchParams(search);
    const isPaymentSuccess =
      params.get('payment') === 'success' || params.get('success') === 'true';

    if (isPaymentSuccess) {
      localStorage.setItem('payment_success', Date.now().toString());
      if (window.self !== window.top) {
        (window.top as Window).location.href = window.location.href;
      }
      const isDeposit = typeof window !== 'undefined' && sessionStorage.getItem('paymentReturnType') === 'deposit';
      if (isDeposit) {
        alert('Депозит успешно оплачен! Миссия закреплена за тобой.');
        sessionStorage.removeItem('paymentReturnType');
      } else {
        alert('Оплата прошла успешно! Твоя пирамида создана.');
      }

      // Пытаемся синхронизировать worker_deposit через payment_pending
      const paymobOrderId = params.get('id');
      if (paymobOrderId) {
        (async () => {
          try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.user?.id) return;
            const { data: pending } = await supabase
              .from('payment_pending')
              .select('pyramid_id, type')
              .eq('paymob_order_id', paymobOrderId)
              .maybeSingle();
            if (pending && pending.type === 'worker_deposit') {
              await supabase
                .from('pyramids')
                .update({ status: 'in_progress', worker_id: session.user.id })
                .eq('id', pending.pyramid_id);
            }
          } catch (e) {
            console.error('Failed to sync worker_deposit from payment_pending:', e);
          }
        })();
      }

      window.history.replaceState({}, '', window.location.pathname);
    }

    const loadOnce = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return false;
        await fetchProfileData();
        await fetchMarketplaceJobs();
        return true;
      } catch (e) {
        console.error('Profile init fetch error:', e);
        return false;
      }
    };

    if (isPaymentSuccess) {
      setPaymentSyncing(true);
      let attempts = 0;
      const maxAttempts = 3;
      const intervalMs = 1500;

      const attempt = () => {
        attempts += 1;
        loadOnce().then((ok) => {
          if (ok || attempts >= maxAttempts) {
            setPaymentSyncing(false);
            return;
          }
          setTimeout(attempt, intervalMs);
        });
      };

      const t = setTimeout(attempt, 1200);
      return () => clearTimeout(t);
    }

    const t = setTimeout(() => {
      loadOnce();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // Блокировка скролла body при открытой модалке MISSION DETAILS
  useEffect(() => {
    document.body.style.overflow = selectedMission ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [selectedMission]);

  const fetchProfileData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        setMyPyramids([]);
        setMyHomeJobs([]);
        setJobBidsById({});
        setMyActiveMissions([]);
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

      if (!profileRow?.id) {
        setMyPyramids([]);
        setMyHomeJobs([]);
        setJobBidsById({});
        setMyActiveMissions([]);
        setLoading(false);
        return;
      }

      const creatorId = profileRow.id;

      const { data: myData } = await supabase
        .from('pyramids')
        .select('*')
        .eq('creator_id', creatorId)
        .order('created_at', { ascending: false });
      const uniqueById = Array.from(new Map((myData || []).map((p: Pyramid) => [p.id, p])).values());
      setMyPyramids(uniqueById);

      const { data: homeJobsData } = await supabase
        .from('jobs')
        .select('id, creator_id, worker_id, task_type, amount, status, description, created_at')
        .eq('creator_id', creatorId)
        .eq('task_type', 'home')
        .order('created_at', { ascending: false });
      setMyHomeJobs((homeJobsData || []) as Job[]);

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

      const { data: workerMissions } = await supabase
        .from('pyramids')
        .select('*')
        .eq('worker_id', creatorId)
        .neq('status', 'completed')
        .order('created_at', { ascending: false });
      const uniqueMissions = Array.from(new Map(((workerMissions || []) as Pyramid[]).map((m) => [m.id, m])).values());
      setMyActiveMissions(uniqueMissions);
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
        .from('pyramids')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        throw error;
      }

      const list = (data || []).filter((j: Pyramid) => j.worker_id == null);
      const uniqueJobs = Array.from(new Map(list.map((j: Pyramid) => [j.id, j])).values()) as Pyramid[];
      setMarketplaceJobs(uniqueJobs);
    } catch (err) {
      console.error('Error fetching marketplace jobs:', err);
      setMarketplaceError('Не удалось загрузить миссии. Попробуйте обновить страницу.');
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
      setOrderError('Введите любую сумму в USD больше 0.');
      return;
    }

    try {
      setOrderSubmitting(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        setOrderError('Нужна авторизация, чтобы создать задачу.');
        return;
      }

      const creatorId = session.user.id;
      const email = session.user.email ?? null;

      const { error } = await supabase.from('pyramids').insert([{
        creator_id: creatorId,
        user_email: email,
        mission_type: taskType,
        target_amount: amount,
        current_amount: amount,
        status: 'pending'
      }]);

      if (error) {
        console.error('Error creating pyramid:', error);
        setOrderError('Не удалось создать задачу. Попробуйте ещё раз.');
        return;
      }

      setOrderSuccess('Задача создана. Она появится в твоём профиле и на карте.');
      setOrderAmount('');
      setOrderLocation('');
      setOrderDescription('');
      setOrderPhoto(null);

      await fetchProfileData();
      await fetchMarketplaceJobs();
    } catch (err) {
      console.error('Create task exception:', err);
      setOrderError('Произошла ошибка. Попробуйте ещё раз.');
    } finally {
      setOrderSubmitting(false);
    }
  };

  const handleConfirmDone = async (pyramid: Pyramid) => {
    // Владелец подтверждает чистоту по Photo 3 (Worker Finish)
    if (window.confirm("Подтверждаешь выполнение? Депозит вернется рабочему, и он получит оплату.")) {
      try {
        const usdAmount = pyramid.current_amount ?? 0;
        const exchangeRate = 50;
        const fallbackFinalPrice = usdAmount * exchangeRate;
        const finalPrice = pyramid.final_price_egp || fallbackFinalPrice;
       const totalPayout = finalPrice + (finalPrice * 0.5); // Ставка + возврат 50% депо

        // 1. Закрываем пирамиду
        await supabase.from('pyramids').update({
          status: 'completed',
          verified_by_admin: true
        }).eq('id', pyramid.id);

        // 2. Выплачиваем деньги рабочему
        const { data: workerBalance } = await supabase
          .from('worker_balances')
          .select('balance_egp')
          .eq('id', pyramid.worker_id)
          .single();

        await supabase.from('worker_balances').update({
          balance_egp: (workerBalance?.balance_egp || 0) + totalPayout
        }).eq('id', pyramid.worker_id);

        alert("✅ Сделка закрыта! Город стал чище.");
        fetchProfileData();
      } catch (err) {
        alert("Ошибка! Переходим в диспут в Telegram.");
      }
    }
  };

  const computeMissionMeta = (mission: Pyramid) => {
    const missionLabel = (mission.mission_type || 'city').toString().toUpperCase();
    const targetUsd = mission.target_amount ?? 0;
    const exchangeRate = 50; // должен совпадать с серверной логикой
    const depositEgp = Math.round(targetUsd * exchangeRate * 0.5);
    return { missionLabel, targetUsd, depositEgp };
  };

  const handleOpenMission = (mission: Pyramid) => {
    console.log('Mission clicked:', mission.id);
    setSelectedMission(mission);
  };

  const handleCloseMission = () => {
    if (isPaymentLoading) return;
    setSelectedMission(null);
  };

  const handleStartMission = async (mission: Pyramid) => {
    try {
      setStartMissionLoadingId(mission.id);
      const { error } = await supabase
        .from('pyramids')
        .update({ work_started_at: new Date().toISOString() })
        .eq('id', mission.id);
      if (error) throw error;
      await fetchProfileData();
    } catch (err) {
      console.error(err);
      alert('Не удалось запустить миссию. Попробуй снова.');
    } finally {
      setStartMissionLoadingId(null);
    }
  };

  const handleSubmitFinishedPhoto = async (missionId: string, file: File) => {
    try {
      setPhotoUploadingMissionId(missionId);
      const ext = file.name.split('.').pop() || 'jpg';
      const fileName = `${missionId}_finish_${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('order-photos')
        .upload(fileName, file, { upsert: false });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('order-photos').getPublicUrl(fileName);
      const { error: updateError } = await supabase
        .from('pyramids')
        .update({
          photo_after_url: publicUrl,
          work_finished_at: new Date().toISOString(),
          status: 'in_review',
        })
        .eq('id', missionId);
      if (updateError) throw updateError;
      await fetchProfileData();
    } catch (err: any) {
      console.error(err);
      alert('Ошибка загрузки: ' + (err?.message || 'попробуй снова'));
    } finally {
      setPhotoUploadingMissionId(null);
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

  const handleDeletePyramid = async (pyramidId: string) => {
    if (!window.confirm('Удалить это задание? Это действие нельзя отменить.')) return;
    try {
      const { error } = await supabase.from('pyramids').delete().eq('id', pyramidId);
      if (error) throw error;
      setMyPyramids((prev) => prev.filter((p) => p.id !== pyramidId));
    } catch (err) {
      console.error(err);
      alert('Не удалось удалить задание. Попробуй снова.');
    }
  };

  const handleDispute = async (pyramid: Pyramid) => {
    if (!window.confirm('Открыть диспут по этой миссии? С вами свяжется поддержка.')) return;
    try {
      const { error } = await supabase
        .from('pyramids')
        .update({ status: 'disputed' })
        .eq('id', pyramid.id);
      if (error) throw error;
      await fetchProfileData();
    } catch (err) {
      alert('Не удалось открыть диспут.');
    }
  };

  const handleAcceptMission = async () => {
    if (!selectedMission) return;

    const isVerified = userProfile?.verification_status === 'verified' || userProfile?.is_verified;
    if (selectedMission.mission_type === 'home' && !isVerified) {
      setShowVerificationPrompt(true);
      return;
    }

    const { depositEgp } = computeMissionMeta(selectedMission);
    if (!depositEgp || depositEgp <= 0) {
      alert('Невозможно посчитать депозит для этой миссии.');
      return;
    }

    const userId = userProfile?.id;
    if (!userId) {
      alert('Не удалось определить пользователя. Обнови страницу и попробуй снова.');
      return;
    }

    try {
      setIsPaymentLoading(true);

      console.log('Отправляем запрос на /api/paymob-intent');
      const res = await fetch('/api/paymob-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionId: selectedMission.id,
          amount: depositEgp,
          type: 'worker_deposit',
          userId,
        }),
      });

      console.log('Статус ответа:', res.status);

      if (!res.ok) {
        const errorText = await res.text();
        console.error('Paymob init failed:', errorText);
        alert('Сервер отказал в инициализации платежа. См. console.');
        return;
      }

      const data = (await res.json()) as { paymentUrl?: string; paymentToken?: string };

      if (data.paymentUrl) {
        sessionStorage.setItem('paymentReturnType', 'deposit');
        window.location.assign(data.paymentUrl);
        return;
      }

      if (data.paymentToken) {
        sessionStorage.setItem('paymentReturnType', 'deposit');
        const iframeId = (import.meta.env.VITE_PAYMOB_IFRAME_ID as string | undefined) || '1007120';
        const url = `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${data.paymentToken}`;
        window.location.assign(url);
        return;
      }

      console.error('Unexpected response payload:', data);
      alert('Сервер не вернул ссылку/токен для оплаты.');
    } catch (err) {
      console.error('Worker deposit exception:', err);
      alert('Ошибка при подготовке платежа. Попробуйте позже.');
    } finally {
      setIsPaymentLoading(false);
    }
  };

  return (
    <div className="h-screen overflow-y-auto pb-32 bg-slate-950 font-sans ltr relative">
      <div className="min-h-full py-6 px-4 flex flex-col items-center relative z-10">
        <div className="w-full max-w-2xl relative z-10">
        
        {/* DASHBOARD HEADER + UNIFIED ORDER FORM */}
        <header className="mb-6 text-white">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-[0.25em]">
                Welcome
              </p>
              <h1 className="mt-1 text-2xl font-black tracking-tight">
                {userProfile?.full_name || userEmail || 'Co-worker'}
              </h1>
              {userEmail && (
                <p className="mt-1 text-xs text-slate-500">
                  Signed in as <span className="text-slate-300 font-medium">{userEmail}</span>
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-[10px] text-teal-400 uppercase tracking-[0.25em] font-bold">
                Wallet
              </p>
              <p className="text-3xl font-black mt-1">
                {balance}{' '}
                <span className="text-sm font-normal opacity-50">EGP</span>
              </p>
            </div>
          </div>

          <div className="mb-4 flex items-center justify-between gap-3">
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
            <Link
              to="/"
              className="px-3 py-2 rounded-full bg-slate-900/80 border border-white/10 text-[11px] text-slate-300 hover:text-white hover:border-teal-400 transition-all flex items-center gap-2"
            >
              <span>🗺️</span>
              <span className="uppercase tracking-[0.16em] font-bold">To Map</span>
            </Link>
          </div>

          <form
            onSubmit={handleCreateTask}
            className="mb-10 rounded-3xl bg-slate-900/80 border border-white/10 shadow-2xl p-5 space-y-4"
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
          <h2 className="text-xl font-black mb-4 flex items-center gap-2">
            🏠 MY HOME REQUESTS
          </h2>
          <div className="space-y-4">
            {loading ? (
              <div className="space-y-3">
                {[1, 2].map((s) => (
                  <div
                    key={s}
                    className="bg-slate-800/60 backdrop-blur-sm border border-white/10 rounded-2xl p-4 animate-pulse"
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
                  <div key={job.id} className="bg-slate-800/70 backdrop-blur-sm border border-white/10 rounded-2xl p-4">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-[10px] text-slate-500/80 font-mono">#{shortId(job.id)}</span>
                      <span className="text-[10px] text-slate-500">{new Date(job.created_at).toLocaleDateString()}</span>
                    </div>
                    <div className="flex justify-between items-start mb-3">
                      <span className={`text-[10px] px-2 py-1 rounded-full font-bold ${
                        job.status === 'in_progress' ? 'bg-emerald-500/80' :
                        job.status === 'disputed' ? 'bg-red-500/80' :
                        'bg-slate-600'
                      }`}>
                        {job.status.toUpperCase()}
                      </span>
                      <div className="flex items-center gap-2">
                        {job.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => handleDeleteJob(job.id)}
                            className="text-[10px] font-bold text-red-400 hover:text-red-300 hover:underline uppercase"
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
                      <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
                        <p className="text-red-300 text-sm font-medium mb-2">Mission in dispute. Contact support:</p>
                        <a href={SUPPORT_TELEGRAM} target="_blank" rel="noopener noreferrer" className="text-teal-400 font-bold underline hover:text-teal-300">
                          {SUPPORT_TELEGRAM}
                        </a>
                      </div>
                    )}

                    {job.status === 'pending' && bids.length > 0 && (
                      <div className="mt-4 p-4 bg-black/40 border border-white/10 rounded-xl">
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-3">
                          Bids
                        </p>
                        <div className="space-y-2">
                          {bids.map((bid) => (
                            <div
                              key={bid.id}
                              className="flex items-center justify-between gap-3 py-2 px-3 rounded-xl bg-slate-800/60 border border-white/5"
                            >
                              <span className="text-sm font-bold text-amber-400">${bid.bid_amount}</span>
                              <button
                                type="button"
                                onClick={() => handleAcceptBid(job, bid)}
                                className="px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.16em] bg-emerald-500 hover:bg-emerald-400 text-black transition-all active:scale-95"
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

        {/* MY ACTIVE MISSIONS (где я рабочий — оплатил депозит) */}
        <section className="mb-10 text-white">
          <h2 className="text-xl font-black mb-4 text-amber-400">🎯 MY ACTIVE MISSIONS</h2>
          {(myActiveMissions || []).filter((m) => m.worker_id && m.status === 'in_progress').length === 0 ? (
            <p className="text-slate-500 text-sm italic">Ты ещё не взял ни одной миссии. Выбери миссию в маркетплейсе и оплати депозит.</p>
          ) : (
            <div className="space-y-4">
              {(myActiveMissions || [])
                .filter((mission) => mission.worker_id && mission.status === 'in_progress')
                .map((mission) => {
                const { missionLabel, targetUsd, depositEgp } = computeMissionMeta(mission);
                const isHome = missionLabel === 'HOME';
                const icon = isHome ? '🏠' : '🌆';
                const badgeColor = isHome ? 'bg-amber-400/10 text-amber-300' : 'bg-teal-400/10 text-teal-300';
                const started = !!mission.work_started_at;
                const inReview = mission.status === 'in_review';
                const isUploading = photoUploadingMissionId === mission.id;
                const isStarting = startMissionLoadingId === mission.id;
                return (
                  <div
                    key={mission.id}
                    className="bg-slate-800/80 backdrop-blur-sm border border-amber-500/30 p-5 rounded-2xl"
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-[10px] text-slate-500/80 font-mono">#{shortId(mission.id)}</span>
                      <span className="text-[10px] text-slate-500">{new Date(mission.created_at).toLocaleDateString()}</span>
                    </div>
                    <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider mb-3">
                      🟢 В РАБОТЕ
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{icon}</span>
                        <div>
                          <p className={`text-[10px] uppercase font-black tracking-widest ${badgeColor}`}>
                            {missionLabel} MISSION
                          </p>
                          <p className="text-xl font-black mt-1">{targetUsd > 0 ? `${targetUsd}$` : 'Custom bid'}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] text-slate-500 uppercase tracking-widest">Deposit Paid</p>
                        <p className="text-sm font-bold text-amber-400">{depositEgp > 0 ? `${depositEgp} EGP` : '—'}</p>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
                      {!started && (
                        <button
                          type="button"
                          onClick={() => handleStartMission(mission)}
                          disabled={isStarting}
                          className="w-full py-3 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-900 font-black text-sm uppercase tracking-wider transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {isStarting ? 'Запуск...' : 'START MISSION'}
                        </button>
                      )}
                      {started && !inReview && (
                        <>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-500">Время:</span>
                            <MissionTimer startedAt={mission.work_started_at!} />
                          </div>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            id={`photo-finish-${mission.id}`}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleSubmitFinishedPhoto(mission.id, f);
                              e.target.value = '';
                            }}
                          />
                          <label
                            htmlFor={`photo-finish-${mission.id}`}
                            className={`flex items-center justify-center gap-2 w-full py-3 rounded-xl font-black text-sm uppercase tracking-wider transition-all cursor-pointer ${isUploading ? 'bg-slate-600 text-slate-400 cursor-wait' : 'bg-amber-500/20 text-amber-400 border border-amber-500/40 hover:bg-amber-500/30'}`}
                          >
                            {isUploading ? 'Загрузка...' : '📸 ЗАВЕРШИТЬ / ЗАГРУЗИТЬ ОТЧЕТ'}
                          </label>
                        </>
                      )}
                      {inReview && (
                        <p className="text-amber-400/90 text-sm font-medium">Ожидаем проверку заказчиком</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* MY CITY DONATIONS */}
        <section className="mb-10 text-white">
          <h2 className="text-xl font-black mb-4 flex items-center gap-2">
            🏙️ MY CITY DONATIONS
          </h2>
          <div className="space-y-4">
            {loading ? (
              <p className="text-slate-500 text-sm italic">Загружаем ваши городские пирамиды...</p>
            ) : (myPyramids || []).filter((p) => (p.mission_type || 'city') === 'city').length === 0 ? (
              <p className="text-slate-500 text-sm italic">У тебя ещё нет CITY донатов в городе.</p>
            ) : (
              (myPyramids || [])
                .filter((p) => (p.mission_type || 'city') === 'city')
                .map((p) => (
                  <div key={p.id} className="bg-slate-800/70 backdrop-blur-sm border border-cyan-500/40 rounded-2xl p-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-[10px] text-slate-500/80 font-mono">#{shortId(p.id)}</span>
                      <span className="text-[10px] text-slate-500">{new Date(p.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-300 font-bold mb-1">
                      CITY DONATION
                    </p>
                    <p className="text-xs text-slate-400">
                      Твоя городская пирамида на карте. Рабочие смогут взять её в GLOBAL MARKETPLACE.
                    </p>
                  </div>
                ))
            )}
          </div>
        </section>

        {/* MARKETPLACE (CITY WORK & BIDDING) — pointer-events-auto чтобы карточки были кликабельны */}
        <section className="text-white pointer-events-auto relative z-10">
          <h2 className="text-xl font-black mb-2 text-teal-400">🌍 GLOBAL MARKETPLACE</h2>
          {paymentSyncing && (
            <p className="text-[11px] font-bold text-emerald-300 mb-3 animate-pulse">
              🔄 Синхронизация платежа...
            </p>
          )}

          {marketLoading && (
            <div className="grid grid-cols-1 gap-4 mb-2">
              {[1, 2, 3].map((skeleton) => (
                <div
                  key={skeleton}
                  className="bg-slate-800/70 backdrop-blur-sm border border-white/10 p-5 rounded-2xl animate-pulse"
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
              Пока нет активных миссий. Загляни позже — города скоро проснутся.
            </p>
          )}

          {!marketLoading && !marketError && (marketplaceJobs || []).filter((job) => job.status === 'pending').length > 0 && (
            <div className="grid grid-cols-1 gap-4 pointer-events-auto">
              {(marketplaceJobs || [])
                .filter((job) => job.status === 'pending' && job.worker_id == null && job.creator_id !== userProfile?.id)
                .map((job) => {
                const { missionLabel, targetUsd, depositEgp } = computeMissionMeta(job);
                const isHome = missionLabel === 'HOME';
                const icon = isHome ? '🏠' : '🌆';
                const badgeColor = isHome
                  ? 'bg-amber-400/10 text-amber-300'
                  : 'bg-teal-400/10 text-teal-300';

                return (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => handleOpenMission(job)}
                    className="group w-full text-left cursor-pointer hover:opacity-80 active:scale-95 transition-all relative z-10"
                  >
                    <div className="relative z-10 bg-slate-800/80 backdrop-blur-sm border border-white/10 p-5 rounded-2xl overflow-hidden transition-all duration-200 group-hover:border-teal-400/50 group-hover:shadow-[0_18px_45px_rgba(45,212,191,0.25)]">
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-[10px] text-slate-500/80 font-mono">#{shortId(job.id)}</span>
                        <span className="text-[10px] text-slate-500">{new Date(job.created_at).toLocaleDateString()}</span>
                      </div>
                      {/* Декоративный градиент — pointer-events-none, не блокирует клики */}
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" aria-hidden>
                        <div className="absolute -inset-32 bg-[radial-gradient(circle_at_top,_rgba(45,212,191,0.18),_transparent_60%),radial-gradient(circle_at_bottom,_rgba(56,189,248,0.16),_transparent_60%)]" />
                      </div>

                      <div className="relative z-10 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-800 text-xl group-hover:scale-105 group-hover:bg-slate-700 transition-transform duration-200">
                            <span>{icon}</span>
                          </div>
                          <div>
                            <p className={`text-[10px] uppercase font-black tracking-widest ${badgeColor}`}>
                              {missionLabel} MISSION
                            </p>
                            <p className="text-2xl font-black tracking-tight mt-1">
                              {targetUsd > 0 ? `${targetUsd}$` : 'Custom bid'}
                            </p>
                          </div>
                        </div>
                        <div className="relative z-10 text-right">
                        <p className="text-[9px] text-slate-500 mb-1 uppercase tracking-widest">
                          Worker Deposit
                        </p>
                          <p className="text-xs font-bold text-teal-300 group-hover:text-teal-100">
                            {depositEgp > 0 ? `${depositEgp} EGP` : '—'}
                          </p>
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

      {/* MODAL: mission details for worker — фон блокирует скролл, overflow в useEffect */}
      {selectedMission && (
        <div
          className="fixed inset-0 z-[99999] bg-black/80 flex items-center justify-center p-4"
          onClick={handleCloseMission}
        >
          <div
            className="relative z-[100000] w-full max-w-md bg-slate-900 rounded-3xl border border-slate-700/80 shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={handleCloseMission}
              className="absolute right-4 top-4 text-slate-500 hover:text-white text-sm font-bold disabled:opacity-40"
              disabled={isPaymentLoading}
            >
              ✕
            </button>

            {(() => {
              const { missionLabel, targetUsd, depositEgp } = computeMissionMeta(selectedMission);
              return (
                <>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-teal-400 font-bold mb-1">
                    Mission details
                  </p>
                  <h3 className="text-2xl font-black tracking-tight mb-4">
                    {missionLabel} MISSION
                  </h3>

                  <div className="space-y-3 mb-6 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500 uppercase text-[10px] tracking-widest">
                        Reward
                      </span>
                      <span className="font-bold">{targetUsd > 0 ? `${targetUsd}$` : 'Custom bid'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 uppercase text-[10px] tracking-widest">
                        Worker deposit
                      </span>
                      <span className="font-bold text-teal-300">{depositEgp > 0 ? `${depositEgp} EGP` : '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 uppercase text-[10px] tracking-widest">
                        Status
                      </span>
                      <span className="font-semibold">{selectedMission.status.toUpperCase()}</span>
                    </div>
                  </div>
                </>
              );
            })()}

            <button
              type="button"
              onClick={handleAcceptMission}
              disabled={isPaymentLoading}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-teal-400 to-cyan-400 text-slate-900 font-black text-sm uppercase tracking-[0.2em] shadow-[0_18px_45px_rgba(45,212,191,0.45)] hover:brightness-110 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isPaymentLoading ? 'Подготовка безопасного платежа...' : 'Оплатить депозит и взять миссию'}
            </button>

            <p className="mt-3 text-[10px] text-slate-500 text-center">
              Депозит будет обработан через защищенный шлюз Paymob.
            </p>
          </div>
        </div>
      )}

      {/* Модалка: требуется верификация для Home-миссий — фон 9998, окно 9999 */}
      {showVerificationPrompt && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={() => setShowVerificationPrompt(false)}
        >
          <div
            className="relative z-[9999] w-full max-w-md bg-slate-800/95 backdrop-blur-md rounded-3xl border border-white/10 shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-white font-bold text-lg mb-2">Нужна верификация</p>
            <p className="text-slate-400 text-sm mb-6">
              {userProfile?.verification_status === 'pending'
                ? 'Ваши документы уже на проверке. Ожидайте обновления статуса в профиле.'
                : 'Только верифицированные рабочие (с проверенным ID паспорта) могут брать домашние миссии.'}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowVerificationPrompt(false)}
                className="flex-1 py-3 rounded-xl border border-white/20 text-slate-400 hover:text-white font-bold text-sm transition-colors"
              >
                Закрыть
              </button>
              {userProfile?.verification_status !== 'pending' ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowVerificationPrompt(false);
                    navigate('/verify');
                  }}
                  className="flex-1 py-3 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-900 font-black text-sm transition-colors"
                >
                  Пройти верификацию
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className="flex-1 py-3 rounded-xl bg-slate-600 text-slate-400 font-black text-sm cursor-not-allowed"
                >
                  Документы на проверке
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
