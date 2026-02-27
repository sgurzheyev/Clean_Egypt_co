import React, { useState, useEffect } from 'react';
import Map, { Marker, NavigationControl, GeolocateControl, Layer } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import OrderForm from './components/OrderForm';
import Auth from './components/Auth'; // ПОДКЛЮЧАЕМ ВАШ КОМПОНЕНТ АВТОРИЗАЦИИ (убедитесь, что путь верный)
import { supabase } from './lib/supabaseClient';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

const App: React.FC = () => {
  const [showMenu, setShowMenu] = useState(false);
  const [showAuth, setShowAuth] = useState(false); // СТЕЙТ ДЛЯ ОКНА РЕГИСТРАЦИИ
  const [pyramids, setPyramids] = useState<any[]>([]);
  const [newMissionLocation, setNewMissionLocation] = useState<{lat: number, lng: number} | null>(null);

  useEffect(() => {
    const fetchPyramids = async () => {
      const { data } = await supabase.from('pyramids').select('*');
      if (data) setPyramids(data);
    };
    fetchPyramids();

    const channel = supabase
      .channel('pyramids_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pyramids' }, (payload) => {
        fetchPyramids();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleMapClick = (event: any) => {
    if (event.originalEvent.defaultPrevented) return;
    const { lng, lat } = event.lngLat;
    setNewMissionLocation({ lng, lat });
    setShowMenu(true);
  };

  return (
    <div className="h-screen w-full bg-black relative overflow-hidden font-sans selection:bg-[#39FF14]">
      
      <Map
        initialViewState={{ longitude: 33.82, latitude: 27.25, zoom: 14, pitch: 60, bearing: -20 }}
        mapStyle="mapbox://styles/mapbox/navigation-night-v1"
        mapboxAccessToken={MAPBOX_TOKEN}
        style={{ width: '100%', height: '100%' }}
        onClick={handleMapClick}
      >
        <GeolocateControl position="top-right" trackUserLocation />
        <NavigationControl position="top-right" />

        <Layer
          id="3d-buildings"
          source="composite"
          source-layer="building"
          filter={['==', 'extrude', 'true']}
          type="fill-extrusion"
          paint={{
            'fill-extrusion-color': '#111',
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': ['get', 'min_height'],
            'fill-extrusion-opacity': 0.6
          }}
        />

        {/* Геймифицированные пирамиды из базы */}
        {pyramids.map((p: any) => {
          const coordsMatch = p.location?.match(/\(([-\d.]+) ([-\d.]+)\)/);
          if (!coordsMatch) return null;
          
          const lng = parseFloat(coordsMatch[1]);
          const lat = parseFloat(coordsMatch[2]);
          const amount = parseFloat(p.current_amount || 0);

          if (p.mission_type === 'egypt' || !p.mission_type) {
            const scale = Math.min(1 + (amount / 10), 10);
            const isHighValue = amount >= 50;
            const colorClass = isHighValue ? 'bg-gradient-to-tr from-[#BC13FE] to-blue-500 shadow-[0_0_25px_#BC13FE]' : 'bg-[#39FF14] shadow-[0_0_15px_#39FF14]';

            return (
              <Marker key={p.id} longitude={lng} latitude={lat} onClick={(e) => e.originalEvent.stopPropagation()}>
                <div className="relative flex items-center justify-center group cursor-pointer">
                  <div style={{ transform: `scale(${scale}) rotate(45deg)`, transition: 'transform 0.5s ease' }} className={`w-3 h-3 ${colorClass} animate-pulse`} />
                </div>
              </Marker>
            );
          }

          if (p.mission_type === 'home') {
            const scale = Math.min(2 + (amount / 100), 8);
            return (
              <Marker key={p.id} longitude={lng} latitude={lat} onClick={(e) => e.originalEvent.stopPropagation()}>
                <div className="relative flex items-center justify-center group cursor-pointer">
                  <div style={{ transform: `scale(${scale}) rotate(45deg)`, transition: 'transform 0.5s ease' }} className="w-4 h-4 bg-gradient-to-tr from-[#FFD700] to-orange-400 shadow-[0_0_20px_#FFD700]" />
                </div>
              </Marker>
            );
          }
          return null;
        })}

        {/* НОВЫЙ ИСПРАВЛЕННЫЙ МАРКЕР ВЫБОРА ЛОКАЦИИ */}
        {newMissionLocation && (
             <Marker longitude={newMissionLocation.lng} latitude={newMissionLocation.lat}>
                <div className="relative flex items-center justify-center pointer-events-none">
                  <div className="absolute w-8 h-8 border-2 border-[#39FF14] rounded-full animate-ping opacity-50"></div>
                  <div className="w-4 h-4 bg-[#39FF14] rotate-45 border-2 border-black shadow-[0_0_20px_#39FF14]"></div>
                </div>
             </Marker>
        )}
      </Map>

      <button onClick={() => setShowMenu(!showMenu)} className="absolute left-6 top-6 z-[100] bg-[#39FF14] p-5 rounded-2xl shadow-[0_0_20px_rgba(57,255,20,0.4)] active:scale-95 transition-transform">
        <div className={`w-6 h-1 bg-black mb-1.5 transition-all ${showMenu ? 'rotate-45 translate-y-2.5' : ''}`} />
        <div className={`w-6 h-1 bg-black mb-1.5 transition-all ${showMenu ? 'opacity-0' : ''}`} />
        <div className={`w-6 h-1 bg-black transition-all ${showMenu ? '-rotate-45 -translate-y-2.5' : ''}`} />
      </button>

      <div className={`absolute left-0 top-0 h-full w-85 bg-black/90 backdrop-blur-2xl border-r border-white/10 transition-transform duration-500 z-[80] ${showMenu ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-8 h-full flex flex-col overflow-y-auto">
          <div className="mt-24 space-y-12">
            <h1 className="text-4xl font-black italic uppercase text-white tracking-tighter">
              Clean <span className="text-[#39FF14]">Egypt</span>
            </h1>
            
            <div className="space-y-4">
              <button
                onClick={() => setShowAuth(true)} // ТЕПЕРЬ ОТКРЫВАЕТ ОКНО АВТОРИЗАЦИИ
                className="w-full bg-[#39FF14] text-black font-black py-5 rounded-2xl uppercase italic text-sm hover:brightness-110 active:scale-[0.98] transition-all"
              >
                Create Account 🚀
              </button>
              <button className="w-full border border-white/20 text-white font-bold py-4 rounded-2xl uppercase text-[10px] tracking-widest hover:bg-white/5 transition-colors">
                Try It Free
              </button>
            </div>

            <OrderForm selectedLocation={newMissionLocation} />
          </div>
        </div>
      </div>

      {/* МОДАЛЬНОЕ ОКНО ДЛЯ AUTH.TSX */}
      {showAuth && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="relative w-full max-w-sm">
            <button
              onClick={() => setShowAuth(false)}
              className="absolute -top-4 -right-4 w-10 h-10 bg-black border border-white/20 text-white font-black rounded-full hover:bg-white/10 transition-colors z-[210] flex items-center justify-center"
            >
              X
            </button>
            <Auth />
          </div>
        </div>
      )}

    </div>
  );
};

export default App;
