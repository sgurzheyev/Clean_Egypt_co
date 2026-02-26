import React, { useState, useEffect } from 'react';
import Map, { Marker, NavigationControl, GeolocateControl, Layer } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import OrderForm from './components/OrderForm';
import { supabase } from './lib/supabaseClient';

// Токен теперь берется из твоего .env файла
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

const App: React.FC = () => {
  const [showMenu, setShowMenu] = useState(false);
  const [pyramids, setPyramids] = useState<any[]>([]);

  // Загружаем данные из твоей работающей таблицы pyramids
  useEffect(() => {
    const fetchPyramids = async () => {
      const { data } = await supabase.from('pyramids').select('*');
      if (data) setPyramids(data);
    };
    fetchPyramids();
  }, []);

  return (
    <div className="h-screen w-full bg-black relative overflow-hidden font-sans selection:bg-[#39FF14]">
      
      {/* 3D ENGINE — ПОЛНЫЙ КИБЕРПАНК */}
      <Map
        initialViewState={{
          longitude: 33.82,
          latitude: 27.25,
          zoom: 14,
          pitch: 60,
          bearing: -20
        }}
        mapStyle="mapbox://styles/mapbox/navigation-night-v1"
        mapboxAccessToken={MAPBOX_TOKEN}
        style={{ width: '100%', height: '100%' }}
      >
        <GeolocateControl position="top-right" trackUserLocation />
        <NavigationControl position="top-right" />

        {/* 3D ЗДАНИЯ ХУРГАДЫ */}
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

        {/* ТВОИ ПИРАМИДЫ ИЗ SUPABASE */}
        {pyramids.map((p: any) => {
          const coords = p.location.match(/\((.*) (.*)\)/);
          const progress = (p.current_amount / p.target_amount) * 100;
          
          return coords ? (
            <Marker key={p.id} longitude={parseFloat(coords[1])} latitude={parseFloat(coords[2])}>
              <div className="relative flex items-center justify-center group cursor-pointer">
                {/* Неоновый индикатор сбора */}
                <svg className="absolute w-14 h-14 -rotate-90">
                  <circle cx="28" cy="28" r="24" fill="none" stroke="#ffffff10" strokeWidth="2" />
                  <circle
                    cx="28" cy="28" r="24"
                    fill="none"
                    stroke="#39FF14"
                    strokeWidth="3"
                    strokeDasharray="150.8"
                    strokeDashoffset={150.8 - (150.8 * progress) / 100}
                    className="transition-all duration-1000 shadow-[0_0_15px_#39FF14]"
                  />
                </svg>
                
                <div className="w-8 h-8 bg-[#BC13FE] rotate-45 shadow-[0_0_25px_#BC13FE] animate-pulse" />
                
                <div className="absolute bottom-16 hidden group-hover:block bg-black/95 border border-[#39FF14]/40 p-3 rounded-xl backdrop-blur-md z-50">
                  <p className="text-[10px] font-black text-[#39FF14] uppercase mb-1">Live Mission</p>
                  <p className="text-white text-xs font-bold">${p.current_amount} / ${p.target_amount}</p>
                </div>
              </div>
            </Marker>
          ) : null;
        })}
      </Map>

      {/* КНОПКА МЕНЮ (Burger) */}
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="absolute left-6 top-6 z-[60] bg-[#39FF14] p-5 rounded-2xl shadow-[0_0_20px_rgba(57,255,20,0.4)]"
      >
        <div className={`w-6 h-1 bg-black mb-1.5 transition-all ${showMenu ? 'rotate-45 translate-y-2.5' : ''}`} />
        <div className={`w-6 h-1 bg-black mb-1.5 transition-all ${showMenu ? 'opacity-0' : ''}`} />
        <div className={`w-6 h-1 bg-black transition-all ${showMenu ? '-rotate-45 -translate-y-2.5' : ''}`} />
      </button>

      {/* НАТИВНОЕ МЕНЮ (Side Panel) */}
      <div className={`absolute left-0 top-0 h-full w-80 bg-black/95 backdrop-blur-2xl border-r border-white/10 transition-transform duration-500 z-50 ${showMenu ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-8 h-full flex flex-col justify-between overflow-y-auto">
          <div className="space-y-12">
            <h1 className="text-4xl font-black italic uppercase text-white tracking-tighter leading-none">
              Clean <span className="text-[#39FF14]">Egypt</span>
            </h1>
            
            <div className="space-y-4">
              <button className="w-full bg-[#39FF14] text-black font-black py-5 rounded-2xl uppercase italic text-sm">Create Account 🚀</button>
              <button className="w-full border border-white/20 text-white font-bold py-4 rounded-2xl uppercase text-[10px] tracking-widest">Try It Free</button>
            </div>

            <OrderForm language="en" />
          </div>
        </div>
      </div>

    </div>
  );
};

export default App;
