import React from 'react';
import { Language } from '../types';

interface HeaderProps {
  language: Language;
  toggleLanguage: () => void;
  xp?: number;
  level?: number;
  onOpenMenu: () => void;
}

const Header: React.FC<HeaderProps> = ({
  language,
  toggleLanguage,
  xp = 74,
  level = 12,
  onOpenMenu,
}) => {
  return (
    <header className="fixed top-0 left-0 w-full z-50 pt-[env(safe-area-inset-top)]">
      <div className="bg-black/60 backdrop-blur-xl border-b border-white/10 px-3 py-3 sm:px-6 sm:py-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-xl border border-[#39FF14]/30 flex items-center justify-center bg-[#39FF14]/5">
            <svg viewBox="0 0 24 24" className="w-5 h-5 sm:w-6 sm:h-6 text-[#39FF14] drop-shadow-[0_0_5px_#39FF14]">
              <path d="M12 2L2 22H22L12 2Z" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </div>
          <div className="text-left min-w-0">
            <h1 className="text-sm sm:text-lg font-black italic tracking-tighter text-white uppercase leading-none truncate">
              Clean<span className="text-[#39FF14]">Egypt</span>
            </h1>
          </div>
        </div>

        <div className="flex flex-col items-center px-1">
          <span className="text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-[0.2em]">
            Eco-Hero
          </span>
          <span className="text-[10px] md:text-xs font-black italic text-white tracking-widest">
            Lv. {level}
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <button
            onClick={toggleLanguage}
            className="px-2.5 py-1 sm:px-3 border border-white/20 text-white text-[10px] md:text-xs font-black rounded-lg hover:bg-white/10 transition-all uppercase italic"
          >
            {language === 'en' ? 'AR' : 'EN'}
          </button>

          <button
            onClick={onOpenMenu}
            className="text-white hover:text-[#39FF14] transition-colors p-1"
            aria-label="Open menu"
          >
            <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="w-full h-[3px] bg-gray-900/50 relative overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-[#39FF14] to-cyan-400 shadow-[0_0_15px_#39FF14] transition-all duration-1000 ease-out"
          style={{ width: `${xp}%` }}
        />
        <div
          className="absolute top-0 left-0 h-full w-20 bg-white/20 skew-x-12 animate-[shimmer_2s_infinite]"
          style={{ left: `${xp - 10}%` }}
        />
      </div>
    </header>
  );
};

export default Header;
