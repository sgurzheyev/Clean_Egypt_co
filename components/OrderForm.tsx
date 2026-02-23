import React, { useState } from 'react';
import PhotoUploader from './PhotoUploader';
import Slider from './Slider';
import { OrderMode, Language } from '../types';
import { useLocalization } from '../hooks/useLocalization';
import { supabase } from '../lib/supabaseClient';
import SpinnerIcon from './icons/SpinnerIcon';
import {
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

const BOT_TOKEN = '8586287462:AAETEN8B78ACfMin4HfE2twPM8H7MiYc_cs';
const MY_ID = '6618910143';
const WORKERS_ID = '-1003508290829';
const MY_PHONE = '48532883201'; // ИСПРАВЛЕНО: дубликат удален

const sendBroadcast = async (message: string, price: number, photoFiles: File[]) => {
  const targets = [MY_ID, WORKERS_ID];
  for (const chatId of targets) {
    try {
      const formData = new FormData();
      formData.append('chat_id', chatId);
      if (photoFiles.length > 0) {
        formData.append('photo', photoFiles[0]);
        formData.append('caption', message + `\n\n💰 <b>Total: $${price}</b>`);
        formData.append('parse_mode', 'HTML');
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: 'POST', body: formData });
      } else {
        formData.append('text', message + `\n\n💰 <b>Total: $${price}</b>`);
        formData.append('parse_mode', 'HTML');
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { method: 'POST', body: formData });
      }
    } catch (e) { console.error("TG Error:", e); }
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

    let locationGps = "Denied";
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) => {
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 });
      });
      locationGps = `${pos.coords.latitude}, ${pos.coords.longitude}`;
    } catch (err) { console.warn("GPS off"); }

    try {
      const photoUrls = [];
      for (const file of photos) {
        const path = `${Date.now()}_${file.name}`;
        const { error } = await supabase.storage.from('order-photos').upload(path, file);
        if (!error) photoUrls.push(path);
      }

      const { error: dbError } = await supabase.from('orders').insert([{
        order_type: mode,
        area_size: size,
        offer_amount_usd: price,
        client_name: clientName,
        phone: phone,
        details: comment,
        location_gps: locationGps,
        photo_urls: photoUrls,
        status: 'pending'
      }]);

      if (dbError) throw dbError;

      await sendBroadcast(`🚀 <b>NEW MISSION!</b>\n👤 Client: ${clientName}\n📏 Size: ${size}m2\n📱 Phone: ${phone}\n📍 GPS: ${locationGps}`, price, photos);
      window.open(`https://wa.me/${MY_PHONE}?text=New Mission! $${price}`, '_blank');
      alert('BOOM! Mission Saved! 🚀');
    } catch (err: any) { alert(err.message); } finally { setIsSubmitting(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4 bg-white rounded-[2rem] shadow-xl text-gray-900 w-full max-w-lg">
      <input type="email" placeholder="Email" required className="w-full p-4 bg-gray-50 border-2 rounded-2xl outline-none focus:border-[#39FF14]" value={email} onChange={e => setEmail(e.target.value)} />
      <div className="flex gap-2">
        <input type="text" placeholder="Name" required className="w-1/2 p-4 bg-gray-50 border-2 rounded-2xl outline-none focus:border-[#39FF14]" value={clientName} onChange={e => setClientName(e.target.value)} />
        <input type="tel" placeholder="Phone" required className="w-1/2 p-4 bg-gray-50 border-2 rounded-2xl outline-none focus:border-[#BC13FE]" value={phone} onChange={e => setPhone(e.target.value)} />
      </div>
      <Slider label={t('size_slider_title')} min={MIN_SIZE} max={MAX_SIZE} value={size} onChange={e => setSize(Number(e.target.value))} unit="sq.m." />
      <Slider label="Price" min={isHomeMode ? HOME_MIN_PRICE : CITY_MIN_PRICE} max={isHomeMode ? HOME_MAX_PRICE : CITY_MAX_PRICE} value={price} onChange={e => setPrice(Number(e.target.value))} displayValue={`$${price}`} />
      <PhotoUploader files={photos} setFiles={setPhotos} language={language} />
      <textarea placeholder="Details..." className="w-full p-4 bg-gray-50 border-2 rounded-2xl outline-none" rows={2} value={comment} onChange={e => setComment(e.target.value)} />
      <button type="submit" disabled={isSubmitting} className="w-full py-5 rounded-2xl bg-gradient-to-r from-[#39FF14] to-[#BC13FE] text-white font-black uppercase italic active:scale-95 transition-all">
        {isSubmitting ? <SpinnerIcon /> : "Submit Mission 🚀"}
      </button>
    </form>
  );
};

export default OrderForm;
