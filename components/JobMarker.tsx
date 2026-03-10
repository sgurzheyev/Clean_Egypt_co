import React, { useEffect, useState } from 'react';

interface JobMarkerProps {
  amount: number;
  orderType: 'home' | 'city';
  label?: string;
}

const JobMarker: React.FC<JobMarkerProps> = ({ amount, orderType, label }) => {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const isHome = orderType === 'home';
  const icon = isHome ? '🏠' : '🌆';
  const glowColor = isHome ? '#FFB800' : '#00F0FF';
  const borderColor = isHome ? 'border-amber-300/80' : 'border-cyan-300/80';
  const pillBg = isHome ? 'bg-amber-400/90 text-black' : 'bg-cyan-400/90 text-black';

  const boxShadow = `0 0 18px ${glowColor}, 0 0 36px ${glowColor}40`;

  return (
    <div className="relative flex flex-col items-center group cursor-pointer">
      {/* Neon glass pin */}
      <div
        className={[
          'relative flex flex-col items-center justify-center',
          'w-11 h-14 rounded-xl',
          'bg-white/10 backdrop-blur-md',
          'border',
          borderColor,
          'transition-all duration-400 ease-out',
          entered ? 'translate-y-0 scale-100' : '-translate-y-1 scale-95',
          'group-hover:-translate-y-1.5 group-hover:scale-105',
        ].join(' ')}
        style={{ boxShadow }}
      >
        {/* Icon */}
        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-black/50 border border-white/20 shadow-[0_0_8px_rgba(0,0,0,0.6)]">
          <span className="text-base leading-none">{icon}</span>
        </div>

        {/* Tail */}
        <div className="absolute -bottom-1 w-3 h-3 bg-white/10 border border-white/30 rotate-45 backdrop-blur-md shadow-[0_0_10px_rgba(0,0,0,0.6)]" />

        {/* Price pill */}
        <div
          className={[
            'absolute -top-2 right-0 translate-x-2',
            'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider',
            pillBg,
            'shadow-[0_0_10px_rgba(0,0,0,0.6)]',
          ].join(' ')}
        >
          ${amount}
        </div>

        {/* Subtle pulsing halo */}
        <div
          className="absolute inset-0 rounded-xl pointer-events-none animate-pulse"
          style={{
            boxShadow: `0 0 20px ${glowColor}40`,
            opacity: 0.4,
          }}
        />
      </div>

      {/* Optional label tooltip below */}
      {label && (
        <div className="mt-2 bg-black/80 backdrop-blur-sm border border-white/10 px-3 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
          <p className="text-[10px] text-white font-bold uppercase tracking-widest">
            {label}
          </p>
        </div>
      )}
    </div>
  );
};

export default JobMarker;
