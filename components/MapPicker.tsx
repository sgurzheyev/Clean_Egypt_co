import React, { useState, useCallback } from 'react';
import Map, { Marker, NavigationControl, GeolocateControl } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import PyramidMarker from './PyramidMarker'; // Наш компонент со стилями

// Токен Mapbox
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

interface MapPickerProps {
  onLocationSelect: (lat: number, lng: number) => void;
  orders: any[]; // Существующие заказы из Supabase
  currentAmount: number; // Выбранная сумма в слайдере ($5 - $500)
  currentType: 'home' | 'city'; // Тип активации
}

const MapPicker: React.FC<MapPickerProps> = ({
  onLocationSelect,
  orders,
  currentAmount,
  currentType
}) => {
  // Начальные координаты — Хургада (Old Town)
  const [viewport, setViewport] = useState({
    latitude: 27.2579,
    longitude: 33.8116,
    zoom: 13
  });

  const [selectedPoint, setSelectedPoint] = useState<{lat: number, lng: number} | null>(null);

  const handleMapClick = useCallback((event: any) => {
    const { lng, lat } = event.lngLat;
    setSelectedPoint({ lat, lng });
    onLocationSelect(lat, lng);
    console.log(`Target set: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
  }, [onLocationSelect]);

  return (
    <div className="w-full h-screen relative bg-zinc-950">
      <Map
        {...viewport}
        onMove={evt => setViewport(evt.viewState)}
        onClick={handleMapClick}
        mapStyle="mapbox://styles/mapbox/dark-v11" // Темная футуристичная карта
        mapboxAccessToken={MAPBOX_TOKEN}
        className="w-full h-full"
        // ФИКС: Поднимаем элементы управления картой на 160px вверх,
        // чтобы они не перекрывались нижней панелью
        padding={{ bottom: 160, top: 0, left: 0, right: 0 }}
      >
        {/* Авто-определение GPS. Теперь кнопка будет выше текста */}
        <GeolocateControl
          position="bottom-right"
          trackUserLocation
          showUserHeading
        />
        <NavigationControl position="bottom-right" />

        {/* 1. ОТРИСОВКА СУЩЕСТВУЮЩИХ ПИРАМИД (из Supabase) */}
        {orders.map((order) => (
          <Marker
            key={order.id}
            latitude={order.lat}
            longitude={order.lng}
            anchor="bottom"
          >
            <PyramidMarker
              amount={order.amount}
              orderType={order.order_type}
              label={order.task_description}
            />
          </Marker>
        ))}

        {/* 2. ПРЕВЬЮ НОВОЙ ПИРАМИДЫ ПЕРЕД АКТИВАЦИЕЙ */}
        {selectedPoint && (
          <Marker
            latitude={selectedPoint.lat}
            longitude={selectedPoint.lng}
            anchor="bottom"
          >
            <div className="animate-bounce">
              <PyramidMarker
                amount={currentAmount}
                orderType={currentType}
              />
              {/* Хвостик пина для точности */}
              <div className="w-1 h-4 bg-cyan-400 mx-auto blur-[1px]"></div>
            </div>
          </Marker>
        )}
      </Map>

      {/* Индикатор выбранной цели */}
      {selectedPoint && (
        <div className="absolute bottom-40 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 z-20 shadow-[0_0_20px_rgba(34,211,238,0.2)]">
          <p className="text-[10px] text-cyan-400 font-bold uppercase tracking-[0.2em]">
            TARGET: {selectedPoint.lat.toFixed(4)}, {selectedPoint.lng.toFixed(4)}
          </p>
        </div>
      )}
    </div>
  );
};

export default MapPicker;
