import React, { useState } from 'react';
import Header from './components/Header';
import ModeToggle from './components/ModeToggle';
import OrderForm from './components/OrderForm';
import WorkerPortal from './components/WorkerPortal';
import { OrderMode, Language } from './types';

const App: React.FC = () => {
  const [mode, setMode] = useState<OrderMode>(OrderMode.HOME);
  const [language, setLanguage] = useState<Language>('en');
  
  // Простая логика переключения без библиотек
  const isWorkerRoute = window.location.pathname === '/worker-hub';

  const toggleLanguage = () => {
    setLanguage(prev => (prev === 'en' ? 'ar' : 'en'));
  };

  return (
    <div className={`min-h-screen w-full ${language === 'ar' ? 'rtl' : 'ltr'}`}>
      <Header language={language} toggleLanguage={toggleLanguage} />
      
      <main className="container mx-auto px-4 py-8 flex flex-col items-center">
        {isWorkerRoute ? (
          /* ПОКАЗЫВАЕМ ПОРТАЛ РАБОЧЕГО */
          <WorkerPortal />
        ) : (
          /* ПОКАЗЫВАЕМ ГЛАВНУЮ СТРАНИЦУ КЛИЕНТА */
          <>
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
