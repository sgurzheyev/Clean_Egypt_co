iimport React, { useState, useEffect } from 'react';
import Header from './components/Header';
import ModeToggle from './components/ModeToggle';
import OrderForm from './components/OrderForm';
import WorkerPortal from './components/WorkerPortal';
import { OrderMode, Language } from './types';

const App: React.FC = () => {
  const [mode, setMode] = useState<OrderMode>(OrderMode.HOME);
  const [language, setLanguage] = useState<Language>('en');
  const [isInitializing, setIsInitializing] = useState(true);
  
  const isWorkerRoute = window.location.pathname === '/worker-hub';

  useEffect(() => {
    // Эффект заставки при запуске в твоих цветах
    const timer = setTimeout(() => {
      setIsInitializing(false);
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  const toggleLanguage = () => {
    setLanguage(prev => (prev === 'en' ? 'ar' : 'en'));
  };

  // Экран заставки (Splash Screen)
  if (isInitializing) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-[#39FF14] to-[#BC13FE] animate-pulse">
        <h1 className="text-5xl font-black text-white italic tracking-tighter drop-shadow-2xl">
          CleanEgypt
        </h1>
        <div className="mt-6 flex flex-col items-center">
          <div className="w-48 h-1 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-white animate-[loading_2s_ease-in-out_infinite]"></div>
          </div>
          <p className="text-white/80 text-[10px] font-mono mt-4 tracking-[0.3em] uppercase">
            Initializing Neon-Grid...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen w-full bg-[#0A0A0A] text-white ${language === 'ar' ? 'rtl' : 'ltr'}`}>
      <Header language={language} toggleLanguage={toggleLanguage} />
      
      <main className="container mx-auto px-4 py-8 flex flex-col items-center">
        {isWorkerRoute ? (
          <WorkerPortal />
        ) : (
          <>
            <div className="w-full max-w-2xl mb-8 text-left">
              <h1 className="text-4xl font-bold tracking-tight">
                Hi, <span className="text-[#39FF14] underline decoration-[#BC13FE]/30">Sergio!</span>
              </h1>
              <p className="text-gray-500 mt-2 text-sm italic">Ready to clean the world today?</p>
            </div>

            <ModeToggle mode={mode} setMode={setMode} language={language} />
            
            <div className="w-full max-w-2xl mt-8 relative group">
              {/* Свечение вокруг формы */}
              <div className="absolute -inset-1 bg-gradient-to-r from-[#39FF14] to-[#BC13FE] rounded-[2rem] blur opacity-10 group-hover:opacity-20 transition duration-1000"></div>
              
              <div className="relative bg-[#111111] border border-white/5 rounded-[2rem] p-1">
                <OrderForm mode={mode} language={language} />
              </div>
            </div>
          </>
        )}
      </main>

      <div className="fixed bottom-4 left-0 right-0 flex justify-center pointer-events-none">
        <div className="px-4 py-1 rounded-full border border-[#BC13FE]/30 bg-black/50 backdrop-blur-md text-[10px] text-[#BC13FE] font-mono uppercase tracking-widest">
          Network: Hurghada Online
        </div>
      </div>
    </div>
  );
};

export default App;
