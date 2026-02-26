import React, { useEffect, useState } from 'react';
import Map, { Marker } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

interface MapPickerProps {
  onLocationSelect: (lat: number, lng: number) => void;
}

const MapPicker: React.FC<MapPickerProps> = ({ onLocationSelect }) => {
  const [viewState, setViewState] = useState({
    longitude: 33.82,
    latitude: 27.25,
    zoom: 13
  });

  // Автоматически находим пользователя при открытии формы
  useEffect(() => {
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude } = pos.coords;
      setViewState(prev => ({ ...prev, latitude, longitude }));
      onLocationSelect(latitude, longitude); // Сразу передаем координаты в форму
    });
  }, [onLocationSelect]);

  return (
    <div className="w-full h-48 rounded-2xl overflow-hidden border border-[#39FF14]/30 relative">
      <Map
        {...viewState}
        onMove={evt => setViewState(evt.viewState)}
        mapStyle="mapbox://styles/mapbox/navigation-night-v1"
        mapboxAccessToken={MAPBOX_TOKEN}
      >
        <Marker longitude={viewState.longitude} latitude={viewState.latitude} draggable onDragEnd={(evt) => {
          onLocationSelect(evt.lngLat.lat, evt.lngLat.lng);
        }}>
          <div className="w-4 h-4 bg-[#39FF14] rounded-full shadow-[0_0_15px_#39FF14] animate-ping" />
        </Marker>
      </Map>
      <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-[8px] text-[#39FF14] font-black uppercase">
        GPS locked
      </div>
    </div>
  );
};

export default MapPicker;
