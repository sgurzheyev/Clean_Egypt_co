import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import Auth from './components/Auth';
import OrderForm from './components/OrderForm';
import ModeToggle from './components/ModeToggle';
import { supabase } from './lib/supabaseClient';
import { OrderMode } from './types';

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [language, setLanguage] = useState<any>('en');
  const [mode, setMode] = useState<OrderMode>(OrderMode.HOME);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    // ВОТ ОН: Глубокий синий фон (Deep Blue) с градиентом в черный
    <div className="min-h-screen w-full bg-gradient-to-b from-[#020024] via-[#090979] to-[#000000] text-white flex flex-col items-center overflow-x-hidden">
      
      <Header language={language} setLanguage={setLanguage} />
      
      <main className="flex-grow w-full max-w-md px-4 py-8 flex flex-col items-center justify-center gap-8 z-10">
        {!session ? (
          <Auth />
        ) : (
          <>
            <div className="w-full flex justify-center mb-4">
              <ModeToggle mode={mode} setMode={setMode} language={language} />
            </div>
            <OrderForm mode={mode} language={language} />
            
            <button
              onClick={() => supabase.auth.signOut()}
              className="mt-8 text-sm text-gray-400 hover:text-[#39FF14] transition-colors uppercase tracking-widest"
            >
              [ Sign Out ]
            </button>
          </>
        )}
      </main>
      
      {/* Декоративное неоновое свечение внизу */}
      <div className="fixed bottom-0 left-0 w-full h-32 bg-gradient-to-t from-[#39FF14]/10 to-transparent pointer-events-none" />
    </div>
  );
};

export default App;
