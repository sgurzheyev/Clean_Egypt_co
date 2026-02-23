import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import ModeToggle from './components/ModeToggle';
import OrderForm from './components/OrderForm';
import WorkerPortal from './components/WorkerPortal';
import Auth from './components/Auth';
import { OrderMode, Language } from './types';

const App: React.FC = () => {
const [mode, setMode] = useState(OrderMode.HOME);
const [language, setLanguage] = useState('en');
const [isInitializing, setIsInitializing] = useState(true);

const isWorkerRoute = window.location.pathname === '/worker-hub';

useEffect(() => {
const timer = setTimeout(() => {
setIsInitializing(false);
}, 2500);
return () => clearTimeout(timer);
}, []);

const toggleLanguage = () => {
setLanguage(prev => (prev === 'en' ? 'ar' : 'en'));
};

if (isInitializing) {
return (
<div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-[#39FF14] to-[#BC13FE] animate-pulse">
<h1 className="text-5xl font-black text-white italic tracking-tighter drop-shadow-2xl">CleanEgypt</h1>
<div className="mt-6 flex flex-col items-center">
<div className="w-48 h-1 bg-white/20 rounded-full overflow-hidden">
<div className="h-full bg-white animate-[loading_2s_ease-in-out_infinite]"></div>
</div>
<p className="text-white/80 text-[10px] font-mono mt-4 tracking-[0.3em] uppercase">Initializing Neon-Grid...</p>
</div>
</div>
);
}

return (
<div className="min-h-screen w-full bg-[#0A0A0A] text-white">
<Header language={language} toggleLanguage={toggleLanguage} />

  <main className="container mx-auto px-4 py-8 flex flex-col items-center">
    {isWorkerRoute ? (
      <WorkerPortal />
    ) : (
      <>
        <div className="w-full max-w-2xl mb-8">
          <h1 className="text-4xl font-bold">
            Hi, <span className="text-[#39FF14]">Sergio!</span>
          </h1>
          <p className="text-gray-500 mt-2 text-sm italic">Ready to clean the world today?</p>
        </div>

        {/* Блок авторизации */}
        <div className="w-full max-w-2xl mb-12">
          <Auth />
        </div>

        <ModeToggle mode={mode} setMode={setMode} language={language} />
        
        <div className="w-full max-w-2xl mt-8">
          <OrderForm mode={mode} language={language} />
        </div>
      </>
    )}
  </main>
</div>
);
};

export default App;
