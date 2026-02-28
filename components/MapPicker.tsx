import React, { useState, useCallback, useEffect } from 'react';
import Map, { Marker, NavigationControl, GeolocateControl } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import PyramidMarker from './PyramidMarker';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

interface MapPickerProps {
  onLocationSelect: (lat: number, lng: number) => void;
  orders: any[];
  currentAmount: number;
  currentType: 'home' | 'city';
}

const MapPicker: React.FC<MapPickerProps> = ({
  onLocationSelect,
  orders,
  currentAmount,
  currentType
}) => {
  const [viewState, setViewState] = useState({
    latitude: 27.2579,
    longitude: 33.8116,
    zoom: 13
  });

  const [selectedPoint, setSelectedPoint] = useState<{lat: number, lng: number} | null>(null);
  const [demoPyramids, setDemoPyramids] = useState<any[]>([]);

  // ЛОГИКА ГЕНЕРАЦИИ ТЫСЯЧИ ПИРАМИД ДЛЯ TRY-FREE
  useEffect(() => {
    const isDemo = new URLSearchParams(window.location.search).get('view') === 'demo_active';
    
    if (isDemo) {
      const names = ["Ahmed", "Moustafa", "Elena", "Sergio", "Habibi", "Eco_Warrior", "Cleaner_Pro"];
      // Координаты центра Хургады
      const bounds = { lat: [27.20, 27.30], lng: [33.80, 33.90] };
      
      const fakeData = Array.from({ length: 45 }).map((_, i) => ({
        id: `fake-${i}`,
        lat: Math.random() * (bounds.lat[1] - bounds.lat[0]) + bounds.lat[0],
        lng: Math.random() * (bounds.lng[1] - bounds.lng[0]) + bounds.lng[0],
        amount: [1, 5, 10, 50, 100][Math.floor(Math.random() * 5)],
        type: Math.random() > 0.5 ? 'home' : 'city',
        label: names[Math.floor(Math.random() * names.length)]
      }));
      setDemoPyramids(fakeData);
    }
  }, []);

  const handleMapClick = useCallback((event: any) => {
    if (!event.lngLat) return;
    const { lng, lat } = event.lngLat;
    setSelectedPoint({ lat, lng });
    onLocationSelect(lat, lng);
  }, [onLocationSelect]);

  return (
    <div className="w-full h-screen relative bg-zinc-950">
      <Map
        {...viewState}
        onMove={evt => setViewState(evt.viewState)}
        onClick={handleMapClick}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        mapboxAccessToken={MAPBOX_TOKEN}
        style={{ width: '100%', height: '100%' }}
        padding={{ bottom: 0, top: 0, left: 0, right: 0 }}
      >
        {/* Кнопки управления: теперь не мешают интерфейсу */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-2 opacity-60 hover:opacity-100 transition-opacity z-10 scale-110">
          <GeolocateControl
            positionOptions={{ enableHighAccuracy: true }}
            trackUserLocation
            style={{ position: 'relative' }}
          />
          <NavigationControl
            showCompass={false}
            style={{ position: 'relative' }}
          />
        </div>

        {/* РЕАЛЬНЫЕ ЗАКАЗЫ ИЗ БАЗЫ */}
        {orders?.map((order) => (
          <Marker key={order.id} latitude={order.lat || 0} longitude={order.lng || 0} anchor="bottom">
            <PyramidMarker amount={order.amount} orderType={order.order_type} label={order.task_description} />
          </Marker>
        ))}

        {/* ФЕЙКОВЫЕ ПУЛЬСИРУЮЩИЕ ПИРАМИДЫ ДЛЯ ВАУ-ЭФФЕКТА */}
        {demoPyramids.map((p) => (
          <Marker key={p.id} latitude={p.lat} longitude={p.lng} anchor="bottom">
            <div className="animate-pulse opacity-70">
              <PyramidMarker amount={p.amount} orderType={p.type} label={p.label} />
            </div>
          </Marker>
        ))}

        {selectedPoint && (
          <Marker latitude={selectedPoint.lat} longitude={selectedPoint.lng} anchor="bottom">
            <div className="animate-bounce">
              <PyramidMarker amount={currentAmount} orderType={currentType} />
              <div className="w-1 h-4 bg-cyan-400 mx-auto blur-[0.5px]"></div>
            </div>
          </Marker>
        )}
      </Map>

      {selectedPoint && (
        <div className="absolute bottom-36 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-xl px-6 py-3 rounded-2xl border border-cyan-500/30 z-20 shadow-[0_0_30px_rgba(6,182,212,0.3)] animate-in slide-in-from-bottom-4 duration-300">
          <p className="text-[10px] text-cyan-400 font-black uppercase tracking-[0.3em]">
            TARGET: {selectedPoint.lat.toFixed(4)} / {selectedPoint.lng.toFixed(4)}
          </p>
        </div>
      )}
    </div>
  );
};

export default MapPicker;
