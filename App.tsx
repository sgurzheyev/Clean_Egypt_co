import React from 'react';
import OrderForm from './components/OrderForm';

const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-[#39FF14]">
      {/* HERO SECTION - Твой оригинальный стиль */}
      <section className="h-screen flex flex-col items-center justify-center p-6 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#39FF14]/10 via-transparent to-[#BC13FE]/10" />
        
        <div className="relative z-10 space-y-4">
          <h1 className="text-[15vw] md:text-[12vw] font-black italic tracking-tighter uppercase leading-[0.8]">
            Clean <span className="text-white">Egypt</span>
          </h1>
          <p className="text-[#39FF14] font-bold uppercase tracking-[0.5em] text-sm">RED SEA MISSION</p>
        </div>

        <div className="mt-12 relative z-10 flex flex-col items-center space-y-6">
          <button className="px-12 py-6 bg-[#39FF14] text-black font-black rounded-full text-2xl uppercase italic hover:scale-105 transition-all shadow-[0_0_50px_rgba(57,255,20,0.4)]">
            CREATE ACCOUNT 🚀
          </button>
          
          <button
            onClick={() => document.getElementById('map-section')?.scrollIntoView({ behavior: 'smooth' })}
            className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em] hover:text-[#39FF14] transition-colors underline decoration-dotted underline-offset-4"
          >
            Wanna see first?
          </button>
        </div>
      </section>

      {/* MAP SECTION - Возвращаем твой Layout */}
      <section id="map-section" className="py-24 px-6 max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
        <div className="order-2 lg:order-1">
          <OrderForm language="en" />
        </div>
        <div className="order-1 lg:order-2 space-y-6">
          <div className="inline-block px-3 py-1 rounded-full bg-[#39FF14]/10 border border-[#39FF14]/20 text-[#39FF14] text-[10px] font-bold uppercase">
            Live Monitoring
          </div>
          <h2 className="text-6xl font-black italic uppercase tracking-tighter leading-none">
            The <span className="text-[#39FF14]">Neon</span> Grid
          </h2>
          <p className="text-zinc-500 font-medium text-lg">
            Every neon pyramid on this 3D map represents a real cleanup mission.
            Track contributions in real-time and see the Red Sea glow.
          </p>
        </div>
      </section>
    </div>
  );
};

export default App;
