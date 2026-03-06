import React, { useState, useEffect } from 'react';
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
}

interface ProfileRow {
  id: string;
  balance_egp: number | null;
}

const Profile: React.FC = () => {
  const [balance, setBalance] = useState(0);
  const [myPyramids, setMyPyramids] = useState<Pyramid[]>([]);
  const [marketplaceJobs, setMarketplaceJobs] = useState<Pyramid[]>([]);
  const [loading, setLoading] = useState(true);
  const [marketLoading, setMarketplaceLoading] = useState(true);
  const [marketError, setMarketplaceError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      alert("Оплата прошла успешно! Твоя пирамида создана.");
    }
    fetchProfileData();
    fetchMarketplaceJobs();
  }, []);

  const fetchProfileData = async () => {
    try {
      // 1. Получаем данные профиля и баланс
      const { data: profile } = await supabase
        .from<ProfileRow>('profiles')
        .select('*')
        .single();

      if (profile) {
        setBalance(profile.balance_egp ?? 0);
      }

      // 2. Мои заказы (где я владелец)
      const { data: myData } = await supabase
        .from<Pyramid>('pyramids')
        .select('*')
        .eq('creator_id', profile?.id)
        .order('created_at', { ascending: false });
      if (myData) setMyPyramids(myData);

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

      const { data, error } = await supabase
        .from<Pyramid>('pyramids')
        .select('*')
        .neq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        throw error;
      }

      setMarketplaceJobs(data || []);
    } catch (err) {
      console.error('Error fetching marketplace jobs:', err);
      setMarketplaceError('Не удалось загрузить миссии. Попробуйте обновить страницу.');
    } finally {
      setMarketplaceLoading(false);
    }
  };

  const handleConfirmDone = async (pyramid: any) => {
    // Владелец подтверждает чистоту по Photo 3 (Worker Finish)
    if (window.confirm("Подтверждаешь выполнение? Депозит вернется рабочему, и он получит оплату.")) {
      try {
        const finalPrice = pyramid.final_price_egp || (pyramid.current_amount_usd * 50);
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

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 font-sans ltr">
      <div className="max-w-2xl mx-auto">
        
        {/* WALLET SECTION */}
        <header className="flex justify-between items-center mb-8 bg-slate-800 p-6 rounded-3xl border border-slate-700 shadow-2xl">
          <div>
            <p className="text-teal-400 text-[10px] uppercase tracking-widest font-bold">Your Balance</p>
            <p className="text-4xl font-black">{balance} <span className="text-sm font-normal opacity-50">EGP</span></p>
          </div>
          <button className="bg-teal-500 hover:bg-teal-400 text-slate-900 px-6 py-3 rounded-2xl font-black text-xs transition-all active:scale-95">
            + RECHARGE
          </button>
        </header>

        {/* MY REQUESTS (HOME WORK) */}
        <section className="mb-10">
          <h2 className="text-xl font-black mb-4 flex items-center gap-2">
            🏠 MY HOME REQUESTS
          </h2>
          <div className="space-y-4">
            {myPyramids.length === 0 ? (
              <p className="text-slate-500 text-sm italic">You haven't created any requests yet.</p>
            ) : (
              myPyramids.map(p => (
                <div key={p.id} className="bg-slate-800/40 border border-slate-700 rounded-2xl p-4">
                  <div className="flex justify-between items-start mb-4">
                    <span className={`text-[10px] px-2 py-1 rounded-full font-bold ${p.status === 'active' ? 'bg-emerald-500' : 'bg-slate-600'}`}>
                      {p.status.toUpperCase()}
                    </span>
                    <p className="text-xs text-slate-500">{new Date(p.created_at).toLocaleDateString()}</p>
                  </div>
                  
                  {/* Если работа в проверке, показываем кнопку DONE */}
                  {p.status === 'verifying' && (
                    <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                      <p className="text-emerald-400 text-xs font-bold mb-3 text-center">РАБОЧИЙ ЗАКОНЧИЛ! ПРОВЕРЬ ФОТО:</p>
                      <button
                        onClick={() => handleConfirmDone(p)}
                        className="w-full bg-emerald-500 hover:bg-emerald-400 text-white py-3 rounded-xl font-black text-sm shadow-lg transition-all"
                      >
                        ✅ CONFIRM & PAY WORKER
                      </button>
                      <button className="w-full mt-2 text-red-400 text-[10px] font-bold uppercase tracking-widest">
                        🚨 REPORT DISPUTE
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        {/* MARKETPLACE (CITY WORK & BIDDING) */}
        <section>
          <h2 className="text-xl font-black mb-4 text-teal-400">🌍 GLOBAL MARKETPLACE</h2>

          {marketLoading && (
            <div className="grid grid-cols-1 gap-4 mb-2">
              {[1, 2, 3].map((skeleton) => (
                <div
                  key={skeleton}
                  className="bg-slate-800 border border-slate-700 p-5 rounded-2xl animate-pulse"
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
            <div className="grid grid-cols-1 gap-4">
              {marketplaceJobs.map((job) => {
                const missionLabel = (job.mission_type || 'city').toString().toUpperCase();
                const targetUsd = job.target_amount ?? 0;
                const exchangeRate = 50; // Должен совпадать с серверной логикой
                const depositEgp = Math.round(targetUsd * exchangeRate * 0.5);

                return (
                  <div
                    key={job.id}
                    className="bg-slate-800 border border-slate-700 p-5 rounded-2xl flex justify-between items-center hover:border-teal-500/50 transition-colors"
                  >
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-black">
                        {missionLabel} MISSION
                      </p>
                      <p className="text-2xl font-black tracking-tighter">
                        {targetUsd > 0 ? `${targetUsd}$` : 'Custom bid'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] text-slate-500 mb-1 uppercase">Worker Deposit</p>
                      <p className="text-xs font-bold text-teal-400">
                        {depositEgp > 0 ? `${depositEgp} EGP` : '—'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

      </div>
    </div>
  );
};

export default Profile;
