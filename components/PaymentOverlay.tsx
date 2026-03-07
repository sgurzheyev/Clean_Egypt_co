import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface PaymentOverlayProps {
  onClose: () => void;
  onSuccess?: () => void;
  lat: number;
  lng: number;
  amount: number;
  type: 'home' | 'city';
}

const PaymentOverlay: React.FC<PaymentOverlayProps> = ({ onClose, onSuccess, lat, lng, amount, type }) => {
  const [token, setToken] = useState<string | null>(null);
  const [isIframeLoaded, setIsIframeLoaded] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // 1. СЛУШАЕМ ОТВЕТ ОТ PAYMOB (SUCCESS / DECLINE)
    const handlePaymobMsg = (event: MessageEvent) => {
      if (event.data && typeof event.data === 'string') {
        // Успех: Активируем пирамиду и в профиль
        if (event.data.includes('success=true') || event.data.includes('TRANSACTION_SUCCESS')) {
          if (onSuccess) onSuccess();
          navigate('/profile');
        }
        // Отказ: сбрасываем UI карты и включаем экран ошибки
        if (event.data.includes('success=false') || event.data.includes('TRANSACTION_FAILED')) {
          onClose();
          setFetchError(true);
        }
      }
    };

    window.addEventListener('message', handlePaymobMsg);

    // 2. ЗАПРОС ТОКЕНА У ТВОЕГО API
    fetch('/api/paymob-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng, amount, type })
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
      onClose();
      setFetchError(true);
    });

    return () => window.removeEventListener('message', handlePaymobMsg);
  }, [lat, lng, amount, type, navigate, onSuccess, onClose]);

  // 3. АВТО-РЕДИРЕКТ НА TRY-FREE ПРИ ЛЮБОЙ ОШИБКЕ
  useEffect(() => {
    if (fetchError) {
      const timer = setTimeout(() => {
        // Уводим в лапы к парсеру имейлов
        navigate('/try-free');
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [fetchError, navigate]);

  const depositEgp = amount * 25;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
      <div className="relative z-[9999] w-full max-w-lg p-1 bg-gradient-to-b from-cyan-500/20 to-transparent rounded-[2rem]">
        <div className="relative w-full bg-zinc-950 p-6 rounded-[1.9rem] border border-white/5 shadow-2xl overflow-hidden">
          
          <div className="text-center mb-4">
            <h2 className="text-white text-2xl font-black tracking-tighter uppercase italic">
              Clean<span className="text-cyan-400">Egypt</span>
            </h2>
            <p className="text-zinc-500 text-[10px] mt-1 uppercase tracking-widest font-bold">Активация неоновой пирамиды</p>
          </div>

          <div className="mb-4 flex items-center justify-center gap-4 py-3 px-4 rounded-xl bg-slate-800/80 border border-cyan-500/30">
            <div className="text-center">
              <p className="text-[10px] text-cyan-400 uppercase tracking-widest font-bold">Mission Price</p>
              <p className="text-xl font-black text-white">${amount}</p>
            </div>
            <div className="w-px h-8 bg-white/20" />
            <div className="text-center">
              <p className="text-[10px] text-amber-400 uppercase tracking-widest font-bold">Worker Deposit</p>
              <p className="text-xl font-black text-white">{depositEgp} EGP</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl overflow-hidden shadow-inner min-h-[550px] relative">
            {/* СПИННЕР ЗАГРУЗКИ */}
            {(!isIframeLoaded && !fetchError) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 z-10">
                <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin mb-4"></div>
                <p className="text-cyan-500 text-[10px] font-bold animate-pulse uppercase tracking-widest">Установка защищенного соединения...</p>
              </div>
            )}

            {/* ЭКРАН ОШИБКИ */}
            {fetchError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 z-20 p-6 text-center animate-in fade-in zoom-in duration-300">
                <p className="text-red-500 font-black text-xl mb-2 uppercase tracking-tighter">Ошибка сервера платежей</p>
                <p className="text-zinc-500 text-[10px] uppercase font-bold">Переход к бесплатной проверке через пару секунд...</p>
              </div>
            )}

            {/* IFRAME PAYMOB */}
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
