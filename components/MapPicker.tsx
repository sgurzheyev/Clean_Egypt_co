import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { supabase } from '../lib/supabaseClient';
import 'leaflet/dist/leaflet.css';

// Кастомная неоновая иконка для выбора места
const neonIcon = L.divIcon({
  className: 'custom-neon-icon',
  html: `<div style="background: #39FF14; width: 20px; height: 20px; border-radius: 50%; box-shadow: 0 0 20px #39FF14, 0 0 40px #39FF14;"></div>`,
  iconSize: [20, 20],
});

// Иконка для существующих миссий (Пирамиды)
const pyramidIcon = L.divIcon({
  className: 'pyramid-icon',
  html: `<div style="background: #BC13FE; width: 15px; height: 15px; transform: rotate(45deg); box-shadow: 0 0 15px #BC13FE;"></div>`,
  iconSize: [15, 15],
});

interface MapPickerProps {
  onLocationSelect: (loc: string) => void;
}

const MapPicker: React.FC<MapPickerProps> = ({ onLocationSelect }) => {
  const [position, setPosition] = useState<L.LatLng | null>(null);
  const [missions, setMissions] = useState<any[]>([]);

  // Загружаем существующие пирамиды из базы
  useEffect(() => {
    const fetchMissions = async () => {
      const { data } = await supabase.from('pyramids').select('*');
      if (data) setMissions(data);
    };
    fetchMissions();
  }, []);

  const MapEvents = () => {
    useMapEvents({
      click(e) {
        setPosition(e.latlng);
        onLocationSelect(`${e.latlng.lat},${e.latlng.lng}`);
      },
    });
    return null;
  };

  return (
    <div className="h-[400px] w-full rounded-3xl overflow-hidden border border-white/10 shadow-2xl relative">
      <MapContainer center={[27.25, 33.82]} zoom={12} className="h-full w-full bg-[#0a0a0a]">
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        />
        <MapEvents />
        
        {/* Маркер выбора */}
        {position && <Marker position={position} icon={neonIcon} />}

        {/* Отображение пирамид из базы */}
        {missions.map((m) => {
          // Парсим координаты из формата POINT(lng lat)
          const coords = m.location.match(/\((.*) (.*)\)/);
          if (coords) {
            return (
              <Marker
                key={m.id}
                position={[parseFloat(coords[2]), parseFloat(coords[1])]}
                icon={pyramidIcon}
              />
            );
          }
          return null;
        })}
      </MapContainer>
      
      {!position && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] pointer-events-none z-[1000]">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#39FF14] animate-pulse">
            Select Target on Map
          </p>
        </div>
      )}
    </div>
  );
};

export default MapPicker;
