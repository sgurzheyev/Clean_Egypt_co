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
<div className={min-h-screen w-full bg-[#0A0A0A] text-white ${language === 'ar' ? 'rtl' : 'ltr'}}>
<Header language={language} toggleLanguage={toggleLanguage} />

);
};

export default App;
