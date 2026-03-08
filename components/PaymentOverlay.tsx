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
  const [fetchError, setFetchError] = useState(false);
  const [pyramidId, setPyramidId] = useState<string | null>(null);
  const navigate = useNavigate();

  const isLoading = !token && !fetchError;

  useEffect(() => {
    const handlePaymobMsg = (event: MessageEvent) => {
      if (event.data && typeof event.data === 'string') {
        if (event.data.includes('success=true') || event.data.includes('TRANSACTION_SUCCESS')) {
          if (onSuccess) onSuccess();
          requestAnimationFrame(() => navigate('/profile'));
        }
        if (event.data.includes('success=false') || event.data.includes('TRANSACTION_FAILED')) {
          onClose(pyramidId ?? undefined);
          setFetchError(true);
        }
      }
    };

    window.addEventListener('message', handlePaymobMsg);

    fetch('/api/paymob-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng, amount, type }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('API unreachable');
        return res.json();
      })
      .then((data) => {
        if (data.paymentToken) {
          setToken(data.paymentToken);
          if (data.missionId) setPyramidId(data.missionId);
        } else {
          throw new Error('Token missing');
        }
      })
      .catch((err) => {
        console.error('Paymob Error:', err);
        onClose();
        setFetchError(true);
      });

    return () => window.removeEventListener('message', handlePaymobMsg);
  }, [lat, lng, amount, type, navigate, onSuccess, onClose, pyramidId]);

  useEffect(() => {
    if (fetchError) {
      const timer = setTimeout(() => navigate('/try-free'), 2500);
      return () => clearTimeout(timer);
    }
  }, [fetchError, navigate]);

  const depositEgp = amount * 25;
  const paymobUrl = token
    ? `https://accept.paymob.com/api/acceptance/iframes/1007120?payment_token=${token}`
    : '';

  const overlayContent = (
    <>
      {/* Backdrop: кликабельный, закрывает по клику */}
      <div
        className="fixed inset-0 bg-black/80 z-[99998] pointer-events-auto"
        onClick={() => onClose(pyramidId ?? undefined)}
        aria-hidden
      />

      {/* Контейнер центрирования: pointer-events-none, клики проходят к карточке */}
      <div className="fixed inset-0 flex items-center justify-center z-[99999] pointer-events-none p-4">
        {/* Карточка: pointer-events-auto — единственный блок, который получает клики */}
        <div
          className="relative bg-white w-full max-w-md rounded-2xl shadow-2xl pointer-events-auto flex flex-col overflow-hidden allow-touch-and-select"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header с кнопкой закрытия */}
          <div className="flex items-center justify-between px-6 py-4 bg-zinc-950 border-b border-white/10">
            <div>
              <h2 className="text-white text-xl font-black tracking-tighter uppercase italic">
                Clean<span className="text-cyan-400">Egypt</span>
              </h2>
              <p className="text-zinc-500 text-[10px] mt-0.5 uppercase tracking-widest font-bold">Активация неоновой пирамиды</p>
            </div>
            <button
              type="button"
              onClick={() => onClose(pyramidId ?? undefined)}
              className="px-4 py-2 rounded-xl bg-red-500 hover:bg-red-400 text-white font-black text-xs uppercase tracking-wider shadow-lg"
            >
              ❌ ЗАКРЫТЬ И СБРОСИТЬ
            </button>
          </div>

          {/* Mission info */}
          <div className="flex items-center justify-center gap-4 py-3 px-4 bg-zinc-900 border-b border-white/5">
            <div className="text-center">
              <p className="text-[10px] text-cyan-400 uppercase tracking-widest font-bold">Mission</p>
              <p className="text-lg font-black text-white">${amount}</p>
            </div>
            <div className="w-px h-6 bg-white/20" />
            <div className="text-center">
              <p className="text-[10px] text-amber-400 uppercase tracking-widest font-bold">Deposit</p>
              <p className="text-lg font-black text-white">{depositEgp} EGP</p>
            </div>
          </div>

          {/* Контент: лоадер ИЛИ ошибка ИЛИ iframe — только один в DOM */}
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-24 bg-white">
              <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin mb-4" />
              <p className="text-cyan-600 text-xs font-bold uppercase tracking-widest">Установка защищенного соединения...</p>
            </div>
          ) : fetchError ? (
            <div className="flex flex-col items-center justify-center py-24 px-6 bg-white text-center">
              <p className="text-red-500 font-black text-lg mb-2 uppercase tracking-tighter">Ошибка сервера платежей</p>
              <p className="text-zinc-500 text-xs uppercase font-bold">Переход к бесплатной проверке через пару секунд...</p>
            </div>
          ) : !paymobUrl ? (
            <div className="flex flex-col items-center justify-center py-24 px-6 bg-white text-center">
              <p className="text-red-500 font-black text-sm mb-2 uppercase tracking-tighter">ОШИБКА: Ссылка на оплату не получена</p>
              <p className="text-zinc-600 text-xs font-bold">Попробуйте закрыть и создать снова.</p>
            </div>
          ) : (
            <iframe
              title="Paymob payment"
              src={paymobUrl}
              className="w-full h-[600px] sm:h-[650px] border-0 bg-white allow-touch-and-select"
              style={{ pointerEvents: 'auto' }}
            />
          )}

          <button
            type="button"
            onClick={() => onClose(pyramidId ?? undefined)}
            className="w-full py-3 text-zinc-500 hover:text-zinc-800 text-[11px] uppercase tracking-widest font-bold border-t border-zinc-200"
          >
            [ ОТМЕНА ]
          </button>
        </div>
      </div>
    </>
  );

  return typeof document !== 'undefined' ? createPortal(overlayContent, document.body) : overlayContent;
};

export default PaymentOverlay;
