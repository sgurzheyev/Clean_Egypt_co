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

// Единая функция уведомлений
const sendNotifications = async (message: string, clientPhone: string) => {
  // 1. Отчет лично Серджио
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: '6618910143', text: message })
  });

  // 2. В группу рабочих CleanEgypt Workers с кнопкой WhatsApp
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: '-5115781349',
      text: `🚀 NEW JOB AVAILABLE!\n\n${message.split('\n\n')[0]}`,
      reply_markup: {
        inline_keyboard: [[
          {
            text: "📦 TAKE JOB (WhatsApp)",
            url: `https://wa.me/${clientPhone.replace(/\D/g,'')}`
          }
        ]]
      }
    })
  });
};

const OrderForm: React.FC<OrderFormProps> = ({ mode, language }) => {
  const { t } = useLocalization(language);
  const isHomeMode = mode === OrderMode.HOME;

  const [photos, setPhotos] = useState<File[]>([]);
  const [email, setEmail] = useState('');
  const [orderCount, setOrderCount] = useState<number>(0);
  const [size, setSize] = useState<number>(50);
  const [price, setPrice] = useState<number>(isHomeMode ? HOME_MIN_PRICE : CITY_MIN_PRICE);
  const [comment, setComment] = useState('');
  const [clientName, setClientName] = useState('');
  const [phone, setPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { minPrice, maxPrice, priceLabel, priceColor, title, commentPlaceholder } = useMemo(() => {
    if (isHomeMode) {
      return {
        minPrice: HOME_MIN_PRICE,
        maxPrice: HOME_MAX_PRICE,
        priceLabel: t('price_slider_title_home'),
        priceColor: 'accent-teal-500',
        title: t('order_form_title_home'),
        commentPlaceholder: t('comment_placeholder'),
      };
    } else {
      return {
        minPrice: CITY_MIN_PRICE,
        maxPrice: CITY_MAX_PRICE,
        priceLabel: t('price_slider_title_city'),
        priceColor: 'accent-blue-500',
        title: t('order_form_title_city'),
        commentPlaceholder: t('comment_placeholder_city'),
      };
    }
  }, [isHomeMode, t]);
  
  React.useEffect(() => {
    setPrice(isHomeMode ? HOME_MIN_PRICE : CITY_MIN_PRICE);
  }, [isHomeMode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const locationGps = `${latitude}, ${longitude}`;

          for (const photo of photos) {
            const fileName = `${Date.now()}-${photo.name}`;
            await supabase.storage.from('order-photos').upload(fileName, photo);
          }

          const { error: insertError } = await supabase.from('orders').insert([
            {
              area_size: size,
              offer_amount_usd: price,
              details: comment,
              location_gps: locationGps,
              order_type: mode,
              client_name: clientName,
              phone: phone,
              status: 'new'
            },
          ]);

          if (insertError) throw new Error(insertError.message);
          
          const rank = size > 2000 ? 'World Changer 🌍' : 'Eco-Hero 🌿';
          const reportMessage = `🚀 NEW ORDER! \n👤 Name: ${clientName} \n📧 Email: ${email} \n📱 Phone: ${phone} \n📍 GPS: ${locationGps} \n🏆 Status: ${rank} \n\n"Hey Sergio! Your place will be clean as soon as we get enough donations."`;
          
          // Сначала отправляем данные всем
          await sendNotifications(reportMessage, phone);

          // Потом показываем успех
          alert(`VICTORY! \n\nYou've unlocked: ${rank} \nStatus: Order Reserved!`);
          
          // Очищаем форму только в самом конце
          setPhotos([]);
          setClientName('');
          setPhone('');
          setEmail('');
          setComment('');

        } catch (error) {
          alert((error as Error).message);
        } finally {
          setIsSubmitting(false);
        }
      },
      () => {
        alert(`Please enable location to place an order.`);
        setIsSubmitting(false);
      }
    );
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8 space-y-8 border border-gray-200">
      <h2 className="text-2xl md:text-3xl font-extrabold text-center text-gray-800">{title}</h2>
      
      {orderCount > 0 && (
        <div className="mt-4 mb-6 p-4 bg-blue-50 rounded-xl border border-blue-100 shadow-sm">
          <div className="flex justify-between text-[10px] font-black text-blue-800 mb-2 tracking-widest uppercase">
            <span>Corporate Scale</span>
            <span>{orderCount}%</span>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-3 overflow-hidden border border-blue-300">
            <div
              className="bg-blue-600 h-full rounded-full transition-all duration-1000 ease-out"
              style={{ width: `${Math.min(orderCount, 100)}%` }}
            ></div>
          </div>
        </div>
      )}

      <div className="mt-4 p-4 bg-yellow-50 rounded-xl border border-yellow-200 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">📸</span>
          <p className="text-sm font-bold text-yellow-800">Get Photo Proof!</p>
        </div>
        <input
          type="email"
          required
          placeholder="Enter email for Before/After photos"
          className="w-full p-3 border-2 border-yellow-300 rounded-lg text-sm outline-none focus:ring-4 focus:ring-yellow-200 transition-all"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input
            type="text"
            required
            placeholder="Your Name"
            className="p-3 border rounded-lg focus:ring-2 focus:ring-teal-400 outline-none"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
          />
          <input
            type="tel"
            required
            placeholder="Phone Number"
            className="p-3 border rounded-lg focus:ring-2 focus:ring-teal-400 outline-none"
            value={phone}
            onChange={(e) => {
              const val = e.target.value;
              setPhone(val);
              if (val.length >= 10) checkInvestorProgress(val, setOrderCount);
            }}
          />
        </div>

        <PhotoUploader files={photos} setFiles={setPhotos} language={language} />

        <Slider label={t('size_slider_title')} min={MIN_SIZE} max={MAX_SIZE} value={size} onChange={(e) => setSize(Number(e.target.value))} unit={t('sqm')} colorClass={isHomeMode ? 'accent-teal-500' : 'accent-blue-500'} />
        <Slider label={priceLabel} min={minPrice} max={maxPrice} value={price} onChange={(e) => setPrice(Number(e.target.value))} displayValue={`$${price}`} colorClass={priceColor} />

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={commentPlaceholder}
          rows={3}
          className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-teal-400 outline-none"
        ></textarea>
        
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full text-white font-bold text-xl py-4 rounded-full bg-gradient-to-r from-green-400 to-teal-500 hover:scale-105 transition disabled:opacity-70 flex items-center justify-center gap-3"
        >
          {isSubmitting && <SpinnerIcon className="w-6 h-6" />}
          {isSubmitting ? 'Placing Order...' : t('submit_order')}
        </button>
      </form>
    </div>
  );
};

export default OrderForm;
