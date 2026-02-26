import React, { useState } from 'react';
import MapPicker from './MapPicker';
import PaymentOverlay from './PaymentOverlay';
import { useLocalization } from '../hooks/useLocalization';
import { Language } from '../types';

interface OrderFormProps {
  language: Language;
}

const OrderForm: React.FC<OrderFormProps> = ({ language }) => {
  const { t } = useLocalization(language);
  
  // Состояния для формы и координат
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [email, setEmail] = useState('');

  // Функция, которую вызывает MapPicker при клике на карту
  const handleLocationSelect = (locationString: string) => {
    const [lat, lng] = locationString.split(',').map(Number);
    setCoords({ lat, lng });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!coords) {
      alert("Please select a location on the map first!");
      return;
    }
    // Открываем окно оплаты
    setShowPayment(true);
  };

  return (
    <div className="relative">
      <form onSubmit={handleSubmit} className="space-y-6 bg-[#111111] p-8 rounded-[2.5rem] border border-white/5 shadow-2xl">
        <h2 className="text-2xl font-black italic text-[#39FF14] uppercase tracking-tighter">
          Create Mission
        </h2>

        {/* Поле Email */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-zinc-500 uppercase ml-4">Your Contact Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="hero@cleanegypt.co"
            className="w-full bg-black p-4 rounded-2xl border border-white/10 focus:border-[#39FF14] outline-none transition-all text-white text-sm"
          />
        </div>

        {/* Карта для выбора места */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-zinc-500 uppercase ml-4">Target Location</label>
          <MapPicker onLocationSelect={handleLocationSelect} />
        </div>

        {/* Кнопка отправки */}
        <button
          type="submit"
          className="w-full bg-gradient-to-r from-[#39FF14] to-[#BC13FE] text-black font-black py-5 rounded-2xl uppercase italic hover:scale-[1.02] active:scale-95 transition-all shadow-[0_0_20px_rgba(57,255,20,0.3)]"
        >
          Activate Pyramid ($0.99) 🚀
        </button>
      </form>

      {/* Оверлей оплаты — появляется только если координаты выбраны и кнопка нажата */}
      {showPayment && coords && (
        <PaymentOverlay
          lat={coords.lat}
          lng={coords.lng}
          onClose={() => setShowPayment(false)}
        />
      )}
    </div>
  );
};

export default OrderForm;
