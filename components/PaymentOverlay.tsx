import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';

interface PaymentOverlayProps {
  onClose: (pyramidId?: string) => void;
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
  const [pyramidId, setPyramidId] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    // 1. СЛУШАЕМ ОТВЕТ ОТ PAYMOB (SUCCESS / DECLINE)
    const handlePaymobMsg = (event: MessageEvent) => {
      if (event.data && typeof event.data === 'string') {
        // Успех: сначала принудительно очищаем оверлей (setShowPayment(false), targetCoords), затем редирект
        if (event.data.includes('success=true') || event.data.includes('TRANSACTION_SUCCESS')) {
          if (onSuccess) onSuccess();
          requestAnimationFrame(() => navigate('/profile'));
        }
        // Отказ: сбрасываем UI карты и включаем экран ошибки
        if (event.data.includes('success=false') || event.data.includes('TRANSACTION_FAILED')) {
          onClose(pyramidId ?? undefined);
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
        if (data.missionId) setPyramidId(data.missionId);
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
  }, [lat, lng, amount, type, navigate, onSuccess, onClose, pyramidId]);

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

  const overlayContent = (
    /* Внешний фон: pointer-events-none чтобы клики проходили к центру; только центр получает клики */
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 pointer-events-none">
      {/* Аварийный выход: pointer-events-auto чтобы кнопка была кликабельна */}
      <button
        type="button"
        onClick={() => onClose(pyramidId ?? undefined)}
        className="fixed top-4 right-4 z-[100001] px-4 py-2 rounded-xl bg-red-500 hover:bg-red-400 text-white font-black text-sm uppercase tracking-wider shadow-lg pointer-events-auto"
      >
        ❌ ЗАКРЫТЬ И СБРОСИТЬ
      </button>
      {/* Контент: pointer-events-auto — клики проходят к iframe */}
      <div className="relative z-[100000] w-full max-w-lg p-1 bg-gradient-to-b from-cyan-500/20 to-transparent rounded-[2rem] pointer-events-auto">
        <div className="relative w-full bg-zinc-950 p-6 rounded-[1.9rem] border border-white/5 shadow-2xl overflow-visible">
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
          {/* Белый контейнер iframe: pointer-events-auto; лоадер/ошибка — только когда нужны, не перекрывают iframe после загрузки */}
          <div className="bg-white rounded-2xl overflow-hidden shadow-inner min-h-[550px] relative pointer-events-auto">
            {(!isIframeLoaded && !fetchError) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 z-10 pointer-events-none" aria-hidden>
                <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin mb-4" />
                <p className="text-cyan-500 text-[10px] font-bold animate-pulse uppercase tracking-widest">Установка защищенного соединения...</p>
              </div>
            )}
            {fetchError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 z-20 p-6 text-center pointer-events-auto">
                <p className="text-red-500 font-black text-xl mb-2 uppercase tracking-tighter">Ошибка сервера платежей</p>
                <p className="text-zinc-500 text-[10px] uppercase font-bold">Переход к бесплатной проверке через пару секунд...</p>
              </div>
            )}
            {token && !fetchError && (
              <iframe
                title="Paymob payment"
                src={`https://accept.paymob.com/api/acceptance/iframes/1007120?payment_token=${token}`}
                width="100%"
                height="550px"
                frameBorder="0"
                onLoad={() => setIsIframeLoaded(true)}
                className="relative z-[100000] w-full h-[550px] pointer-events-auto"
              />
            )}
          </div>
          <button
            onClick={() => onClose(pyramidId ?? undefined)}
            className="w-full mt-6 text-zinc-600 hover:text-white text-[11px] uppercase tracking-widest transition-colors font-bold"
          >
            [ ОТМЕНА ]
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(overlayContent, document.body) : overlayContent;
};

export default PaymentOverlay;
