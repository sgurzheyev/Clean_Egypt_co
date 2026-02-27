import React, { useState, useEffect } from 'react';
import Map, { Marker, NavigationControl, GeolocateControl, Layer } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import OrderForm from './components/OrderForm';
import Auth from './components/Auth';
import Header from './components/Header'; // <-- ПОДКЛЮЧАЕМ НАШ НОВЫЙ HEADER
import { supabase } from './lib/supabaseClient';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

const App: React.FC = () => {
  const [showMenu, setShowMenu] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [pyramids, setPyramids] = useState<any[]>([]);
  const [newMissionLocation, setNewMissionLocation] = useState<{lat: number, lng: number} | null>(null);

  // Стейты для профиля пользователя (XP и Уровень)
  const [session, setSession] = useState<any>(null);
  const [userProfile, setUserProfile] = useState({ xp: 74, level: 12 }); // Значения по умолчанию для визуала

  // 1. Авторизация и загрузка XP профиля
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    supabase.auth.onAuthStateChange((_event, session) => setSession(session));
  }, []);

  useEffect(() => {
    if (session?.user) {
      const fetchProfile = async () => {
        const { data } = await supabase.from('profiles').select('xp, level').eq('id', session.user.id).single();
        if (data) setUserProfile({ xp: data.xp, level: data.level });
      };
      fetchProfile();

      const profileChannel = supabase.channel('public:profiles')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${session.user.id}` },
        (payload) => setUserProfile({ xp: payload.new.xp, level: payload.new.level }))
        .subscribe();

      return () => { supabase.removeChannel(profileChannel); };
    }
  }, [session]);

  // 2. Загрузка Пирамид (Заказов)
  useEffect(() => {
    const fetchPyramids = async () => {
      const { data } = await supabase.from('pyramids').select('*');
      if (data) setPyramids(data);
    };
    fetchPyramids();

    const channel = supabase.channel('pyramids_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pyramids' }, () => fetchPyramids())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleMapClick = (event: any) => {
    if (event.originalEvent.defaultPrevented) return;
    const { lng, lat } = event.lngLat;
    setNewMissionLocation({ lng, lat });
    setShowMenu(true); // Автоматически открываем меню при клике на карту
  };

  return (
    <div className="h-screen w-full bg-black relative overflow-hidden font-sans selection:bg-[#39FF14]">
      
      {/* --- НОВЫЙ HEADER С ПОЛОСКОЙ XP --- */}
      <Header
        language="en"
        toggleLanguage={() => {}}
        xp={userProfile.xp % 100}
        level={userProfile.level}
        onOpenMenu={() => setShowMenu(true)} // <-- ВОТ ЗДЕСЬ МЫ СВЯЗАЛИ КНОПКУ С МЕНЮ!
      />

      <Map
        initialViewState={{ longitude: 33.82, latitude: 27.25, zoom: 14, pitch: 60, bearing: -20 }}
        mapStyle="mapbox://styles/mapbox/navigation-night-v1"
        mapboxAccessToken={MAPBOX_TOKEN}
        style={{ width: '100%', height: '100%' }}
        onClick={handleMapClick}
      >
        {/* Контролы опущены вниз, чтобы не перекрывать Header */}
        <GeolocateControl position="bottom-right" trackUserLocation />
        <NavigationControl position="bottom-right" />

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

        {/* ПИРАМИДЫ */}
        {pyramids.map((p: any) => {
          const coordsMatch = p.location?.match(/\(([-\d.]+) ([-\d.]+)\)/);
          if (!coordsMatch) return null;

          const lng = parseFloat(coordsMatch[1]);
          const lat = parseFloat(coordsMatch[2]);
          const amount = parseFloat(p.current_amount || 0);

          const isPremium = amount >= 5 || p.mission_type === 'home';
          const glowColor = isPremium ? '#BC13FE' : '#39FF14';

          // Если статус "ожидает оплаты", делаем пирамиду тусклой
          const isPending = p.status === 'pending_payment';
          const opacity = isPending ? 0.4 : 1;

          return (
            <Marker key={p.id} longitude={lng} latitude={lat}>
              <div className="relative flex flex-col items-center group cursor-pointer" style={{ opacity }}>
                {amount > 0 && (
                  <div
                    className="mb-1 px-2 py-0.5 rounded text-[10px] font-black italic border bg-black/80 backdrop-blur-sm transition-transform group-hover:scale-125"
                    style={{ borderColor: glowColor, color: glowColor }}
                  >
                    {amount}$
                  </div>
                )}
                <div className="relative">
                   <svg viewBox="0 0 24 24" className="w-10 h-10 drop-shadow-2xl" style={{ filter: `drop-shadow(0 0 8px ${glowColor})` }}>
                      <path
                        d="M12 2L2 22H22L12 2Z"
                        fill={isPremium ? "rgba(188, 19, 254, 0.2)" : "rgba(57, 255, 20, 0.2)"}
                        stroke={glowColor}
                        strokeWidth="2"
                      />
                      <path d="M12 2V22" stroke={glowColor} strokeWidth="1" opacity="0.5" />
                   </svg>
                   {/* Пульсация только если оплачено */}
                   {!isPending && (
                     <div className={`absolute inset-0 rounded-full opacity-20 animate-ping`} style={{ backgroundColor: glowColor }} />
                   )}
                </div>
              </div>
            </Marker>
          );
        })}

        {/* МАРКЕР НОВОЙ ЦЕЛИ */}
        {newMissionLocation && (
          <Marker longitude={newMissionLocation.lng} latitude={newMissionLocation.lat}>
            <div className="relative flex items-center justify-center pointer-events-none">
              <div className="absolute w-8 h-8 border-2 border-[#39FF14] rounded-full animate-ping opacity-50"></div>
              <div className="w-4 h-4 bg-[#39FF14] rotate-45 border-2 border-black shadow-[0_0_20px_#39FF14]"></div>
            </div>
          </Marker>
        )}
      </Map>

      {/* --- БОКОВОЕ МЕНЮ --- */}
      <div className={`absolute left-0 top-0 h-full w-85 max-w-[85vw] bg-black/95 backdrop-blur-3xl border-r border-white/10 transition-transform duration-500 z-[80] ${showMenu ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-8 h-full flex flex-col justify-between relative">
          
          {/* Кнопка закрытия меню (Крестик) */}
          <button
            onClick={() => setShowMenu(false)}
            className="absolute top-6 right-6 text-white/50 hover:text-white transition-colors p-2"
          >
            <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="mt-16 space-y-10">
            <h1 className="text-5xl font-black italic uppercase text-white tracking-tighter leading-none">
              CLEAN <span className="text-[#39FF14] block">EGYPT</span>
            </h1>

            <div className="space-y-4">
              <button
                onClick={() => setShowAuth(true)}
                className="w-full bg-[#39FF14] text-black font-black py-5 rounded-2xl uppercase italic text-lg shadow-[0_10px_20px_rgba(57,255,20,0.3)] hover:brightness-110 active:scale-95 transition-all"
              >
                Clean My Wallet $1 🚀
              </button>

              <button
                onClick={() => setShowAuth(true)}
                className="w-full border-2 border-[#BC13FE] text-[#BC13FE] font-black py-4 rounded-2xl uppercase text-sm tracking-widest hover:bg-[#BC13FE]/10 transition-colors shadow-[0_0_15px_rgba(188,19,254,0.2)]"
              >
                Clean My Wallet $5 (Home)
              </button>

              <button
                onClick={() => setShowAuth(true)}
                className="w-full text-gray-500 font-bold py-2 rounded-2xl uppercase text-[10px] tracking-widest hover:text-white transition-colors"
              >
                Try It Free (Zero Status)
              </button>
            </div>

            <div className="pt-6 border-t border-white/5">
               <OrderForm selectedLocation={newMissionLocation} />
            </div>
          </div>

          <div className="text-[10px] text-gray-700 uppercase tracking-widest font-black">
            Egypt Clean Energy Protocol v3.0
          </div>
        </div>
      </div>

      {/* --- МОДАЛКА АВТОРИЗАЦИИ / ОПЛАТЫ --- */}
      {showAuth && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-md">
          <div className="relative w-full max-w-sm p-4">
            <button
              onClick={() => setShowAuth(false)}
              className="absolute -top-6 right-4 text-white/40 hover:text-white text-xl font-light transition-colors"
            >
              [ close ]
            </button>
            <Auth />
          </div>
        </div>
      )}

    </div>
  );
};

export default App;
