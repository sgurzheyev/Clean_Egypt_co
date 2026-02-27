import React, { useState } from 'react';
import { generatePaymobLink } from '../lib/paymob';

// ... ваши пропсы (language, selectedLocation, onClose) ...

const OrderForm: React.FC<OrderFormProps> = ({ language, selectedLocation, onClose }) => {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // ДОБАВЛЯЕМ STATE ДЛЯ УПРАВЛЕНИЯ ЭКРАНАМИ
  const [step, setStep] = useState<'form' | 'payment'>('form');
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLocation || !email) return; // (добавьте ваши алерты, как мы обсуждали)

    setIsSubmitting(true);

    try {
      // 1. Генерируем ссылку PayMob (запускаем вашу функцию из lib/paymob.ts)
      // Передаем сумму (например, $0.99) и email юзера
      const url = await generatePaymobLink(0.99, email);
      
      if (url) {
        setPaymentUrl(url);
        // 2. ПЕРЕКЛЮЧАЕМ UI НА ЭКРАН ОПЛАТЫ
        setStep('payment');
      } else {
        alert("Ошибка подключения к PayMob");
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    // Это ваш главный контейнер окна (как на скриншоте)
    <div className="bg-[#111] p-6 rounded-3xl border border-[#39FF14]/20 shadow-2xl relative w-full max-w-sm">
      
      {/* ВАША КНОПКА ЗАКРЫТИЯ С КРЕСТИКОМ [ X ] */}
      <button
        onClick={onClose}
        className="absolute -top-4 -left-4 w-12 h-12 bg-[#39FF14] text-black font-black text-xl rounded-xl shadow-[0_0_15px_#39FF14] hover:scale-105 active:scale-95 transition-all flex items-center justify-center z-50"
      >
        X
      </button>

      {/* РЕНДЕРИМ ЛИБО ФОРМУ, ЛИБО ОПЛАТУ */}
      {step === 'form' ? (
        
        // --- ЭКРАН 1: ФОРМА СОЗДАНИЯ МИССИИ ---
        <div className="mt-4">
           <h2 className="text-2xl font-black italic uppercase text-[#39FF14] mb-6">Create Mission</h2>
           <form onSubmit={handleSubmit} className="space-y-6">
              {/* ... здесь ваши инпуты Email и Target Location из предыдущего шага ... */}
              <button type="submit" className="...">
                 {isSubmitting ? 'Loading...' : 'ACTIVATE PYRAMID ($0.99) 🚀'}
              </button>
           </form>
        </div>

      ) : (

        // --- ЭКРАН 2: PAYMOB IFRAME ---
        <div className="mt-4 flex flex-col h-[400px]">
           <h2 className="text-xl font-black italic uppercase text-white mb-4">
             Secure <span className="text-[#39FF14]">Checkout</span>
           </h2>
           
           {/* Контейнер для iframe */}
           <div className="flex-grow bg-white rounded-xl overflow-hidden border border-white/20">
              {paymentUrl ? (
                <iframe
                  src={paymentUrl}
                  className="w-full h-full border-0"
                  title="PayMob Payment"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-white">Loading...</div>
              )}
           </div>

           <button
             onClick={() => setStep('form')} // Кнопка "Назад"
             className="mt-4 text-[10px] text-white/50 uppercase tracking-widest hover:text-white transition-colors"
           >
             ← Back to details
           </button>
        </div>

      )}
    </div>
  );
};

export default OrderForm;
