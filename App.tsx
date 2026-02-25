import React, { useState } from 'react';

function App() {
  const [loading, setLoading] = useState(false);

  // Данные для Iframe (остаются на фронтенде)
  const IFRAME_ID = "1007120";

  const handlePayMobPayment = async () => {
    setLoading(true);
    console.log("🚀 Запуск оплаты через защищенный мостик...");

    try {
      // Вызываем наш серверный обработчик в папке /api
      const response = await fetch('/api/paymob', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        throw new Error('Ошибка сервера при получении токена');
      }

      const data = await response.json();
      
      if (data.token) {
        console.log("✅ Токен получен, перенаправляем в PayMob Iframe...");
        // Переход на страницу оплаты PayMob
        window.location.href = `https://egypt.paymob.com/api/acceptance/iframes/${IFRAME_ID}?payment_token=${data.token}`;
      } else {
        throw new Error("Токен не найден в ответе сервера");
      }

    } catch (error) {
      console.error("❌ Ошибка:", error);
      alert("Не удалось инициировать платеж. Убедись, что папка /api/paymob.js создана и запушена.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#020024] flex flex-col items-center justify-center relative overflow-hidden font-sans">
      
      {/* Твой фирменный неоновый фон (Зеленый -> Желтый -> Фиолетовый) */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#39FF14] via-[#FFF000] to-[#8B00FF] opacity-35 animate-pulse"></div>
      
      {/* Свечение в центре */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-500/20 via-transparent to-transparent pointer-events-none"></div>

      <div className="relative z-10 flex flex-col items-center text-center px-4">
        <h1 className="text-7xl md:text-9xl font-black text-white mb-4 tracking-tighter drop-shadow-[0_0_30px_rgba(255,255,255,0.3)]">
          Clean Egypt
        </h1>
        
        <p className="text-xl md:text-2xl font-bold text-[#39FF14] uppercase tracking-[0.5em] mb-12 drop-shadow-[0_0_10px_rgba(57,255,20,0.5)]">
          Red Sea Mission
        </p>

        {/* Главная кнопка */}
        <button
          onClick={handlePayMobPayment}
          disabled={loading}
          className={`group relative px-12 py-6 bg-black text-white rounded-3xl font-black text-2xl transition-all duration-300 hover:scale-110 active:scale-95 shadow-2xl ${loading ? 'opacity-50 cursor-wait' : ''}`}
        >
          {/* Анимированная рамка */}
          <div className="absolute -inset-1.5 bg-gradient-to-r from-[#39FF14] via-[#FFF000] to-[#8B00FF] rounded-3xl blur-md opacity-75 group-hover:opacity-100 transition duration-500"></div>
          
          <span className="relative z-10 flex items-center gap-3">
            {loading ? "CONNECTING..." : "CREATE ACCOUNT 🚀"}
          </span>
        </button>

        <div className="mt-20 flex flex-col gap-2 items-center">
          <p className="text-white/40 font-mono text-xs uppercase tracking-widest">
            Official PayMob Integration
          </p>
          <div className="h-1 w-24 bg-gradient-to-r from-[#39FF14] to-[#8B00FF] rounded-full opacity-50"></div>
        </div>
      </div>
    </div>
  );
}

export default App;
