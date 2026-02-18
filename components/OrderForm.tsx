
import React, { useState, useMemo } from 'react';
import PhotoUploader from './PhotoUploader';
import Slider from './Slider';
import { OrderMode, Language } from '../types';
import { useLocalization } from '../hooks/useLocalization';
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

const OrderForm: React.FC<OrderFormProps> = ({ mode, language }) => {
  const { t } = useLocalization(language);
  const isHomeMode = mode === OrderMode.HOME;

  const [photos, setPhotos] = useState<File[]>([]);
  const [size, setSize] = useState<number>(50);
  const [price, setPrice] = useState<number>(isHomeMode ? HOME_MIN_PRICE : CITY_MIN_PRICE);
  const [comment, setComment] = useState('');

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
  
  // Reset price when mode changes
  React.useEffect(() => {
    setPrice(isHomeMode ? HOME_MIN_PRICE : CITY_MIN_PRICE);
  }, [isHomeMode]);


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Placeholder for submission logic
    console.log({
      mode,
      photos,
      size,
      price,
      comment,
      priceEGP: price * USD_TO_EGP_RATE,
    });
    // Here you would integrate with Supabase to upload photos and create a DB record.
    // Then, trigger the payment flow (Paymob/Stripe).
    alert('Order submitted to console! Ready for Supabase & Payment integration.');
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8 space-y-8 border border-gray-200">
      <h2 className="text-2xl md:text-3xl font-extrabold text-center text-gray-800">{title}</h2>
      
      <form onSubmit={handleSubmit} className="space-y-8">
        <PhotoUploader files={photos} setFiles={setPhotos} language={language} />

        <Slider
          label={t('size_slider_title')}
          min={MIN_SIZE}
          max={MAX_SIZE}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          unit={t('sqm')}
          colorClass={isHomeMode ? 'accent-teal-500' : 'accent-blue-500'}
        />

        <Slider
          label={priceLabel}
          min={minPrice}
          max={maxPrice}
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
          displayValue={`$${price} (~${Math.round(price * USD_TO_EGP_RATE)} EGP)`}
          colorClass={priceColor}
        />

        <div>
          <label className="text-lg font-bold text-gray-700 block mb-2">{t('comment_title')}</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={commentPlaceholder}
            rows={3}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition"
          ></textarea>
        </div>

        <div className="p-4 bg-yellow-50 border-l-4 border-yellow-400 text-yellow-800 rounded-lg">
          <h4 className="font-bold">{t('anti_cheat_title')}</h4>
          <p className="text-sm">{t('anti_cheat_desc')}</p>
        </div>
        
        <button
          type="submit"
          className="w-full text-white font-bold text-xl py-4 rounded-full transition-transform duration-200 ease-in-out transform hover:scale-105 shadow-lg bg-gradient-to-r from-green-400 to-teal-500 hover:from-green-500 hover:to-teal-600"
        >
          {t('submit_order')}
        </button>
      </form>
    </div>
  );
};

export default OrderForm;
