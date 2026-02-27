import React, { useState, useCallback } from 'react';
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
        // Убираем padding снизу, так как мы перенесли кнопки в сторону
        padding={{ bottom: 0, top: 0, left: 0, right: 0 }}
      >
        {/* Кнопка геолокации: посередине справа, полупрозрачная */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-2 opacity-50 hover:opacity-100 transition-opacity z-10">
          <GeolocateControl
            positionOptions={{ enableHighAccuracy: true }}
            trackUserLocation
            showUserHeading
            style={{ position: 'relative', margin: 0 }}
          />
          <NavigationControl
            showCompass={false}
            style={{ position: 'relative', margin: 0 }}
          />
        </div>

        {orders && orders.map((order) => (
          <Marker
            key={order.id}
            latitude={order.lat || 0}
            longitude={order.lng || 0}
            anchor="bottom"
          >
            <PyramidMarker amount={order.amount} orderType={order.order_type} label={order.task_description} />
          </Marker>
        ))}

        {selectedPoint && (
          <Marker latitude={selectedPoint.lat} longitude={selectedPoint.lng} anchor="bottom">
            <div className="animate-bounce">
              <PyramidMarker amount={currentAmount} orderType={currentType} />
              <div className="w-1 h-4 bg-cyan-400 mx-auto blur-[1px]"></div>
            </div>
          </Marker>
        )}
      </Map>

      {/* Индикатор координат: чуть выше кнопки Clean My Wallet */}
      {selectedPoint && (
        <div className="absolute bottom-36 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 z-20 shadow-[0_0_20px_rgba(34,211,238,0.2)]">
          <p className="text-[10px] text-cyan-400 font-bold uppercase tracking-[0.2em]">
            TARGET: {selectedPoint.lat.toFixed(4)}, {selectedPoint.lng.toFixed(4)}
          </p>
        </div>
      )}
    </div>
  );
};

export default MapPicker;
