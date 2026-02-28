import React, { useState } from 'react';

const Profile = () => {
  const [balance, setBalance] = useState(0); // Баланс в EGP
  const [hasId, setHasId] = useState(false); // Статус загрузки ID

  // Логика депозита (Имитация PayMob / Vodafone Cash)
  const handleDeposit = () => {
    // В будущем здесь будет вызов API PayMob
    setBalance(prev => prev + 100);
    alert("100 EGP Added via Vodafone Cash! 💸");
  };

  return (
    <div className="min-h-screen bg-[#0a0b0e] text-white p-6 font-sans">
      <h1 className="text-3xl font-black italic text-cyan-400 mb-6">HQ DASHBOARD</h1>

      {/* Блок Работника / Депозиты */}
      <div className="bg-white/5 p-6 rounded-3xl border border-cyan-400/30 mb-6">
        <h2 className="text-xl font-bold mb-2">WORKER WALLET</h2>
        <p className="text-gray-400 text-sm mb-4">Balance: <span className="text-green-400 font-bold">{balance} EGP</span></p>
        
        {balance < 100 ? (
          <div>
            <p className="text-xs text-yellow-400 mb-4">Deposit 100 EGP to unlock $5 jobs & all city donations! (Includes 25 EGP starting discount)</p>
            <button
              onClick={handleDeposit}
              className="w-full py-3 bg-cyan-400 text-black font-black rounded-xl hover:bg-cyan-300"
            >
              PAY DEPO (100 EGP)
            </button>
          </div>
        ) : (
          <div className="text-green-400 font-bold text-sm">
            ✅ Account Active. Ready to Grab Jackpots!
          </div>
        )}
      </div>

      {/* Верификация ID */}
      <div className="bg-white/5 p-6 rounded-3xl border border-purple-400/30 mb-6">
        <h2 className="text-xl font-bold mb-2">NATIONAL ID</h2>
        {!hasId ? (
          <div>
            <input type="file" className="text-sm text-gray-400 mb-4 w-full file:rounded-full file:border-0 file:bg-purple-500/20 file:text-purple-400 file:py-2 file:px-4" />
            <button
              onClick={() => setHasId(true)}
              className="w-full py-3 bg-purple-500 text-white font-black rounded-xl hover:bg-purple-400"
            >
              UPLOAD EGYPT ID
            </button>
          </div>
        ) : (
          <div className="text-green-400 font-bold text-sm">✅ ID Verified</div>
        )}
      </div>
    </div>
  );
};

export default Profile;
