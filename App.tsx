import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import MapPicker from './components/MapPicker';
import Auth from './components/Auth';
import PaymentOverlay from './components/PaymentOverlay';
import Slider from './components/Slider';
import Profile from './components/Profile'; // Твоя страница Eco-Hero
import { supabase } from './lib/supabase';

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [amount, setAmount] = useState(5); // Дефолт для Home Pyramid
  const [orderType, setOrderType] = useState<'home' | 'city'>('home');
  const [showPayment, setShowPayment] = useState(false);
  const [targetCoords, setTargetCoords] = useState<{lat: number, lng: number} | null>(null);

  useEffect(() => {
    // Проверка сессии при загрузке
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    supabase.auth.onAuthStateChange((_event, session) => setSession(session));
  }, []);

  return (
    <Router>
      <div className="relative w-full h-screen bg-black overflow-hidden">
        <Routes>
          {/* ГЛАВНЫЙ ЭКРАН: КАРТА И УПРАВЛЕНИЕ */}
          <Route path="/" element={
            <>
              <MapPicker
                onLocationSelect={(lat, lng) => setTargetCoords({lat, lng})}
                orders={[]} // Сюда подтянутся данные из твоей таблицы orders
                currentAmount={amount}
                currentType={orderType}
              />

              {/* ПАНЕЛЬ УПРАВЛЕНИЯ (Floating UI) */}
              <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-full max-w-md px-4 space-y-4 z-30">
                <Slider amount={amount} setAmount={setAmount} type={orderType} />
                
                <div className="flex gap-2">
                  <button
                    onClick={() => { setOrderType('city'); setAmount(1); }}
                    className={`flex-1 py-4 rounded-2xl font-black italic transition-all ${orderType === 'city' ? 'bg-[#38bd3d] text-black shadow-[0_0_20px_#38bd3d]' : 'bg-zinc-900 text-zinc-500'}`}
                  >
                    CITY $1
                  </button>
                  <button
                    onClick={() => { setOrderType('home'); setAmount(5); }}
                    className={`flex-1 py-4 rounded-2xl font-black italic transition-all ${orderType === 'home' ? 'bg-[#FFD700] text-black shadow-[0_0_20px_#FFD700]' : 'bg-zinc-900 text-zinc-500'}`}
                  >
                    HOME $5
                  </button>
                </div>

                <button
                  onClick={() => setShowPayment(true)}
                  disabled={!targetCoords}
                  className="w-full py-5 bg-gradient-to-r from-cyan-500 to-purple-600 rounded-[2rem] font-black text-xl italic uppercase tracking-widest shadow-2xl active:scale-95 transition-all"
                >
                  {targetCoords ? "CLEAN MY WALLET 🚀" : "SELECT TARGET ON MAP"}
                </button>
              </div>

              {/* Окно оплаты Paymob */}
              {showPayment && targetCoords && (
                <PaymentOverlay
                  lat={targetCoords.lat}
                  lng={targetCoords.lng}
                  onClose={() => setShowPayment(false)}
                />
              )}
            </>
          } />

          {/* ДРУГИЕ СТРАНИЦЫ */}
          <Route path="/auth" element={!session ? <Auth /> : <Navigate to="/profile" />} />
          <Route path="/profile" element={<Profile />} />
        </Routes>
      </div>
    </Router>
  );
};

export default App;
