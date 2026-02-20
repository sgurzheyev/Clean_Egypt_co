import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import ModeToggle from './components/ModeToggle';
import OrderForm from './components/OrderForm';
import WorkerPortal from './components/WorkerPortal';
import { OrderMode, Language } from './types';

const App: React.FC = () => {
  const [mode, setMode] = useState<OrderMode>(OrderMode.HOME);
  const [language, setLanguage] = useState<Language>('en');

  const toggleLanguage = () => {
    setLanguage(prev => (prev === 'en' ? 'ar' : 'en'));
  };

  return (
    <Router>
      <div className={`min-h-screen w-full ${language === 'ar' ? 'rtl' : 'ltr'}`}>
        <Header language={language} toggleLanguage={toggleLanguage} />
        
        <Routes>
          {/* ГЛАВНАЯ СТРАНИЦА ДЛЯ КЛИЕНТОВ */}
          <Route path="/" element={
            <main className="container mx-auto px-4 py-8 flex flex-col items-center">
              <ModeToggle mode={mode} setMode={setMode} language={language} />
              <div className="w-full max-w-2xl mt-8">
                <OrderForm mode={mode} language={language} />
              </div>
            </main>
          } />

          {/* СТРАНИЦА БАЛАНСА ДЛЯ АХМЕДОВ */}
          <Route path="/worker-hub" element={<WorkerPortal />} />
        </Routes>

      </div>
    </Router>
  );
};

export default App;
