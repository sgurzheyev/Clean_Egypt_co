import React, { useState } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

// Создаем нашу кастомную неоновую метку
const neonIcon = L.divIcon({
  className: 'custom-neon-icon',
  html: `<div style="background-color: #39FF14; width: 20px; height: 20px; border-radius: 50%; box-shadow: 0 0 15px #39FF14, 0 0 30px #39FF14; border: 2px solid white;"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

interface MapPickerProps {
  onLocationSelect: (location: string) => void;
}

const LocationMarker: React.FC<{ onLocationSelect: (loc: string) => void }> = ({ onLocationSelect }) => {
  const [position, setPosition] = useState<L.LatLng | null>(null);

  useMapEvents({
    click(e) {
      setPosition(e.latlng);
      // Передаем координаты в формате "Широта, Долгота"
      onLocationSelect(`${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`);
    },
  });

  return position === null ? null : (
    <Marker position={position} icon={neonIcon}></Marker>
  );
};

const MapPicker: React.FC<MapPickerProps> = ({ onLocationSelect }) => {
  // Центр карты по умолчанию (Хургада)
  const defaultCenter: [number, number] = [27.2579, 33.8116];

  return (
    <div className="w-full h-64 rounded-2xl overflow-hidden border-2 border-white/10 relative z-0 mt-4 mb-4">
      <MapContainer
        center={defaultCenter}
        zoom={13}
        scrollWheelZoom={true}
        style={{ height: '100%', width: '100%', backgroundColor: '#020024' }}
      >
        {/* Крутая темная тема для карты (Dark Mode) */}
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CartoDB</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <LocationMarker onLocationSelect={onLocationSelect} />
      </MapContainer>
      
      {/* Подсказка для пользователя */}
      <div className="absolute bottom-2 left-0 w-full text-center pointer-events-none z-[400]">
        <span className="bg-black/70 text-[#39FF14] text-xs px-3 py-1 rounded-full border border-[#39FF14]/30 backdrop-blur-sm">
          TAP ON MAP TO SET LOCATION
        </span>
      </div>
    </div>
  );
};

export default MapPicker;
