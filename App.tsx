import React from 'react';

function App() {
  const handleTestPayment = () => {
    alert("Testing payment for CleanEgypt.co");
  };

  return (
    <div className="min-h-screen w-full bg-[#020024] flex flex-col items-center justify-center overflow-x-hidden relative">
      
      {/* Тот самый градиент: Neon Green -> Yellow -> Purple */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#39FF14] via-[#FFF000] to-[#8B00FF] opacity-30 pointer-events-none"></div>
      
      {/* Дополнительный эффект свечения в центре */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/10 via-transparent to-transparent pointer-events-none"></div>

      <div className="relative z-10 flex flex-col items-center">
        <h1 className="text-7xl font-black mb-2 tracking-tighter text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]">
          Clean Egypt
        </h1>
        
        <p className="text-xl font-bold mb-12 tracking-[0.3em] uppercase text-[#39FF14]">
          Red Sea Mission
        </p>
        
        <button
          onClick={handleTestPayment}
          className="group relative px-12 py-5 bg-black text-white rounded-2xl font-black text-xl transition-all duration-300 hover:scale-105 active:scale-95 shadow-2xl"
        >
          {/* Рамка кнопки с твоим градиентом */}
          <div className="absolute -inset-1 bg-gradient-to-r from-[#39FF14] via-[#FFF000] to-[#8B00FF] rounded-2xl blur opacity-70 group-hover:opacity-100 transition duration-300"></div>
          
          <span className="relative z-10">CREATE ACCOUNT 🚀</span>
        </button>
      </div>
    </div>
  );
}

export default App;
