
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
    <header className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 py-3 flex justify-between items-center">
        <h1 className="text-2xl font-extrabold text-teal-600">{t('app_title')}</h1>
        <button
          onClick={toggleLanguage}
          className="px-4 py-2 bg-teal-100 text-teal-700 font-bold rounded-full hover:bg-teal-200 transition-colors"
        >
          {t('lang_switcher')}
        </button>
      </div>
    </header>
  );
};

export default Header;
