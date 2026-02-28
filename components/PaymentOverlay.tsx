import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface PaymentOverlayProps {
  onClose: () => void;
  onSuccess?: () => void;
  lat: number;
  lng: number;
}

const PaymentOverlay: React.FC<PaymentOverlayProps> = ({ onClose, onSuccess, lat, lng }) => {
  const [token, setToken] = useState<string | null>(null);
  const [isIframeLoaded, setIsIframeLoaded] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const handlePaymobMsg = (event: MessageEvent) => {
      // 1. Слушаем сигналы от Paymob
      if (event.data && typeof event.data === 'string') {
        if (event.data.includes('success=true') || event.data.includes('TRANSACTION_SUCCESS')) {
          console.log("Wallet Cleaned! Pyramid Activated 📐");
          if (onSuccess) onSuccess();
          navigate('/profile');
        }
        // ЕСЛИ ПЛАТЕЖ ОТКЛОНЕН (DECLINE)
        if (event.data.includes('success=false') || event.data.includes('TRANSACTION_FAILED')) {
          setFetchError(true); // Показываем экран ошибки из твоего скрина
        }
      }
    };

    window.addEventListener('message', handlePaymobMsg);

    // 2. ЗАПРОС ТОКЕНА
    fetch('/api/paymob-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng })
    })
    .then(res => {
      if (!res.ok) throw new Error('API unreachable');
      return res.json();
    })
    .then(data => {
      if (data.paymentToken) {
        setToken(data.paymentToken);
      } else {
        throw new Error('Token missing');
      }
    })
    .catch(err => {
      console.error("Paymob Error:", err);
      setFetchError(true);
    });

    return () => window.removeEventListener('message', handlePaymobMsg);
  }, [lat, lng, navigate, onSuccess]);

  // ЭФФЕКТ ДЛЯ РЕДИРЕКТА НА TRY-FREE ПРИ ОШИБКЕ
  useEffect(() => {
    if (fetchError) {
      const timer = setTimeout(() => {
        // Вместо onClose() уводим на страницу сбора Email
        navigate('/try-free');
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [fetchError, navigate]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
      <div className="relative w-full max-w-lg p-1 bg-gradient-to-b from-cyan-500/20 to-transparent rounded-[2rem]">
        <div className="relative w-full bg-zinc-950 p-6 rounded-[1.9rem] border border-white/5 shadow-2xl overflow-hidden">
          
          <div className="text-center mb-6">
            <h2 className="text-white text-2xl font-black tracking-tighter uppercase italic">
              Clean<span className="text-cyan-400">Egypt</span>
            </h2>
            <p className="text-zinc-500 text-[10px] mt-1 uppercase tracking-widest">Активация неоновой пирамиды</p>
          </div>

          <div className="bg-white rounded-2xl overflow-hidden shadow-inner min-h-[550px] relative">
            {(!isIframeLoaded && !fetchError) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 z-10">
                <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin mb-4"></div>
                <p className="text-cyan-500 text-[10px] font-bold animate-pulse uppercase">Установка защищенного соединения...</p>
              </div>
            )}

            {/* ЭКРАН ОШИБКИ ИЗ ТВОЕГО СКРИНШОТА */}
            {fetchError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 z-20 p-6 text-center animate-in fade-in duration-500">
                <p className="text-red-500 font-black text-xl mb-2 uppercase tracking-tighter">Ошибка сервера платежей</p>
                <p className="text-zinc-500 text-[10px] uppercase">Переход к бесплатной проверке через пару секунд...</p>
              </div>
            )}

            {token && !fetchError && (
              <iframe
                src={`https://accept.paymob.com/api/acceptance/iframes/1007120?payment_token=${token}`}
                width="100%"
                height="550px"
                frameBorder="0"
                onLoad={() => setIsIframeLoaded(true)}
              />
            )}
          </div>

          <button
            onClick={onClose}
            className="w-full mt-6 text-zinc-600 hover:text-white text-[11px] uppercase tracking-widest transition-colors font-bold"
          >
            [ ОТМЕНА ]
          </button>
        </div>
      </div>
    </div>
  );
};

export default PaymentOverlay;
