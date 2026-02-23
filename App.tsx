import React, { useState } from 'react';
import Header from './components/Header';
import Auth from './components/Auth';

const App: React.FC = () => {
  const [language, setLanguage] = useState('en');
  const toggleLanguage = () => setLanguage(prev => (prev === 'en' ? 'ar' : 'en'));

  return (
    <div className="min-h-screen bg-black text-white">
      <Header language={language} toggleLanguage={toggleLanguage} />
      <main className="flex flex-col items-center pt-24 px-4">
        <div className="mb-12 text-center">
          <h1 className="text-4xl font-bold mb-2">CleanEgypt</h1>
          <p className="text-zinc-500">Ready to clean the world, Sergio?</p>
        </div>
        <Auth />
      </main>
    </div>
  );
};

export default App;
