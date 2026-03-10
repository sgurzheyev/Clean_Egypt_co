import React, { useEffect, useState } from 'react';

interface JobMarkerProps {
  amount: number;
  orderType: 'home' | 'city';
  label?: string;
  onClick?: (e: React.MouseEvent) => void;
}

const JobMarker: React.FC<JobMarkerProps> = ({ amount, orderType, label, onClick }) => {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const isHome = orderType === 'home';
  const icon = isHome ? '🏠' : '🌆';

  // Dynamic scale: $1 → 0.7, $100+ → 1.5
  const scale = 0.7 + (Math.min(amount, 100) / 100) * 0.8;

  const pyramidShapeClass = isHome ? 'pyramid-shape-home' : 'pyramid-shape-city';
  const pyramidGlowClass = isHome ? 'pyramid-glow-home' : 'pyramid-glow-city';

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      className="relative flex flex-col items-center group cursor-pointer select-none outline-none border-0 p-0 bg-transparent origin-bottom"
      style={{ transform: `scale(${scale})`, transformOrigin: 'bottom center' }}
      aria-label={`${orderType} mission $${amount}`}
    >
      {/* Floating pill label — above pyramid */}
      <div
        className={[
          'absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full z-20',
          'px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-[0.12em] min-w-[2rem]',
          'text-white bg-black/60 backdrop-blur-md border border-white/15',
          'shadow-[0_2px_12px_rgba(0,0,0,0.5),0_0_1px_rgba(255,255,255,0.1)]',
          'transition-transform duration-300 ease-out',
          entered ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
          'group-hover:scale-105',
        ].join(' ')}
      >
        ${amount}
      </div>

      {/* Pyramid container — anchor at tip (bottom) */}
      <div
        className={[
          'relative flex flex-col items-center',
          'transition-all duration-400 ease-out',
          entered ? 'translate-y-0 scale-100' : '-translate-y-1 scale-95 opacity-80',
          'group-hover:scale-110 group-hover:-translate-y-0.5',
        ].join(' ')}
      >
        {/* Base glow — soft pulse, hover/breathe */}
        <div
          className={`absolute -bottom-1 left-1/2 -translate-x-1/2 w-16 h-4 rounded-full pointer-events-none ${pyramidGlowClass}`}
          aria-hidden
        />

        {/* Faceted pyramid — gemstone shape */}
        <div className={`relative w-14 h-16 flex items-start justify-center pt-1.5 ${pyramidShapeClass}`}>
          {/* Icon — centered in top facet */}
          <span className="text-base leading-none drop-shadow-[0_0_4px_rgba(0,0,0,0.8)] z-10">
            {icon}
          </span>
        </div>
      </div>

      {/* Optional label tooltip below */}
      {label && (
        <div className="mt-1.5 bg-black/80 backdrop-blur-sm border border-white/10 px-3 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
          <p className="text-[10px] text-white font-bold uppercase tracking-widest">
            {label}
          </p>
        </div>
      )}
    </button>
  );
};

export default JobMarker;
