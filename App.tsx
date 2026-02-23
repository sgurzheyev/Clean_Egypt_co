import React, { useState } from 'react';
import Header from './components/Header';
import Auth from './components/Auth';

const App: React.FC = () => {
  const [language, setLanguage] = useState('en');
  const toggleLanguage = () => setLanguage(prev => (prev === 'en' ? 'ar' : 'en'));

  return (
    <div className="min-h-screen bg-black text-white">
      <Header language={language} toggleLanguage={toggleLanguage} />
      <main className="flex flex-col items-center pt-20">
        <h1 className="text-4xl font-bold mb-10">CleanEgypt</h1>
        <Auth />
      </main>
    </div>
  );
};

export default App;
