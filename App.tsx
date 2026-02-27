import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import MapPicker from './components/MapPicker';
import Auth from './components/Auth';
import PaymentOverlay from './components/PaymentOverlay';
import Slider from './components/Slider';
import Profile from './components/Profile'; // Твоя страница Eco-Hero
import { supabase } from './services/supabase'; //

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [amount, setAmount] = useState(5); // Дефолт для Home Pyramid
  const [orderType, setOrderType] = useState<'home' | 'city'>('home');
  const [showPayment, setShowPayment] = useState(false);
  const [targetCoords, setTargetCoords] = useState<{lat: number, lng: number} | null>(null);
  const [orders, setOrders] = useState<any[]>([]); // Стейт для хранения пирамид на карте

  // 1. ПОДТЯГИВАЕМ СУЩЕСТВУЮЩИЕ ПИРАМИДЫ ИЗ БАЗЫ
  const fetchOrders = async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (!error && data) setOrders(data);
  };

  useEffect(() => {
    // Проверка сессии при загрузке
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    supabase.auth.onAuthStateChange((_event, session) => setSession(session));
    
    fetchOrders(); // Загружаем заказы при старте
  }, []);

  // 2. ФУНКЦИЯ ОБРАБОТКИ УСПЕШНОГО ПЛАТЕЖА
  const handlePaymentSuccess = () => {
    setShowPayment(false); // Закрываем экран загрузки
    setTargetCoords(null); // Сбрасываем выбранную точку
    fetchOrders(); // Обновляем карту, чтобы увидеть новую пирамиду
  };

  return (
    <Router>
      <div className="relative w-full h-screen bg-black overflow-hidden">
        <Routes>
          {/* ГЛАВНЫЙ ЭКРАН: КАРТА И УПРАВЛЕНИЕ */}
          <Route path="/" element={
            <>
              <MapPicker
                onLocationSelect={(lat, lng) => setTargetCoords({lat, lng})}
                orders={orders} // Теперь передаем реальные данные из Supabase
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
                  className="w-full py-5 bg-gradient-to-r from-cyan-500 to-purple-600 rounded-[2rem] font-black text-xl italic uppercase tracking-widest shadow-2xl active:scale-95 transition-all disabled:opacity-50 disabled:grayscale"
                >
                  {targetCoords ? "CLEAN MY WALLET 🚀" : "SELECT TARGET ON MAP"}
                </button>
              </div>

              {/* Окно оплаты Paymob с фиксом закрытия */}
              {showPayment && targetCoords && (
                <PaymentOverlay
                  lat={targetCoords.lat}
                  lng={targetCoords.lng}
                  amount={amount}
                  type={orderType}
                  onClose={() => setShowPayment(false)}
                  onSuccess={handlePaymentSuccess} // Передаем колбэк для выхода из загрузки
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
