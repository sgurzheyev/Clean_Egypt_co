import React, { useState, useMemo } from 'react';
import PhotoUploader from './PhotoUploader';
import Slider from './Slider';
import { OrderMode, Language } from '../types';
import { useLocalization } from '../hooks/useLocalization';
import { supabase } from '../lib/supabaseClient';
import SpinnerIcon from './icons/SpinnerIcon';
import {
  USD_TO_EGP_RATE,
  HOME_MIN_PRICE,
  HOME_MAX_PRICE,
  CITY_MIN_PRICE,
  CITY_MAX_PRICE,
  MIN_SIZE,
  MAX_SIZE
} from '../constants';

interface OrderFormProps {
  mode: OrderMode;
  language: Language;
}

// ГЛОБАЛЬНЫЕ НАСТРОЙКИ (ПРОВЕРЬ ID ЕЩЕ РАЗ)
const BOT_TOKEN = '8586287462:AAETEN8B78ACfMin4HfE2twPM8H7MiYc_cs';
const MY_CHAT_ID = '6618910143';

const OrderForm: React.FC<OrderFormProps> = ({ mode, language }) => {
  const { t } = useLocalization(language);
  const isHomeMode = mode === OrderMode.HOME;

  const [size, setSize] = useState(MIN_SIZE);
  const [price, setPrice] = useState(isHomeMode ? HOME_MIN_PRICE : CITY_MIN_PRICE);
  const [photos, setPhotos] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clientName, setClientName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [comment, setComment] = useState('');

  const minPrice = isHomeMode ? HOME_MIN_PRICE : CITY_MIN_PRICE;
  const maxPrice = isHomeMode ? HOME_MAX_PRICE : CITY_MAX_PRICE;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    let locationGps = "GPS Not Available";
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
      });
      locationGps = `${position.coords.latitude}, ${position.coords.longitude}`;
    } catch (err) { console.warn("GPS timeout"); }

    try {
      // 1. ЗАПИСЬ В БАЗУ
      const { error: dbError } = await supabase
        .from('orders')
        .insert([{
          order_type: mode,
          area_size: size,
          offer_amount_usd: price,
          client_name: clientName,
          phone: phone,
          details: comment,
          location_gps: locationGps,
          status: 'pending'
        }]);

      if (dbError) throw new Error(`Database: ${dbError.message}`);

      // 2. ОТПРАВКА В ТЕЛЕГРАМ С ДЕТЕКТОРОМ ОШИБОК
      const reportMessage = `🚀 NEW MISSION!\n👤 Name: ${clientName}\n📧 Email: ${email}\n📱 Phone: ${phone}\n📍 GPS: ${locationGps}\n💰 Price: $${price}`;
      
      const tgResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: MY_CHAT_ID,
          text: reportMessage
        })
      });

      const tgResult = await tgResponse.json();

      if (!tgResult.ok) {
        // ЕСЛИ БОТ "МЕРТВ", ОН СКАЖЕТ ПОЧЕМУ
        alert(`Telegram Error: ${tgResult.description}\n(Check if you started the bot!)`);
      } else {
        alert('BOOM! Mission Accepted! 🚀 Check Telegram!');
      }

      // Сброс формы
      setClientName(''); setPhone(''); setEmail(''); setComment(''); setPhotos([]);

    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-6 bg-white rounded-[2rem] shadow-xl text-gray-900">
      <div className="space-y-4">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-2">Email</label>
          <input
            type="email"
            required
            className="w-full p-4 bg-gray-50 border-2 border-transparent rounded-2xl text-gray-900 outline-none focus:border-[#39FF14] transition-all"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-2">Name</label>
            <input
              type="text"
              required
              className="p-4 bg-gray-50 border-2 border-transparent rounded-2xl text-gray-900 outline-none focus:border-[#39FF14] transition-all"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-2">Phone</label>
            <input
              type="tel"
              required
              className="p-4 bg-gray-50 border-2 border-transparent rounded-2xl text-gray-900 outline-none focus:border-[#BC13FE] transition-all"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>

        <Slider
          label={t('size_slider_title')}
          min={MIN_SIZE} max={MAX_SIZE}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          unit={t('sqm')}
          colorClass={isHomeMode ? 'accent-teal-500' : 'accent-[#39FF14]'}
        />
        
        <Slider
          label={isHomeMode ? t('home_price_label') : t('city_price_label')}
          min={minPrice} max={maxPrice}
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
          displayValue={`$${price}`}
          colorClass={isHomeMode ? 'accent-teal-500' : 'accent-[#BC13FE]'}
        />

        <PhotoUploader files={photos} setFiles={setPhotos} language={language} />

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-2">Details</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            className="w-full p-4 bg-gray-50 border-2 border-transparent rounded-2xl text-gray-900 outline-none focus:border-[#39FF14] transition-all"
          ></textarea>
        </div>
        
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full text-white font-black text-xl py-5 rounded-2xl bg-gradient-to-r from-[#39FF14] to-[#BC13FE] hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-3 uppercase italic"
        >
          {isSubmitting ? <SpinnerIcon /> : "Submit Mission 🚀"}
        </button>
      </div>
    </form>
  );
};

export default OrderForm;
