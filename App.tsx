import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import MapPicker from './components/MapPicker';
import Auth from './components/Auth';
import PaymentOverlay from './components/PaymentOverlay';
import Slider from './components/Slider';
import Profile from './components/Profile';
import TryFree from './components/TryFree';
import VerificationPage from './components/VerificationPage';
import EmailCaptureGate, { hasPassedEmailGate } from './components/EmailCaptureGate';
import { supabase } from './services/supabase';

/** При переходе в профиль принудительно сбрасываем состояние оплаты, чтобы оверлей не оставался в памяти и не блокировал UI. */
const PaymentStateClearer: React.FC<{ setShowPayment: (v: boolean) => void; setTargetCoords: (v: null) => void }> = ({ setShowPayment, setTargetCoords }) => {
  const location = useLocation();
  useEffect(() => {
    if (location.pathname !== '/') {
      setShowPayment(false);
      setTargetCoords(null);
    }
  }, [location.pathname, setShowPayment, setTargetCoords]);
  return null;
};

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [hasProvidedEmail, setHasProvidedEmail] = useState(() => hasPassedEmailGate());
  const [amount, setAmount] = useState(5);
  const [orderType, setOrderType] = useState<'home' | 'city'>('home');
  const [showPayment, setShowPayment] = useState(false);
  const [targetCoords, setTargetCoords] = useState<{lat: number, lng: number} | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [mapRefreshKey, setMapRefreshKey] = useState(0);

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

  /** Вызывается при успешной оплате: принудительно убираем оверлей и координаты, чтобы не блокировать интерфейс. */
  const handlePaymentSuccess = () => {
    setShowPayment(false);
    setTargetCoords(null);
    setAmount(5);
    setOrderType('home');
    fetchOrders();
  };

  /** Полный сброс UI карты при отмене или ошибке оплаты; при pyramidId — удаляем зависшую пирамиду из БД. */
  const handlePaymentClose = async (pyramidId?: string) => {
    if (pyramidId) {
      try {
        await supabase.from('pyramids').delete().eq('id', pyramidId);
      } catch (e) {
        console.error('Failed to delete pending pyramid:', e);
      }
    }
    setShowPayment(false);
    setTargetCoords(null);
    setAmount(5);
    setOrderType('home');
    setMapRefreshKey((k) => k + 1);
  };

  const showEmailGate = !session && !hasProvidedEmail;

  return (
    <Router>
      <PaymentStateClearer
        setShowPayment={setShowPayment}
        setTargetCoords={setTargetCoords}
      />
      <div className="relative w-full h-screen bg-black overflow-hidden">
        {/* Карта всегда на заднем фоне (не удаляется при переходе в Profile и т.д.) */}
        <div className="fixed inset-0 z-0 w-full h-full">
          <MapPicker
            key={mapRefreshKey}
            onLocationSelect={(lat, lng) => setTargetCoords({lat, lng})}
            selectedCoords={targetCoords}
            orders={orders}
            currentAmount={amount}
            currentType={orderType}
            hasFullAccess={!!session}
            showPayment={showPayment}
            onRequestPayment={({ lat, lng, amount: a, type: t }) => {
              setTargetCoords({ lat, lng });
              setAmount(a);
              setOrderType(t);
              setShowPayment(true);
            }}
          />
        </div>

        <Routes>
          <Route path="/" element={
            <>
              {/* Воронка сбора email: только на главной; без email карта закрыта */}
              {showEmailGate && (
                <EmailCaptureGate onUnlock={() => setHasProvidedEmail(true)} />
              )}
              <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-full max-w-md px-4 space-y-4 z-30 pointer-events-auto">
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

              {/* Бритва Оккама: PaymentOverlay в DOM только при открытой оплате; иначе компонента нет — нет «призрачного» фона */}
              {showPayment && targetCoords ? (
                <PaymentOverlay
                  lat={targetCoords.lat}
                  lng={targetCoords.lng}
                  amount={amount}
                  type={orderType}
                  onClose={handlePaymentClose}
                  onSuccess={handlePaymentSuccess}
                />
              ) : null}
            </>
          } />

          <Route path="/auth" element={!session ? <Auth /> : <Navigate to="/profile" />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/verify" element={<VerificationPage />} />

          <Route path="/try-free" element={<TryFree />} />
        </Routes>
      </div>
    </Router>
  );
};

export default App;
