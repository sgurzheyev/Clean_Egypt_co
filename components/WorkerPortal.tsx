import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

const WorkerPortal = () => {
  const [worker, setWorker] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 1. ЧИТАЕМ ДАННЫЕ ИЗ ССЫЛКИ (динамика)
  const queryParams = new URLSearchParams(window.location.search);
  const orderId = queryParams.get('orderId') || 'NEW';
  const jobPrice = parseInt(queryParams.get('price') || '500');
  const depositNeeded = jobPrice * 0.5; // Депозит 50%

  const TEST_TELEGRAM_ID = 111222333; // Твой Ahmed Pro

  useEffect(() => {
    fetchWorkerBalance();
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

  // ФУНКЦИЯ ПОПОЛНЕНИЯ (связь с тобой)
  const handleRecharge = () => {
    const msg = `Hi Sergio! I want to top up my balance. My ID: ${worker?.telegram_id}`;
    window.location.href = `https://wa.me/201014167909?text=${encodeURIComponent(msg)}`;
  };

  // ФУНКЦИЯ ВЗЯТИЯ ЗАКАЗА
  const handleTakeJob = async () => {
    if (worker.balance_egp < depositNeeded) {
      alert(`🛑 LOW BALANCE! You need ${depositNeeded} EGP deposit for this job.`);
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
        alert("✅ DEPOSIT LOCKED! Opening client contact...");
        window.location.href = "https://wa.me/2010XXXXXXXX"; // Здесь будет номер клиента
      } else {
        alert("Transaction error. Try again.");
      }
    }
  };

  if (loading) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-teal-400">Loading Wallet...</div>;

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 font-sans ltr">
      <div className="max-w-md mx-auto">
        
        {/* БЛОК БАЛАНСА */}
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl p-6 shadow-2xl border border-slate-700 mb-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-teal-400 font-bold uppercase text-[10px] tracking-[2px]">Worker Wallet</h2>
              <p className="text-4xl font-black">{worker?.balance_egp} <span className="text-sm font-normal text-slate-400">EGP</span></p>
            </div>
            <button
              onClick={handleRecharge}
              className="bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 px-3 py-2 rounded-xl text-xs font-bold border border-teal-500/30 transition-all"
            >
              + RECHARGE
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

        {/* КАРТОЧКА ЗАКАЗА */}
        <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden shadow-xl">
          <div className="p-5 border-b border-slate-700 bg-slate-800/50 text-center">
            <p className="text-teal-400 font-black text-xl">ORDER #{orderId}</p>
          </div>
          <div className="p-6">
            <div className="flex justify-between items-center mb-8">
              <div>
                <p className="text-slate-500 text-[10px] uppercase font-bold mb-1">Security Deposit</p>
                <p className="text-3xl font-black text-white">{depositNeeded} <span className="text-sm">EGP</span></p>
              </div>
              <div className="text-right">
                <p className="text-slate-500 text-[10px] uppercase font-bold mb-1">Total Job Price</p>
                <p className="text-lg font-bold text-slate-300">{jobPrice} EGP</p>
              </div>
            </div>
            
            <button
              onClick={handleTakeJob}
              className="w-full bg-teal-500 hover:bg-teal-400 text-slate-900 py-4 rounded-xl font-black text-sm shadow-[0_0_30px_rgba(20,184,166,0.2)] transition-all active:scale-95"
            >
              TAKE JOB & GET CONTACT
            </button>
            <p className="text-center text-[9px] text-slate-600 mt-4 uppercase tracking-tighter">
              By clicking, you agree to freeze the deposit amount
            </p>
          </div>
        </div>

        {error && <p className="text-red-400 mt-6 text-center text-sm bg-red-400/10 py-2 rounded-lg">{error}</p>}
      </div>
    </div>
  );
};

export default WorkerPortal;
