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

const Profile: React.FC = () => {
  const [balance, setBalance] = useState(0);
  const [myPyramids, setMyPyramids] = useState<Pyramid[]>([]);
  const [myActiveMissions, setMyActiveMissions] = useState<Pyramid[]>([]);
  const [marketplaceJobs, setMarketplaceJobs] = useState<Pyramid[]>([]);
  const [loading, setLoading] = useState(true);
  const [marketLoading, setMarketplaceLoading] = useState(true);
  const [marketError, setMarketplaceError] = useState<string | null>(null);
  const [selectedMission, setSelectedMission] = useState<Pyramid | null>(null);
  const [isPaymentLoading, setIsPaymentLoading] = useState(false);
  const [userProfile, setUserProfile] = useState<ProfileRow | null>(null);
  const [showVerificationPrompt, setShowVerificationPrompt] = useState(false);
  const [photoUploadingMissionId, setPhotoUploadingMissionId] = useState<string | null>(null);
  const [startMissionLoadingId, setStartMissionLoadingId] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      const isDeposit = typeof window !== 'undefined' && sessionStorage.getItem('paymentReturnType') === 'deposit';
      if (isDeposit) {
        alert('Депозит успешно оплачен! Миссия закреплена за тобой.');
        sessionStorage.removeItem('paymentReturnType');
      } else {
        alert('Оплата прошла успешно! Твоя пирамида создана.');
      }
      // Убираем параметры из URL без перезагрузки
      window.history.replaceState({}, '', window.location.pathname);
    }
    fetchProfileData();
    fetchMarketplaceJobs();
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
      // 1. Получаем данные профиля и баланс
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .maybeSingle();

      const profileRow = profile as ProfileRow | null;
      setUserProfile(profileRow ?? null);
      if (profileRow) {
        setBalance(profileRow.balance_egp ?? 0);
      }

      // 2. Мои заказы (где я владелец)
      if (profileRow) {
        const { data: myData } = await supabase
          .from('pyramids')
          .select('*')
          .eq('creator_id', profileRow.id)
          .order('created_at', { ascending: false });
        if (myData) {
          const uniqueById = Array.from(new Map((myData as Pyramid[]).map((p) => [p.id, p])).values());
          setMyPyramids(uniqueById);
        }

        // 3. Мои активные миссии (где я рабочий, статус в работе: open, in_progress, in_review)
        const { data: workerMissions } = await supabase
          .from('pyramids')
          .select('*')
          .eq('worker_id', profileRow.id)
          .in('status', ['open', 'in_progress', 'in_review'])
          .order('created_at', { ascending: false });
        const uniqueMissions = Array.from(new Map(((workerMissions as Pyramid[]) || []).map((m) => [m.id, m])).values());
        setMyActiveMissions(uniqueMissions);
      } else {
        setMyPyramids([]);
        setMyActiveMissions([]);
      }

    } catch (err) {
      console.error("Error fetching profile data:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMarketplaceJobs = async () => {
    try {
      setMarketplaceLoading(true);
      setMarketplaceError(null);

      // Только миссии, ждущие рабочего: status === 'pending' и worker_id пустой
      const { data, error } = await supabase
        .from('pyramids')
        .select('*')
        .eq('status', 'pending')
        .is('worker_id', null)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        throw error;
      }

      // Полная перезапись стейта, дедупликация по id (защита от клонов при двойном рендере / realtime)
      const uniqueJobs = Array.from(new Map((data || []).map((j: Pyramid) => [j.id, j])).values()) as Pyramid[];
      setMarketplaceJobs(uniqueJobs);
    } catch (err) {
      console.error('Error fetching marketplace jobs:', err);
      setMarketplaceError('Не удалось загрузить миссии. Попробуйте обновить страницу.');
    } finally {
      setMarketplaceLoading(false);
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
    <div className="h-screen overflow-y-auto pb-32 bg-slate-900/60 backdrop-blur-md font-sans ltr relative">
      <div className="min-h-full py-6 px-4 flex flex-col items-center relative z-10">
        <div className="w-full max-w-2xl relative z-10">
        
        {/* WALLET SECTION */}
        <header className="flex justify-between items-center mb-8 bg-slate-800/80 backdrop-blur-sm text-white p-6 rounded-3xl border border-white/10 shadow-2xl">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-700/80 hover:bg-slate-600 text-slate-200 hover:text-white text-xs font-bold uppercase tracking-wider transition-colors"
            >
              🗺️ TO MAP
            </Link>
            <div>
            <p className="text-teal-400 text-[10px] uppercase tracking-widest font-bold">Your Balance</p>
            <p className="text-4xl font-black">{balance} <span className="text-sm font-normal opacity-50">EGP</span></p>
            {userProfile?.verification_status === 'verified' && (
              <span className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold border border-emerald-500/40">
                ✓ Верифицирован
              </span>
            )}
            {userProfile?.verification_status === 'pending' && (
              <span className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold border border-amber-500/40">
                Документы на проверке
              </span>
            )}
            </div>
          </div>
          <button className="bg-teal-500 hover:bg-teal-400 text-slate-900 px-6 py-3 rounded-2xl font-black text-xs transition-all active:scale-95">
            + RECHARGE
          </button>
        </header>

        {/* MY REQUESTS (HOME WORK) */}
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
            ) : myPyramids.length === 0 ? (
              <p className="text-slate-500 text-sm italic">You haven't created any requests yet.</p>
            ) : (
              myPyramids.map((p) => (
                <div key={p.id} className="bg-slate-800/70 backdrop-blur-sm border border-white/10 rounded-2xl p-4">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[10px] text-slate-500/80 font-mono">#{p.id.slice(0, 8)}</span>
                    <span className="text-[10px] text-slate-500">{new Date(p.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="flex justify-between items-start mb-4">
                    <span className={`text-[10px] px-2 py-1 rounded-full font-bold ${p.status === 'active' ? 'bg-emerald-500' : p.status === 'disputed' ? 'bg-red-500/80' : 'bg-slate-600'}`}>
                      {p.status.toUpperCase()}
                    </span>
                    <div className="flex items-center gap-2">
                      {(p.status === 'pending' || p.status === 'payment_pending') && (
                        <button
                          type="button"
                          onClick={() => handleDeletePyramid(p.id)}
                          className="text-[10px] font-bold text-red-400 hover:text-red-300 hover:underline uppercase"
                        >
                          Удалить
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Диспут: контакт поддержки */}
                  {p.status === 'disputed' && (
                    <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
                      <p className="text-red-300 text-sm font-medium mb-2">Mission in dispute. Contact support:</p>
                      <a href={SUPPORT_TELEGRAM} target="_blank" rel="noopener noreferrer" className="text-teal-400 font-bold underline hover:text-teal-300">
                        {SUPPORT_TELEGRAM}
                      </a>
                    </div>
                  )}

                  {/* in_review или verifying: фото ДО/ПОСЛЕ и кнопки APPROVE / DISPUTE */}
                  {(p.status === 'in_review' || p.status === 'verifying') && (
                    <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                      <p className="text-emerald-400 text-xs font-bold mb-3 text-center">РАБОЧИЙ ЗАКОНЧИЛ! ПРОВЕРЬ ФОТО:</p>
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="rounded-xl overflow-hidden bg-slate-800 border border-white/10">
                          <p className="text-[10px] text-slate-500 px-2 py-1 uppercase">ДО</p>
                          {p.worker_photo_start_url ? (
                            <img src={p.worker_photo_start_url} alt="До" className="w-full aspect-square object-cover" />
                          ) : (
                            <div className="w-full aspect-square flex items-center justify-center text-slate-500 text-xs">Нет фото</div>
                          )}
                        </div>
                        <div className="rounded-xl overflow-hidden bg-slate-800 border border-white/10">
                          <p className="text-[10px] text-slate-500 px-2 py-1 uppercase">ПОСЛЕ</p>
                          {p.photo_after_url ? (
                            <img src={p.photo_after_url} alt="После" className="w-full aspect-square object-cover" />
                          ) : (
                            <div className="w-full aspect-square flex items-center justify-center text-slate-500 text-xs">Нет фото</div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleConfirmDone(p)}
                          className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-white py-3 rounded-xl font-black text-sm shadow-lg transition-all"
                        >
                          APPROVE
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDispute(p)}
                          className="flex-1 py-3 rounded-xl border border-red-500/50 text-red-400 hover:bg-red-500/20 font-bold text-sm transition-all"
                        >
                          DISPUTE
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        {/* MY ACTIVE MISSIONS (где я рабочий — оплатил депозит) */}
        <section className="mb-10 text-white">
          <h2 className="text-xl font-black mb-4 text-amber-400">🎯 MY ACTIVE MISSIONS</h2>
          {myActiveMissions.length === 0 ? (
            <p className="text-slate-500 text-sm italic">Ты ещё не взял ни одной миссии. Выбери миссию в маркетплейсе и оплати депозит.</p>
          ) : (
            <div className="space-y-4">
              {myActiveMissions.map((mission) => {
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
                      <span className="text-[10px] text-slate-500/80 font-mono">#{mission.id.slice(0, 8)}</span>
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

        {/* MARKETPLACE (CITY WORK & BIDDING) — pointer-events-auto чтобы карточки были кликабельны */}
        <section className="text-white pointer-events-auto relative z-10">
          <h2 className="text-xl font-black mb-4 text-teal-400">🌍 GLOBAL MARKETPLACE</h2>

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

          {!marketLoading && !marketError && marketplaceJobs.length === 0 && (
            <p className="text-sm text-slate-500 italic">
              Пока нет активных миссий. Загляни позже — города скоро проснутся.
            </p>
          )}

          {!marketLoading && !marketError && marketplaceJobs.length > 0 && (
            <div className="grid grid-cols-1 gap-4 pointer-events-auto">
              {marketplaceJobs.map((job) => {
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
                        <span className="text-[10px] text-slate-500/80 font-mono">#{job.id.slice(0, 8)}</span>
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
