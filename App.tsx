import React from 'react';
import OrderForm from './components/OrderForm';
import { useLocalization } from './hooks/useLocalization';

const App: React.FC = () => {
  const [language, setLanguage] = React.useState<'en' | 'ru'>('en');

  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-[#39FF14] selection:text-black">
      {/* Hero Section */}
      <section className="h-screen flex flex-col items-center justify-center p-6 text-center space-y-12 bg-gradient-to-b from-black via-zinc-900 to-black">
        <div className="space-y-4">
          <h1 className="text-7xl md:text-9xl font-black italic tracking-tighter uppercase leading-none">
            Clean <span className="text-[#39FF14] drop-shadow-[0_0_30px_rgba(57,255,20,0.5)]">Egypt</span>
          </h1>
          <p className="text-sm md:text-lg font-bold text-zinc-500 uppercase tracking-[0.4em]">
            Red Sea Mission
          </p>
        </div>

        <div className="w-full max-w-md space-y-6">
          <button className="w-full bg-[#39FF14] text-black font-black py-6 rounded-3xl text-xl uppercase italic hover:scale-105 active:scale-95 transition-all shadow-[0_0_50px_rgba(57,255,20,0.3)]">
            CREATE ACCOUNT 🚀
          </button>
          
          {/* Твоя новая кнопка */}
          <button
            onClick={() => document.getElementById('map-section')?.scrollIntoView({ behavior: 'smooth' })}
            className="w-full text-[10px] font-bold text-white/30 uppercase tracking-[0.3em] hover:text-[#39FF14] transition-all underline decoration-dotted underline-offset-8"
          >
            Wanna see first?
          </button>
        </div>
      </section>

      {/* Map Section */}
      <section id="map-section" className="min-h-screen py-24 px-6 space-y-12">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-16 items-start">
          <div className="sticky top-24">
            <OrderForm language={language} />
          </div>
          
          <div className="space-y-8">
            <div className="inline-block px-4 py-1 rounded-full border border-[#39FF14]/30 text-[#39FF14] text-[10px] font-bold uppercase tracking-widest">
              Live Monitoring
            </div>
            <h2 className="text-5xl font-black italic uppercase tracking-tighter">
              The <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#39FF14] to-[#BC13FE]">Neon</span> Grid
            </h2>
            <p className="text-zinc-400 leading-relaxed font-medium">
              Every neon pyramid on this 3D map represents a real cleanup mission.
              Track contributions in real-time and see the Red Sea glow.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default App;
