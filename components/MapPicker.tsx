import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Map, { Marker, NavigationControl, GeolocateControl } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import PyramidMarker from './PyramidMarker';
import { supabase } from '../lib/supabaseClient';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

/** Парсит location из Supabase (PostGIS point: GeoJSON или WKT) в { lat, lng }. */
function parseLocation(location: unknown): { lat: number; lng: number } | null {
  if (!location) return null;
  if (typeof location === 'object' && 'coordinates' in (location as any)) {
    const coords = (location as { coordinates: [number, number] }).coordinates;
    if (Array.isArray(coords) && coords.length >= 2) return { lng: coords[0], lat: coords[1] };
  }
  if (typeof location === 'string') {
    const m = location.match(/POINT\s*\(\s*([\d.-]+)\s+([\d.-]+)\s*\)/i);
    if (m) return { lng: parseFloat(m[1]), lat: parseFloat(m[2]) };
  }
  return null;
}

export interface PyramidOnMap {
  id: string;
  lat: number;
  lng: number;
  target_amount: number;
  mission_type: 'home' | 'city' | string;
  status: string;
  label?: string;
}

export interface MapPickerProps {
  onLocationSelect: (lat: number, lng: number) => void;
  /** Выбранная точка с карты (контролируется из App). При null маркер и подпись TARGET скрыты. */
  selectedCoords?: { lat: number; lng: number } | null;
  orders: any[];
  currentAmount: number;
  currentType: 'home' | 'city';
  hasFullAccess?: boolean;
}

