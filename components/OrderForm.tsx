// src/components/OrderForm.tsx
import React, { useState } from 'react';
// ИСПОЛЬЗУЕМ НАШ НОВЫЙ ПУТЬ СЕРВИСА
import { supabase } from '../services/supabase'; 

interface Props {
  selectedLocation: { lat: number; lng: number } | null;
  onOrderStarted?: () => void; // Для включения синей заглушки загрузки
}

const OrderForm: React.FC<Props> = ({ selectedLocation, onOrderStarted }) => {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState(''); // ПАРСЕР ИМЕЙЛОВ

  const createOrder = async (type: 'egypt' | 'home', amount: number) => {
    if (!selectedLocation) return alert("Tap on map first! 📍");
    if (!email || !email.includes('@')) return alert("Enter valid Email to start! 📧");
    
    setLoading(true);
    if (onOrderStarted) onOrderStarted(); // ВКЛЮЧАЕМ "УСТАНОВКУ СОЕДИНЕНИЯ"

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const creatorId = session?.user?.id ?? null;
      // 1. Сначала сохраняем лид (email) в базу, даже если оплата не пройдет
      const { error } = await supabase.from('pyramids').insert([
        {
          location: `POINT(${selectedLocation.lng} ${selectedLocation.lat})`,
          mission_type: type,
          current_amount: amount,
          user_email: email, // СОХРАНЯЕМ В ЛАПЫ
          status: 'pending_payment',
          creator_id: creatorId
        }
      ]);

      if (error) throw error;

      // 2. ИМИТАЦИЯ ПЕРЕХОДА НА ПЛАТЕЖ (PayMob)
      setTimeout(() => {
        // Силовой редирект в профиль, чтобы не висела заглушка
        window.location.href = '/profile'; 
      }, 2000);

    } catch (error: any) {
      console.error(error.message);
      // Если ошибка — всё равно шлем в профиль через 2 секунды
      setTimeout(() => {
        window.location.href = '/profile?error=payment_failed';
      }, 2000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 p-4 bg-black/60 backdrop-blur-md rounded-2xl border border-white/10">
      {/* ПОЛЕ ВВОДА EMAIL - ТВОЙ ПАРСЕР */}
      <div className="space-y-2">
        <label className="text-[10px] text-gray-400 uppercase tracking-widest ml-1">Your Intelligence Email</label>
        <input 
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="agent@cleanegypt.co"
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:border-[#00f2ff] outline-none transition-all"
        />
      </div>

      <p className="text-[10px] text-gray-500 uppercase tracking-[0.2em] text-center">
        {selectedLocation
          ? `TARGET: ${selectedLocation.lat.toFixed(4)}, ${selectedLocation.lng.toFixed(4)}`
          : "SELECT TARGET ON MAP"}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <button
          disabled={loading}
          onClick={() => createOrder('egypt', 1)}
          className="py-4 bg-[#39FF14]/10 border border-[#39FF14]/40 text-[#39FF14] rounded-xl font-black italic hover:bg-[#39FF14] hover:text-black transition-all text-xs"
        >
          CITY $1
        </button>

        <button
          disabled={loading}
          onClick={() => createOrder('home', 5)}
          className="py-4 bg-[#f8ff14]/10 border border-[#f8ff14]/40 text-[#f8ff14] rounded-xl font-black italic hover:bg-[#f8ff14] hover:text-black transition-all text-xs"
        >
          HOME $5
        </button>
      </div>
    </div>
  );
};

export default OrderForm;