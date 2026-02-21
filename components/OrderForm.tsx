import React, { useState } from 'react';
import PhotoUploader from './PhotoUploader';
import Slider from './Slider';
import { OrderMode, Language } from '../types';
import { useLocalization } from '../hooks/useLocalization';
import { supabase } from '../lib/supabaseClient';
import SpinnerIcon from './icons/SpinnerIcon';
import {
  HOME_MIN_PRICE, HOME_MAX_PRICE,
  CITY_MIN_PRICE, CITY_MAX_PRICE,
  MIN_SIZE, MAX_SIZE
} from '../constants';

interface OrderFormProps {
  mode: OrderMode;
  language: Language;
}

// --- КОНФИГУРАЦИЯ КАНАЛОВ ---
const BOT_TOKEN = '8586287462:AAETEN8B78ACfMin4HfE2twPM8H7MiYc_cs';
const ADMIN_ID = '6618910143'; // Твой проверенный ID
const WORKERS_CHAT_ID = '-1002447101567'; // ID группы CleanEgypt Workers

const sendBroadcast = async (message: string) => {
  const ids = [ADMIN_ID, WORKERS_CHAT_ID];
  
  for (const chat_id of ids) {
    try {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id,
          text: message,
          parse_mode: 'HTML'
        })
      });
    } catch (e) {
      console.error(`Failed sending to ${chat_id}`, e);
    }
  }
};

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    let gps = "GPS Access Denied";
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) => {
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 });
      });
      gps = `${pos.coords.latitude}, ${pos.coords.longitude}`;
    } catch (err) { console.warn("GPS timeout"); }

    try {
      // 1. Сохранение в базу
      const { error: dbError } = await supabase.from('orders').insert([{
        order_type: mode,
        area_size: size,
        offer_amount_usd: price,
        client_name: clientName,
        phone: phone,
        details: comment,
        location_gps: gps,
        status: 'pending'
      }]);

      if (dbError) throw dbError;

      // 2. Рассылка уведомлений
      const report = `
🚀 <b>NEW MISSION!</b>
━━━━━━━━━━━━━━━━━━
👤 <b>Client:</b> ${clientName}
📱 <b>Phone:</b> <code>${phone}</code>
📧 <b>Email:</b> ${email}
📍 <b>GPS:</b> <code>${gps}</code>
💰 <b>Price:</b> $${price}
📝 <b>Info:</b> ${comment || 'Clean mission'}
━━━━━━━━━━━━━━━━━━
      `;

      await sendBroadcast(report);

      // 3. WhatsApp Link (для тебя)
      const waMsg = encodeURIComponent(`New Mission! Client: ${clientName}, Phone: ${phone}, Price: $${price}`);
      window.open(`https://wa.me/201026563603?text=${waMsg}`, '_blank');

      alert('BOOM! Mission Accepted! 🚀');
      setClientName(''); setPhone(''); setEmail(''); setComment(''); setPhotos([]);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-6 bg-white rounded-[2rem] shadow-xl text-black">
      <div className="space-y-4">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-2">Email Address</label>
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
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-2">Client Name</label>
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
          unit="sqm"
          colorClass="accent-[#39FF14]"
        />
        
        <Slider
          label="Price"
          min={isHomeMode ? HOME_MIN_PRICE : CITY_MIN_PRICE}
          max={isHomeMode ? HOME_MAX_PRICE : CITY_MAX_PRICE}
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
          displayValue={`$${price}`}
          colorClass="accent-[#BC13FE]"
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
          className="w-full text-white font-black text-xl py-5 rounded-2xl bg-gradient-to-r from-[#39FF14] to-[#BC13FE] hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 uppercase italic"
        >
          {isSubmitting ? <SpinnerIcon /> : "Submit Mission 🚀"}
        </button>
      </div>
    </form>
  );
};

export default OrderForm;
