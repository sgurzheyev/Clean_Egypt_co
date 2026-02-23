import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import Auth from './components/Auth';
import OrderForm from './components/OrderForm';
import ModeToggle from './components/ModeToggle';
import { supabase } from './supabaseClient'; // Должен лежать в src/
import { OrderMode } from './types';

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [language, setLanguage] = useState<any>('en');
  const [mode, setMode] = useState<OrderMode>(OrderMode.HOME);

  useEffect(() => {
    // 1. Проверяем сессию при старте
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    // 2. Следим за входом/выходом в реальном времени
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const toggleLanguage = () => setLanguage((prev: string) => (prev === 'en' ? 'ar' : 'en'));

  return (
    <div className="min-h-screen bg-black text-white font-['Nunito']">
      <Header language={language} toggleLanguage={toggleLanguage} />
      
      <main className="flex flex-col items-center pt-10 px-4 pb-20">
        {!session ? (
          // Если НЕ залогинен — показываем Auth
          <div className="mt-10 w-full max-w-md flex flex-col items-center">
            <h1 className="text-5xl font-black italic text-[#39FF14] mb-2 tracking-tighter">CLEANEGYPT</h1>
            <p className="text-zinc-500 mb-10 font-bold uppercase tracking-widest text-[10px]">
              Ready to clean the world, Sergio?
            </p>
            <Auth />
          </div>
        ) : (
          // Если залогинен — показываем форму заказа
          <div className="w-full max-w-2xl flex flex-col items-center gap-10">
            <ModeToggle mode={mode} setMode={setMode} language={language} />
            <OrderForm mode={mode} language={language} />
            
            <button
              onClick={() => supabase.auth.signOut()}
              className="mt-4 text-zinc-600 hover:text-red-500 text-[10px] font-black uppercase tracking-[0.2em] transition-all"
            >
              Sign Out / Выход
            </button>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
