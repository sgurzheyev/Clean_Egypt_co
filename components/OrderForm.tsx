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

const checkInvestorProgress = async (phone: string, setOrderCount: (count: number) => void) => {
  const { data } = await supabase
    .from('user_achievements')
    .select('orders_completed')
    .eq('phone_number', phone)
    .single();

  if (data) {
    setOrderCount(data.orders_completed);
  }
};

const token = '8586287462:AAETEN8B78ACfMin4HfE2twPM8H7MiYc_cs';

const sendNotifications = async (message: string, clientPhone: string, orderId: string, price: number) => {
  // Отчет лично Серджио
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: '158546194',
      text: `🚀 NEW ORDER!\n${message}\nPrice: $${price}`
    })
  });
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
  const [orderCount, setOrderCount] = useState(0);

  const minPrice = isHomeMode ? HOME_MIN_PRICE : CITY_MIN_PRICE;
  const maxPrice = isHomeMode ? HOME_MAX_PRICE : CITY_MAX_PRICE;
  const priceLabel = isHomeMode ? t('home_price_label') : t('city_price_label');
  const priceColor = isHomeMode ? 'accent-teal-500' : 'accent-neon-purple';
  const commentPlaceholder = isHomeMode ? t('home_comment_placeholder') : t('city_comment_placeholder');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      const { data, error } = await supabase
        .from('orders')
        //этот блок в Xcode на место старого insert
        .insert([{
          order_type: mode,
          area_size: size,
          offer_amount_usd: price,
          client_name: clientName,
          phone: phone,
          email: email,
          details: comment,
          status: 'pending'
        }])
        .select();

      if (error) throw error;

      await sendNotifications(`Order from ${clientName}`, phone, data[0].id, price);
      alert('Success! Order placed.');
    } catch (err) {
      console.error(err);
      alert('Error placing order');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-6 bg-white rounded-[2rem] shadow-xl">
      <div className="space-y-4">
        {/* Поле Email - буквы ТЕПЕРЬ ВИДНЫ (text-gray-900) */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-2">Email Address</label>
          <input
            type="email"
            required
            className="w-full p-4 bg-gray-50 border-2 border-transparent rounded-2xl text-gray-900 outline-none focus:border-[#39FF14] transition-all"
            placeholder="example@mail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        {/* Name & Phone - буквы ТЕПЕРЬ ВИДНЫ (text-gray-900) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-2">Name</label>
            <input
              type="text"
              required
              className="p-4 bg-gray-50 border-2 border-transparent rounded-2xl text-gray-900 outline-none focus:border-[#39FF14] transition-all"
              placeholder="Sergio"
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
              placeholder="+20..."
              value={phone}
              onChange={(e) => {
                const val = e.target.value;
                setPhone(val);
                if (val.length >= 10) checkInvestorProgress(val, setOrderCount);
              }}
            />
          </div>
        </div>

        {/* Слайдеры */}
        <Slider
          label={t('size_slider_title')}
          min={MIN_SIZE}
          max={MAX_SIZE}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          unit={t('sqm')}
          colorClass={isHomeMode ? 'accent-teal-500' : 'accent-[#39FF14]'}
        />
        
        <Slider
          label={priceLabel}
          min={minPrice}
          max={maxPrice}
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
          displayValue={`$${price}`}
          colorClass={isHomeMode ? 'accent-teal-500' : 'accent-[#BC13FE]'}
        />

        {/* Фото и Комментарий - буквы ТЕПЕРЬ ВИДНЫ (text-gray-900) */}
        <PhotoUploader files={photos} setFiles={setPhotos} language={language} />

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-2">Comment</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={commentPlaceholder}
            rows={3}
            className="w-full p-4 bg-gray-50 border-2 border-transparent rounded-2xl text-gray-900 outline-none focus:border-[#39FF14] transition-all"
          ></textarea>
        </div>
        
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full text-white font-black text-xl py-5 rounded-2xl bg-gradient-to-r from-[#39FF14] to-[#BC13FE] shadow-lg shadow-green-500/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-3 uppercase italic tracking-tighter"
        >
          {isSubmitting ? <SpinnerIcon /> : t('submit_button')}
        </button>
      </div>
    </form>
  );
};

export default OrderForm;
