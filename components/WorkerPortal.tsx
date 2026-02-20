import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

const WorkerPortal = () => {
  const [worker, setWorker] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isActiveJob, setIsActiveJob] = useState(false); // Новое состояние

  const queryParams = new URLSearchParams(window.location.search);
  const orderId = queryParams.get('orderId') || 'NEW';
  const jobPrice = parseInt(queryParams.get('price') || '500');
  const depositNeeded = jobPrice * 0.5;

  const TEST_TELEGRAM_ID = 111222333;

  useEffect(() => {
    fetchWorkerBalance();
    
    // Подписка на изменения баланса в реальном времени!
    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'worker_balances', filter: `telegram_id=eq.${TEST_TELEGRAM_ID}` },
        (payload) => setWorker(payload.new)
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchWorkerBalance = async () => {
    try {
      const { data, error } = await supabase
        .from('worker_balances')
        .select('*')
        .eq('telegram_id', TEST_TELEGRAM_ID)
        .single();
      if (error) throw error;
      setWorker(data);
    } catch (err: any) {
      setError('Worker not found. Please contact Admin.');
    } finally {
      setLoading(false);
    }
  };

  const handleRecharge = () => {
    const msg = `Hi Sergio! I want to top up my balance. My ID: ${worker?.telegram_id}`;
    window.location.href = `https://wa.me/201014167909?text=${encodeURIComponent(msg)}`;
  };

  const handleFinishJob = () => {
    const msg = `Boss! I finished Order #${orderId}. Ready for check! ✅`;
    window.location.href = `https://wa.me/201014167909?text=${encodeURIComponent(msg)}`;
  };

  const handleTakeJob = async () => {
    if (worker.balance_egp < depositNeeded) {
      alert(`🛑 LOW BALANCE! You need ${depositNeeded} EGP deposit.`);
      return;
    }

    if (window.confirm(`Take order #${orderId}? ${depositNeeded} EGP will be locked.`)) {
      const newBalance = worker.balance_egp - depositNeeded;
      
      const { error: updateError } = await supabase
        .from('worker_balances')
        .update({ balance_egp: newBalance })
        .eq('telegram_id', TEST_TELEGRAM_ID);

      if (!updateError) {
        setWorker({...worker, balance_egp: newBalance});
        setIsActiveJob(true); // Активируем режим работы
        alert("✅ DEPOSIT LOCKED! Opening client contact...");
        window.location.href = "https://wa.me/2010XXXXXXXX"; // Номер из заказа
      }
    }
  };

  if (loading) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-teal-400">Loading Wallet...</div>;

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 font-sans ltr">
      <div className="max-w-md mx-auto">
        
        {/* БЛОК БАЛАНСА */}
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl p-6 shadow-2xl border border-slate-700 mb-6 relative overflow-hidden">
          <div className="relative z-10 flex justify-between items-start mb-4">
            <div>
              <h2 className="text-teal-400 font-bold uppercase text-[10px] tracking-[2px]">Your Balance</h2>
              <p className="text-4xl font-black">{worker?.balance_egp} <span className="text-sm font-normal text-slate-400">EGP</span></p>
            </div>
            <button onClick={handleRecharge} className="bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 px-3 py-2 rounded-xl text-xs font-bold border border-teal-500/30">
              + TOP UP
            </button>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
            <span>ID: {worker?.telegram_id}</span>
            <span>•</span>
            <span className={worker?.is_verified ? "text-emerald-400" : "text-amber-400"}>
              {worker?.is_verified ? "VERIFIED ✅" : "PENDING ⏳"}
            </span>
          </div>
        </div>

        {/* ДИНАМИЧЕСКАЯ КАРТОЧКА ЗАКАЗА */}
        <div className={`rounded-2xl border transition-all duration-500 ${isActiveJob ? 'border-emerald-500 bg-emerald-500/5' : 'border-slate-700 bg-slate-800'}`}>
          <div className="p-5 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
            <p className="text-teal-400 font-black text-xl tracking-tighter text-uppercase">ORDER #{orderId}</p>
            {isActiveJob && <span className="animate-pulse bg-emerald-500 text-[10px] px-2 py-1 rounded-full text-white font-bold">ACTIVE</span>}
          </div>
          
          <div className="p-6">
            {!isActiveJob ? (
              <>
                <div className="flex justify-between items-center mb-8">
                  <div>
                    <p className="text-slate-500 text-[10px] uppercase font-bold mb-1 tracking-widest">Security Deposit</p>
                    <p className="text-3xl font-black text-white">{depositNeeded} <span className="text-sm uppercase opacity-50">EGP</span></p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-500 text-[10px] uppercase font-bold mb-1 tracking-widest">Job Value</p>
                    <p className="text-lg font-bold text-slate-400">{jobPrice} EGP</p>
                  </div>
                </div>
                <button
                  onClick={handleTakeJob}
                  className="w-full bg-teal-500 hover:bg-teal-400 text-slate-900 py-4 rounded-xl font-black text-sm shadow-[0_0_30px_rgba(20,184,166,0.2)] transition-all active:scale-95"
                >
                  TAKE JOB & PAY DEPOSIT
                </button>
              </>
            ) : (
              <div className="space-y-4">
                <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl text-center">
                  <p className="text-emerald-400 text-sm font-bold">You are currently working on this job!</p>
                </div>
                <button
                  onClick={handleFinishJob}
                  className="w-full bg-white text-slate-900 py-4 rounded-xl font-black text-sm shadow-xl active:scale-95 transition-all"
                >
                  ✅ FINISH & SEND REPORT
                </button>
              </div>
            )}
            
            <p className="text-center text-[9px] text-slate-600 mt-4 uppercase tracking-tighter">
              {isActiveJob ? "Report to Sergio to unlock your next job" : "Deposit is frozen until job completion"}
            </p>
          </div>
        </div>

        {error && <p className="text-red-400 mt-6 text-center text-sm bg-red-400/10 py-2 rounded-lg">{error}</p>}
      </div>
    </div>
  );
};

export default WorkerPortal;
