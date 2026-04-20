import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { formatEgp } from '../src/lib/formatMoney';
import { floorEgp } from '../src/lib/integerEgpInput';

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

    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const currentUserId = session?.user?.id;
        const accessToken = session?.access_token;
        if (!currentUserId) {
          setFetchError(true);
          return;
        }
        if (!accessToken) {
          setFetchError(true);
          return;
        }

        let res = await fetch('/api/paymob-intent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            type: 'mission_creation',
            category: type === 'city' ? 'public' : 'home',
            amount_target: floorEgp(amount),
            location_lat: lat,
            location_lng: lng,
          }),
        });

        if (res.status === 401) {
          const { data } = await supabase.auth.refreshSession();
          const nextToken = data.session?.access_token;
          if (nextToken) {
            res = await fetch('/api/paymob-intent', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${nextToken}`,
              },
              body: JSON.stringify({
                type: 'mission_creation',
                category: type === 'city' ? 'public' : 'home',
                amount_target: floorEgp(amount),
                location_lat: lat,
                location_lng: lng,
              }),
            });
          }
        }

        if (!res.ok) throw new Error(res.status === 401 ? 'Unauthorized' : 'API unreachable');
        const data = await res.json();

        if (data.paymentToken) {
          setToken(data.paymentToken);
          if (data.missionId) setPyramidId(data.missionId);
        } else {
          throw new Error('Token missing');
        }
      } catch (err) {
        console.error('Paymob Error:', err);
        onClose();
        setFetchError(true);
      }
    })();

    return () => window.removeEventListener('message', handlePaymobMsg);
  }, [lat, lng, amount, type, navigate, onSuccess, onClose, pyramidId]);

  useEffect(() => {
    if (fetchError) {
      const timer = setTimeout(() => navigate('/try-free'), 2500);
      return () => clearTimeout(timer);
    }
  }, [fetchError, navigate]);

  const paymobUrl = useMemo(
    () => (token ? `https://accept.paymob.com/api/acceptance/iframes/1007120?payment_token=${token}` : ''),
    [token]
  );

  const stopProp = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className="fixed top-0 right-0 bottom-0 left-0 z-[5000] flex items-center justify-center p-4 overscroll-contain"
      onTouchStart={stopProp}
      onTouchMove={stopProp}
      onTouchEnd={stopProp}
      onMouseDown={stopProp}
      onWheel={stopProp}
    >
      <div
        className="absolute top-0 right-0 bottom-0 left-0 bg-black/70"
        onClick={() => onClose(pyramidId ?? undefined)}
      />
      <div
        className="relative w-full max-w-md bg-white rounded-2xl shadow-xl flex flex-col overflow-hidden"
        style={{ maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
          {/* ШАПКА: кнопка закрытия слева сверху */}
          <div className="flex-none relative flex justify-between items-center p-3 border-b border-gray-200 bg-zinc-950">
            <button
              type="button"
              onClick={() => onClose(pyramidId ?? undefined)}
              className="absolute top-3 left-3 px-4 py-2 rounded-xl bg-red-500 hover:bg-red-400 text-white font-black text-xs uppercase tracking-wider shadow-lg z-10"
            >
              ❌ ЗАКРЫТЬ И СБРОСИТЬ
            </button>
            <div className="flex-1 text-center pr-24">
              <h2 className="text-white text-lg font-black tracking-tighter uppercase italic">
                Clean<span className="text-cyan-400">Egypt</span>
              </h2>
              <p className="text-zinc-500 text-[10px] uppercase tracking-widest font-bold">
                {formatEgp(floorEgp(amount))}
              </p>
            </div>
          </div>

          {/* Контент: лоадер ИЛИ ошибка ИЛИ обёртка iframe */}
          {isLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center py-24 bg-white">
              <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin mb-4" />
              <p className="text-cyan-600 text-xs font-bold uppercase tracking-widest">Установка защищенного соединения...</p>
            </div>
          ) : fetchError ? (
            <div className="flex-1 flex flex-col items-center justify-center py-24 px-6 bg-white text-center">
              <p className="text-red-500 font-black text-lg mb-2 uppercase tracking-tighter">Ошибка сервера платежей</p>
              <p className="text-zinc-500 text-xs uppercase font-bold">Переход к бесплатной проверке через пару секунд...</p>
            </div>
          ) : !paymobUrl ? (
            <div className="flex-1 flex flex-col items-center justify-center py-24 px-6 bg-white text-center">
              <p className="text-red-500 font-black text-sm mb-2 uppercase tracking-tighter">ОШИБКА: Ссылка на оплату не получена</p>
              <p className="text-zinc-600 text-xs font-bold">Попробуйте закрыть и создать снова.</p>
            </div>
          ) : (
            <div className="p-8 flex flex-col items-center justify-center text-center">
              <div className="text-6xl mb-4">🔒</div>
              <h3 className="text-2xl font-bold text-gray-800 mb-2">Безопасная оплата</h3>
              <p className="text-gray-500 mb-8">Вы будете перенаправлены на защищенный шлюз Paymob для ввода данных карты.</p>
              <a
                href={paymobUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-6 rounded-xl text-lg transition-colors"
              >
                💳 ПЕРЕЙТИ К ОПЛАТЕ
              </a>
            </div>
          )}

          <button
            type="button"
            onClick={() => onClose(pyramidId ?? undefined)}
            className="flex-none w-full py-3 text-zinc-500 hover:text-zinc-800 text-[11px] uppercase tracking-widest font-bold border-t border-zinc-200"
          >
            [ ОТМЕНА ]
          </button>
        </div>
    </div>
  );
};

export default PaymentOverlay;
