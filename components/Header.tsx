import React from 'react';
import { useLocalization } from '../hooks/useLocalization';
import { Language } from '../types';

interface HeaderProps {
  language: Language;
  toggleLanguage: () => void;
}

const Header: React.FC<HeaderProps> = ({ language, toggleLanguage }) => {
  const { t } = useLocalization(language);

  return (
    <header className="bg-black/40 backdrop-blur-md border-b border-white/5 sticky top-0 z-50">
      <div className="container mx-auto px-4 py-3 flex justify-between items-center">
        <h1 className="text-2xl font-black italic tracking-tighter text-[#39FF14]">
          {t('app_title')}
        </h1>
        <button
          onClick={toggleLanguage}
          className="px-4 py-1.5 border border-[#BC13FE]/50 text-[#BC13FE] text-xs font-bold rounded-full hover:bg-[#BC13FE]/10 transition-all uppercase tracking-widest"
        >
          {language === 'en' ? 'AR' : 'EN'}
        </button>
      </div>
    </header>
  );
};

export default Header;