const MapPicker: React.FC<MapPickerProps> = ({
  onLocationSelect,
  selectedCoords = null,
  orders,
  currentAmount,
  currentType,
  hasFullAccess = false,
}) => {
  const navigate = useNavigate();
  const [viewState, setViewState] = useState({
    latitude: 27.2579,
    longitude: 33.8116,
    zoom: 13,
  });

  const [demoPyramids, setDemoPyramids] = useState<any[]>([]);
  const [pyramidsFromDb, setPyramidsFromDb] = useState<PyramidOnMap[]>([]);
  const [paywallPopup, setPaywallPopup] = useState<PyramidOnMap | null>(null);

  // Загрузка миссий (пирамид) из Supabase при монтировании и при возврате на карту
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('pyramids')
        .select('id, location, target_amount, mission_type, status')
        .neq('status', 'completed')
        .limit(200);

      console.log('Supabase Data:', data, 'Error:', error);

      if (cancelled || error) {
        if (error) console.error('MapPicker fetch pyramids:', error);
        return;
      }

      const list: PyramidOnMap[] = [];
      for (const row of data || []) {
        const coords = parseLocation(row.location);
        if (!coords) continue;
        list.push({
          id: row.id,
          lat: coords.lat,
          lng: coords.lng,
          target_amount: row.target_amount ?? 0,
          mission_type: row.mission_type ?? 'city',
          status: row.status ?? '',
          label: undefined,
        });
      }
      const parsedData = list;
      console.log('Parsed Pyramids:', parsedData);
      setPyramidsFromDb(list);
    })();
    return () => { cancelled = true; };
  }, []);

  // Демо-пирамиды для try-free
  useEffect(() => {
    const isDemo = new URLSearchParams(window.location.search).get('view') === 'demo_active';
    if (isDemo) {
      const names = ['Ahmed', 'Moustafa', 'Elena', 'Sergio', 'Habibi', 'Eco_Warrior', 'Cleaner_Pro'];
      const bounds = { lat: [27.2, 27.3], lng: [33.8, 33.9] };
      const fakeData = Array.from({ length: 45 }).map((_, i) => ({
        id: `fake-${i}`,
        lat: Math.random() * (bounds.lat[1] - bounds.lat[0]) + bounds.lat[0],
        lng: Math.random() * (bounds.lng[1] - bounds.lng[0]) + bounds.lng[0],
        amount: [1, 5, 10, 50, 100][Math.floor(Math.random() * 5)],
        type: Math.random() > 0.5 ? 'home' : 'city',
        label: names[Math.floor(Math.random() * names.length)],
      }));
      setDemoPyramids(fakeData);
    }
  }, []);

  const handleMapClick = useCallback(
    (event: any) => {
      if (!event.lngLat) return;
      const { lng, lat } = event.lngLat;
      onLocationSelect(lat, lng);
    },
    [onLocationSelect]
  );

  const handlePyramidClick = useCallback(
    (e: React.MouseEvent, pyramid: PyramidOnMap) => {
      e.stopPropagation();
      if (hasFullAccess) {
        // Полный доступ: можно перейти в профиль/маркетплейс к этой миссии
        navigate('/profile');
        return;
      }
      setPaywallPopup(pyramid);
    },
    [hasFullAccess, navigate]
  );

  return (
    <div className="w-full h-screen relative bg-zinc-950">
      <Map
        {...viewState}
        onMove={(evt) => setViewState(evt.viewState)}
        onClick={handleMapClick}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        mapboxAccessToken={MAPBOX_TOKEN}
        style={{ width: '100%', height: '100%' }}
        padding={{ bottom: 0, top: 0, left: 0, right: 0 }}
      >
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-2 opacity-60 hover:opacity-100 transition-opacity z-10 scale-110">
          <GeolocateControl
            positionOptions={{ enableHighAccuracy: true }}
            trackUserLocation
            style={{ position: 'relative' }}
          />
          <NavigationControl showCompass={false} style={{ position: 'relative' }} />
        </div>

        {/* Пирамиды из Supabase (миссии/заказы) */}
        {pyramidsFromDb.map((p) => (
          <Marker key={p.id} latitude={p.lat} longitude={p.lng} anchor="bottom">
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => handlePyramidClick(e, p)}
              onKeyDown={(e) => e.key === 'Enter' && handlePyramidClick(e as any, p)}
              className="cursor-pointer outline-none"
            >
              <PyramidMarker
                amount={p.target_amount}
                orderType={p.mission_type as 'home' | 'city'}
                label={p.label}
              />
            </div>
          </Marker>
        ))}

        {/* Legacy orders из App (таблица orders) */}
        {orders?.map((order) => (
          <Marker key={order.id} latitude={order.lat || 0} longitude={order.lng || 0} anchor="bottom">
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              className="cursor-pointer outline-none"
            >
              <PyramidMarker
                amount={order.amount}
                orderType={order.order_type}
                label={order.task_description}
              />
            </div>
          </Marker>
        ))}

        {demoPyramids.map((p) => (
          <Marker key={p.id} latitude={p.lat} longitude={p.lng} anchor="bottom">
            <div className="animate-pulse opacity-70 cursor-pointer" onClick={(e) => e.stopPropagation()}>
              <PyramidMarker amount={p.amount} orderType={p.type} label={p.label} />
            </div>
          </Marker>
        ))}

        {selectedCoords && (
          <Marker latitude={selectedCoords.lat} longitude={selectedCoords.lng} anchor="bottom">
            <div className="animate-bounce">
              <PyramidMarker amount={currentAmount} orderType={currentType} />
              <div className="w-1 h-4 bg-cyan-400 mx-auto blur-[0.5px]" />
            </div>
          </Marker>
        )}
      </Map>

      {selectedCoords && (
        <div className="absolute bottom-36 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-xl px-6 py-3 rounded-2xl border border-cyan-500/30 z-20 shadow-[0_0_30px_rgba(6,182,212,0.3)]">
          <p className="text-[10px] text-cyan-400 font-black uppercase tracking-[0.3em]">
            TARGET: {selectedCoords.lat.toFixed(4)} / {selectedCoords.lng.toFixed(4)}
          </p>
        </div>
      )}

      {/* Попап «Оплатите доступ» для пользователей без полного доступа */}
      {paywallPopup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setPaywallPopup(null)}
        >
          <div
            className="w-full max-w-sm bg-slate-800/95 backdrop-blur-md rounded-3xl border border-white/10 shadow-2xl p-6 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-lg font-black mb-2">Оплатите доступ</p>
            <p className="text-slate-400 text-sm mb-6">
              Чтобы увидеть детали заказа и взять эту миссию, оформите полный доступ к платформе.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setPaywallPopup(null)}
                className="flex-1 py-3 rounded-xl border border-white/20 text-slate-400 hover:text-white font-bold text-sm transition-colors"
              >
                Закрыть
              </button>
              <button
                type="button"
                onClick={() => {
                  setPaywallPopup(null);
                  navigate('/');
                }}
                className="flex-1 py-3 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-900 font-black text-sm transition-colors"
              >
                Перейти к оплате
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MapPicker;
