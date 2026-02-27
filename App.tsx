import React, { useState, useEffect } from 'react';
// Импорт строго для версии 8.1.0
import Map, { Marker, NavigationControl, GeolocateControl, Layer } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import OrderForm from './components/OrderForm';
import { supabase } from './lib/supabaseClient';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

const App: React.FC = () => {
  const [showMenu, setShowMenu] = useState(false);
  const [pyramids, setPyramids] = useState<any[]>([]);
  
  // State to store where the user clicked for a new mission
  const [newMissionLocation, setNewMissionLocation] = useState<{lat: number, lng: number} | null>(null);

  // Fetch data from Supabase and set up real-time subscription
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

  // Handle clicks on the map to set a new mission pin
  const handleMapClick = (event: any) => {
    if (event.originalEvent.defaultPrevented) return;
    
    const { lng, lat } = event.lngLat;
    setNewMissionLocation({ lng, lat });
    setShowMenu(true);
  };

  return (
    <div className="h-screen w-full bg-black relative overflow-hidden font-sans selection:bg-[#39FF14]">
      
      <Map
        initialViewState={{
          longitude: 33.82,
          latitude: 27.25, // Хургада
          zoom: 14,
          pitch: 60,
          bearing: -20
        }}
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

        {/* --- DYNAMIC GAMIFIED PYRAMIDS RENDERING --- */}
        {pyramids.map((p: any) => {
          const coordsMatch = p.location?.match(/\(([-\d.]+) ([-\d.]+)\)/);
          if (!coordsMatch) return null;
          
          const lng = parseFloat(coordsMatch[1]);
          const lat = parseFloat(coordsMatch[2]);
          const amount = parseFloat(p.current_amount || 0);

          // LOGIC 1: CLEAN MY EGYPT (Public City Missions)
          if (p.mission_type === 'egypt' || !p.mission_type) {
            // Scale: Base size 1, Max size 10 (at $100)
            const scale = Math.min(1 + (amount / 10), 10);
            const isHighValue = amount >= 50;
            // Color logic: small is green, big is purple/blue
            const colorClass = isHighValue
              ? 'bg-gradient-to-tr from-[#BC13FE] to-blue-500 shadow-[0_0_25px_#BC13FE]'
              : 'bg-[#39FF14] shadow-[0_0_15px_#39FF14]';

            return (
              <Marker
                key={p.id}
                longitude={lng}
                latitude={lat}
                onClick={(e) => e.originalEvent.stopPropagation()}
              >
                <div className="relative flex items-center justify-center group cursor-pointer">
                  {/* Neon Pyramid Diamond */}
                  <div
                    style={{ transform: `scale(${scale}) rotate(45deg)`, transition: 'transform 0.5s ease' }}
                    className={`w-3 h-3 ${colorClass} animate-pulse`}
                  />
                  
                  {/* Hover Info Card */}
                  <div className="absolute bottom-6 hidden group-hover:block bg-black/95 border border-[#39FF14]/40 p-3 rounded-xl backdrop-blur-md z-[100] min-w-[120px] text-center">
                    <p className="text-[10px] font-black text-[#BC13FE] uppercase mb-1">CleanMyEgypt</p>
                    <p className="text-[9px] text-white/70 uppercase mb-2">{p.founder_name || 'Hero'} Pyramid</p>
                    <p className="text-white text-sm font-bold">${amount.toFixed(2)}</p>
                    <p className="text-[8px] text-[#39FF14] mt-1">Tap to Top-Up!</p>
                  </div>
                </div>
              </Marker>
            );
          }

          // LOGIC 2: CLEAN MY HOME (Private Bidding Missions)
          if (p.mission_type === 'home') {
            // Scale: Base size 5 (like $5 deposit), grows up to max 8
            const scale = Math.min(2 + (amount / 100), 8);

            return (
              <Marker
                key={p.id}
                longitude={lng}
                latitude={lat}
                onClick={(e) => e.originalEvent.stopPropagation()}
              >
                <div className="relative flex items-center justify-center group cursor-pointer">
                  {/* Yellow Pyramid Diamond */}
                  <div
                    style={{ transform: `scale(${scale}) rotate(45deg)`, transition: 'transform 0.5s ease' }}
                    className="w-4 h-4 bg-gradient-to-tr from-[#FFD700] to-orange-400 shadow-[0_0_20px_#FFD700]"
                  />
                  
                  {/* Hover Info Card */}
                  <div className="absolute bottom-8 hidden group-hover:block bg-black/95 border border-[#FFD700]/40 p-3 rounded-xl backdrop-blur-md z-[100] min-w-[120px] text-center">
                    <p className="text-[10px] font-black text-[#FFD700] uppercase mb-1">CleanMyHome</p>
                    <p className="text-white text-sm font-bold">Bidding Open</p>
                    <p className="text-[9px] text-white/50 uppercase mt-1">Budget ~ ${amount.toFixed(2)}</p>
                    <p className="text-[8px] text-orange-400 mt-2">Requires 50% Deposit to Bid</p>
                  </div>
                </div>
              </Marker>
            );
          }

          return null;
        })}

        {/* --- MARKER FOR THE NEWLY CLICKED LOCATION (Ghost Pin) --- */}
        {newMissionLocation && (
             <Marker longitude={newMissionLocation.lng} latitude={newMissionLocation.lat}>
                <div className="w-6 h-6 bg-white/50 rotate-45 animate-bounce border-2 border-white shadow-[0_0_15px_white]" />
             </Marker>
        )}

      </Map>

      {/* Menu Toggle Button */}
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="absolute left-6 top-6 z-[100] bg-[#39FF14] p-5 rounded-2xl shadow-[0_0_20px_rgba(57,255,20,0.4)] active:scale-95 transition-transform"
      >
        <div className={`w-6 h-1 bg-black mb-1.5 transition-all ${showMenu ? 'rotate-45 translate-y-2.5' : ''}`} />
        <div className={`w-6 h-1 bg-black mb-1.5 transition-all ${showMenu ? 'opacity-0' : ''}`} />
        <div className={`w-6 h-1 bg-black transition-all ${showMenu ? '-rotate-45 -translate-y-2.5' : ''}`} />
      </button>

      {/* Sidebar Menu & Mission Control Form */}
      <div className={`absolute left-0 top-0 h-full w-85 bg-black/90 backdrop-blur-2xl border-r border-white/10 transition-transform duration-500 z-[80] ${showMenu ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-8 h-full flex flex-col overflow-y-auto">
          <div className="mt-24 space-y-12">
            <h1 className="text-4xl font-black italic uppercase text-white tracking-tighter">
              Clean <span className="text-[#39FF14]">Egypt</span>
            </h1>
            
            <div className="space-y-4">
              <button
                onClick={() => alert('Account Creation Coming Soon!')}
                className="w-full bg-[#39FF14] text-black font-black py-5 rounded-2xl uppercase italic text-sm hover:brightness-110 active:scale-[0.98] transition-all"
              >
                Create Account 🚀
              </button>
              <button className="w-full border border-white/20 text-white font-bold py-4 rounded-2xl uppercase text-[10px] tracking-widest hover:bg-white/5 transition-colors">
                Try It Free
              </button>
            </div>

            {/* Passes the clicked location to the OrderForm */}
            <OrderForm
                selectedLocation={newMissionLocation}
                onClose={() => setShowMenu(false)} // Pass a close function if needed
            />
          </div>
        </div>
      </div>

    </div>
  );
};

export default App;
