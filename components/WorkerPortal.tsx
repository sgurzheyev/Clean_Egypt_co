import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

const WorkerPortal = () => {
  const [worker, setWorker] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // В реальности мы получим этот ID из Telegram WebApp initData
  // Для теста пока возьмем твой ID Ахмеда из базы
  const TEST_TELEGRAM_ID = 111222333;

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
      setError('Worker not found. Register first!');
    } finally {
      setLoading(false);
    }
  };

  const handleTakeJob = async (jobPriceEgp: number) => {
    if (worker.balance_egp < jobPriceEgp) {
      alert("🛑 LOW BALANCE! You need " + jobPriceEgp + " EGP to bid.");
      return;
    }

    // ЛОГИКА СПИСАНИЯ ДЕПОЗИТА
    const newBalance = worker.balance_egp - jobPriceEgp;
    
    const { error: updateError } = await supabase
      .from('worker_balances')
      .update({ balance_egp: newBalance })
      .eq('telegram_id', TEST_TELEGRAM_ID);

    if (updateError) {
      alert("Transaction failed!");
    } else {
      alert("✅ DEPOSIT LOCKED! Here is client WhatsApp: +2010XXXXXXXX");
      setWorker({...worker, balance_egp: newBalance});
      // Здесь мы перенаправляем на WhatsApp
      window.location.href = "https://wa.me/2010XXXXXXXX";
    }
  };

  if (loading) return <div className="p-10 text-center">Loading Wallet...</div>;

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6 font-sans">
      <div className="max-w-md mx-auto bg-slate-800 rounded-3xl p-8 shadow-2xl border border-slate-700">
        <h1 className="text-2xl font-black mb-2 text-teal-400">CLEANEGYPT WORKER HUB</h1>
        <p className="text-slate-400 text-sm mb-6">Verified: {worker?.is_verified ? '✅' : '❌'}</p>

        <div className="bg-gradient-to-br from-teal-500 to-emerald-600 rounded-2xl p-6 mb-8 shadow-lg">
          <p className="text-xs uppercase font-bold opacity-80">Your Balance</p>
          <p className="text-4xl font-black">{worker?.balance_egp} EGP</p>
        </div>

        <div className="space-y-4">
          <div className="bg-slate-700 p-4 rounded-xl flex justify-between items-center">
            <div>
              <p className="font-bold text-sm">New Order #442</p>
              <p className="text-xs text-slate-400">Price: 500 EGP | Deposit: 250 EGP</p>
            </div>
            <button
              onClick={() => handleTakeJob(250)}
              className="bg-teal-500 hover:bg-teal-400 px-4 py-2 rounded-lg font-bold text-xs transition-all"
            >
              BID NOW
            </button>
          </div>
        </div>
        
        {error && <p className="text-red-400 mt-4 text-center">{error}</p>}
      </div>
    </div>
  );
};

export default WorkerPortal;
