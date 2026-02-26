import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import { supabase } from '../lib/supabaseClient'; // Убедись, что путь верный
import PaymentOverlay from './PaymentOverlay';

// 1. Наша кастомная неоновая метка для ВЫБОРА места
const neonIcon = L.divIcon({
  className: 'custom-neon-icon',
  html: `<div style="background-color: #39FF14; width: 22px; height: 22px; border-radius: 50%; box-shadow: 0 0 20px #39FF14, 0 0 40px #39FF14; border: 2px solid white; animate: pulse 2s infinite;"></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

const MapPicker: React.FC = () => {
  const [selectedPos, setSelectedPos] = useState<L.LatLng | null>(null);
  const [pyramids, setPyramids] = useState<any[]>([]);
  const [showPayment, setShowPayment] = useState(false);
  const defaultCenter: [number, number] = [27.2579, 33.8116]; // Хургада

  // 2. Загружаем уже существующие пирамиды из Supabase
  useEffect(() => {
    const fetchPyramids = async () => {
      const { data, error } = await supabase
        .from('pyramids')
        .select('*');
      if (data) setPyramids(data);
      if (error) console.error("Error fetching pyramids:", error);
    };

    fetchPyramids();
    
    // Подписываемся на обновления в реальном времени (Realtime)
    const subscription = supabase
      .channel('public:pyramids')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pyramids' }, payload => {
        setPyramids((prev) => [...prev, payload.new]);
      })
      .subscribe();

    return () => { supabase.removeChannel(subscription); };
  }, []);

  // 3. Компонент обработки клика
  const MapEvents = () => {
    useMapEvents({
      click(e) {
        setSelectedPos(e.latlng);
      },
    });
    return null;
  };

  return (
    <div className="relative w-full h-[500px] rounded-[2.5rem] overflow-hidden border border-white/10 shadow-2xl bg-[#020024]">
      <MapContainer
        center={defaultCenter}
        zoom={13}
        scrollWheelZoom={true}
        className="w-full h-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CartoDB</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        
        <MapEvents />

        {/* 4. Отрисовка существующих пирамид из базы */}
        {pyramids.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.location.coordinates[1], p.location.coordinates[0]]}
            radius={p.status === 'completed' ? 12 : 8}
            pathOptions={{
              fillColor: p.status === 'completed' ? '#39FF14' : '#BC13FE',
              color: 'white',
              weight: 1,
              fillOpacity: p.glow_intensity || 0.5,
            }}
          />
        ))}

        {/* 5. Метка, которую ставит пользователь сейчас */}
        {selectedPos && (
          <Marker position={selectedPos} icon={neonIcon} />
        )}
      </MapContainer>

      {/* 6. Кнопка вызова оплаты (появляется после клика) */}
      {selectedPos && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-[1000] w-full px-10">
          <button
            onClick={() => setShowPayment(true)}
            className="w-full bg-gradient-to-r from-[#39FF14] to-[#BC13FE] text-black font-black py-4 rounded-2xl uppercase italic shadow-[0_0_30px_rgba(57,255,20,0.4)] hover:scale-105 transition-transform"
          >
            Зажечь точку за $0.99 🚀
          </button>
        </div>
      )}

      {/* 7. Оверлей оплаты */}
      {showPayment && selectedPos && (
        <PaymentOverlay
          onClose={() => setShowPayment(false)}
          lat={selectedPos.lat}
          lng={selectedPos.lng}
        />
      )}

      {/* Подсказка */}
      {!selectedPos && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[400]">
          <span className="bg-black/80 text-white text-[10px] px-4 py-2 rounded-full border border-white/10 backdrop-blur-md uppercase tracking-widest">
            Выберите место для очистки на карте
          </span>
        </div>
      )}
    </div>
  );
};

export default MapPicker;
