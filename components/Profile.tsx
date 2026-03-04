import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

const Profile = () => {
  const [balance, setBalance] = useState(0);
  const [myPyramids, setMyPyramids] = useState<any[]>([]);
  const [marketplaceJobs, setMarketplaceJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      alert("Оплата прошла успешно! Твоя пирамида создана.");
    }
    fetchProfileData();
  }, []);

  const fetchProfileData = async () => {
    try {
      setLoading(true);
      // 1. Получаем данные профиля и баланс
      const { data: profile } = await supabase.from('profiles').select('*').single();
      if (profile) setBalance(profile.balance_egp || 0);

      // 2. Мои заказы (где я владелец)
      const { data: myData } = await supabase
        .from('pyramids')
        .select('*')
        .eq('creator_id', profile?.id)
        .order('created_at', { ascending: false });
      if (myData) setMyPyramids(myData);

      // 3. Доступные работы (Маркетплейс)
      const { data: marketData } = await supabase
        .from('pyramids')
        .select('*')
        .neq('status', 'completed')
        .limit(20);
      if (marketData) setMarketplaceJobs(marketData);

    } catch (err) {
      console.error("Error fetching profile data:", err);
    } finally {
      setLoading(false);
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

  if (loading) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-teal-400">LOADING PROFILE...</div>;

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
          <div className="grid grid-cols-1 gap-4">
            {marketplaceJobs.map(job => (
              <div key={job.id} className="bg-slate-800 border border-slate-700 p-5 rounded-2xl flex justify-between items-center hover:border-teal-500/50 transition-colors">
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-black">{job.job_type} MISSION</p>
                  <p className="text-2xl font-black tracking-tighter">
                    {job.job_type === 'home' ? `${job.final_price_egp} EGP` : `${job.current_amount_usd}$`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] text-slate-500 mb-1 uppercase">Worker Deposit</p>
                  <p className="text-xs font-bold text-teal-400">
                    {(job.job_type === 'home' ? job.final_price_egp : job.current_amount_usd * 50) * 0.5} EGP
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
};

export default Profile;
