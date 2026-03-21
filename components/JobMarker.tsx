import React, { useEffect, useState } from 'react';
import { formatEgp } from '../src/lib/formatMoney';

interface JobMarkerProps {
  amount: number;
  orderType: 'home' | 'city';
  label?: string;
  onClick?: (e: React.MouseEvent) => void;
  isDraft?: boolean;
  isActive?: boolean;
  bidCount?: number;
  variant?: 'default' | 'in_progress' | 'completed';
  vipAvatarUrl?: string | null;
  vipVerified?: boolean;
}

const JobMarker: React.FC<JobMarkerProps> = ({
  amount,
  orderType,
  label,
  onClick,
  isDraft = false,
  isActive = false,
  bidCount = 0,
  variant = 'default',
  vipAvatarUrl = null,
  vipVerified = false,
}) => {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const isHome = orderType === 'home';
  const hasVipAvatar = false;
  const showVerifiedBadge = false;
  const icon =
    variant === 'completed'
      ? '⭐'
      : isDraft
        ? '📍'
        : (isHome ? '🏠' : '🌆');

  const scale = isDraft ? 1 : 0.7 + (Math.min(amount, 100) / 100) * 0.8;

  const pyramidShapeClass = isDraft
    ? 'pyramid-shape-draft'
    : variant === 'completed'
      ? 'pyramid-shape-completed'
      : variant === 'in_progress'
        ? 'pyramid-shape-inprogress'
        : (isHome ? 'pyramid-shape-home' : 'pyramid-shape-city'); // default = original

  const pyramidGlowClass = isActive
    ? 'pyramid-glow-active'
    : isDraft
      ? 'pyramid-glow-draft'
      : variant === 'completed'
        ? 'pyramid-glow-completed'
        : variant === 'in_progress'
          ? 'pyramid-glow-inprogress'
          : (isHome ? 'pyramid-glow-home' : 'pyramid-glow-city'); // default glow

  const pillBorderClass = isDraft
    ? 'animated-border-rainbow'
    : variant === 'completed'
      ? 'animated-border-completed'
      : variant === 'in_progress'
        ? 'animated-border-inprogress'
        : (isHome ? 'animated-border-home' : 'animated-border-city'); // default border
  const pillContent = isDraft
    ? 'NEW'
    : variant === 'completed'
      ? (label || 'DONE')
      : isActive
        ? (label || 'MY MISSION')
        : formatEgp(amount);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!isDraft) onClick?.(e);
      }}
      className={`relative flex flex-col items-center group select-none outline-none border-0 p-0 bg-transparent origin-bottom ${isDraft ? 'cursor-default' : 'cursor-pointer'}`}
      style={{ transform: `scale(${scale})`, transformOrigin: 'bottom center' }}
      aria-label={`${orderType} mission ${formatEgp(amount)}`}
    >
      {hasVipAvatar ? (
        <div
          className={[
            'relative flex flex-col items-center',
            'transition-all duration-300 ease-out',
            entered ? 'translate-y-0 scale-100' : '-translate-y-1 scale-95 opacity-80',
            'group-hover:scale-110 group-hover:-translate-y-0.5',
          ].join(' ')}
        >
          <div className="relative w-10 h-10 rounded-full border-2 border-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.6)] bg-slate-950 overflow-hidden transition-transform duration-200 group-hover:scale-110">
            <img
              src={vipAvatarUrl as string}
              alt="VIP avatar"
              className="w-full h-full object-cover"
            />
            {showVerifiedBadge && (
              <div className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full border border-cyan-400/60 bg-cyan-500/15 backdrop-blur flex items-center justify-center shadow-[0_0_12px_rgba(34,211,238,0.45)]">
                <span className="text-[10px] leading-none text-cyan-200">✅</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Floating pill label — task-colored animated border */}
          <div
            className={[
              'absolute -top-0.5 left-1/2 -translate-x-1/2 -translate-y-full z-20',
              'rounded-full',
              pillBorderClass,
              isActive && 'job-marker-active-pill',
              'transition-transform duration-300 ease-out',
              entered ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
              'group-hover:scale-105',
            ].join(' ')}
          >
            <div className="animated-border-inner px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-[0.1em] min-w-[1.75rem] text-orange-400 bg-slate-950">
              <span className="inline-flex items-center gap-1">
                <span>{pillContent}</span>
                {!isDraft && !isActive && bidCount > 0 && (
                  <span className="text-[9px] font-black opacity-90">{`+${bidCount}`}</span>
                )}
              </span>
            </div>
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
              className={`absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-8 h-2 rounded-full pointer-events-none ${pyramidGlowClass}`}
              aria-hidden
            />

            {/* Faceted pyramid — gemstone shape (small base) */}
            <div className={`relative w-7 h-9 flex items-start justify-center pt-0.5 ${pyramidShapeClass} ${isActive ? 'job-marker-active-pyramid' : ''}`}>
              {/* Icon — centered in top facet */}
              <span className="text-[10px] leading-none drop-shadow-[0_0_2px_rgba(0,0,0,0.8)] z-10">
                {icon}
              </span>
            </div>
          </div>
        </>
      )}

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
