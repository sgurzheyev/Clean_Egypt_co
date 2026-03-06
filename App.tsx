import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import MapPicker from './components/MapPicker';
import Auth from './components/Auth';
import PaymentOverlay from './components/PaymentOverlay';
import Slider from './components/Slider';
import Profile from './components/Profile';
import TryFree from './components/TryFree'; // ИМПОРТ ДОБАВЛЕН
import { supabase } from './services/supabase';

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [amount, setAmount] = useState(5);
  const [orderType, setOrderType] = useState<'home' | 'city'>('home');
  const [showPayment, setShowPayment] = useState(false);
  const [targetCoords, setTargetCoords] = useState<{lat: number, lng: number} | null>(null);
  const [orders, setOrders] = useState<any[]>([]);

  const fetchOrders = async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) setOrders(data);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    supabase.auth.onAuthStateChange((_event, session) => setSession(session));
    fetchOrders();
  }, []);

  const handlePaymentSuccess = () => {
    setShowPayment(false);
    setTargetCoords(null);
    fetchOrders();
  };

  return (
    <Router>
      <div className="relative w-full h-screen bg-black overflow-hidden">
        {/* Карта всегда на заднем фоне (не удаляется при переходе в Profile и т.д.) */}
        <div className="fixed inset-0 z-0 w-full h-full">
          <MapPicker
            onLocationSelect={(lat, lng) => setTargetCoords({lat, lng})}
            orders={orders}
            currentAmount={amount}
            currentType={orderType}
          />
        </div>

        <Routes>
          <Route path="/" element={
            <>
              <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-full max-w-md px-4 space-y-4 z-30">
                <Slider amount={amount} setAmount={setAmount} type={orderType} />
                
                <div className="flex gap-2">
                  <button
                    onClick={() => { setOrderType('city'); setAmount(1); }}
                    className={`flex-1 py-4 rounded-2xl font-black italic transition-all ${orderType === 'city' ? 'bg-[#38bd3d] text-black shadow-[0_0_20px_#38bd3d]' : 'bg-zinc-900 text-zinc-500'}`}
                  >
                    {orderType === 'city' ? `CITY ${amount}$` : 'CITY $1'}
                  </button>
                  <button
                    onClick={() => { setOrderType('home'); setAmount(5); }}
                    className={`flex-1 py-4 rounded-2xl font-black italic transition-all ${orderType === 'home' ? 'bg-[#FFD700] text-black shadow-[0_0_20px_#FFD700]' : 'bg-zinc-900 text-zinc-500'}`}
                  >
                    {orderType === 'home' ? `HOME ${amount}$` : 'HOME $5'}
                  </button>
                </div>

                <button
                  onClick={() => setShowPayment(true)}
                  disabled={!targetCoords}
                  className="w-full py-5 bg-gradient-to-r from-cyan-500 to-purple-600 rounded-[2rem] font-black text-xl italic uppercase tracking-widest shadow-2xl active:scale-95 transition-all disabled:opacity-50 disabled:grayscale"
                >
                  {targetCoords ? "CLEAN MY WALLET 🚀" : "SELECT TARGET ON MAP"}
                </button>
              </div>

              {showPayment && targetCoords && (
                <PaymentOverlay
                  lat={targetCoords.lat}
                  lng={targetCoords.lng}
                  amount={amount}
                  type={orderType}
                  onClose={() => setShowPayment(false)}
                  onSuccess={handlePaymentSuccess}
                />
              )}
            </>
          } />

          <Route path="/auth" element={!session ? <Auth /> : <Navigate to="/profile" />} />
          <Route path="/profile" element={<Profile />} />
          
          {/* МАРШРУТ ДЛЯ СБОРА EMAIL */}
          <Route path="/try-free" element={<TryFree />} />
        </Routes>
      </div>
    </Router>
  );
};

export default App;
