import React, { useEffect, useMemo, useState } from 'react';
import { formatEgpDigits } from '../src/lib/formatMoney';

export interface MissionMarkerProps {
  /** Funded amount shown in the capsule (EGP). */
  currentFundingEgp: number;
  /** Mission goal — drives neon intensity. */
  targetEgp: number;
  orderType: 'home' | 'city';
  label?: string;
  onClick?: (e: React.MouseEvent) => void;
  isDraft?: boolean;
  isActive?: boolean;
  bidCount?: number;
  variant?: 'default' | 'in_progress' | 'completed';
}

/**
 * Cyberpunk glass capsule marker — funding in EGP, neon border scales with progress.
 */
const MissionMarker: React.FC<MissionMarkerProps> = ({
  currentFundingEgp,
  targetEgp,
  orderType,
  label,
  onClick,
  isDraft = false,
  isActive = false,
  bidCount = 0,
  variant = 'default',
}) => {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const isHome = orderType === 'home';
  const icon =
    variant === 'completed' ? '⭐' : isDraft ? '📍' : isActive ? '▶' : isHome ? '🏠' : '🌆';

  const scale = isDraft ? 1 : 0.72 + (Math.min(currentFundingEgp, 5000) / 5000) * 0.35;

  const { borderColor, glowRgb, glowStrength } = useMemo(() => {
    if (isDraft) {
      /** Draft / NEW pin — vivid violet–magenta so it reads clearly vs calmer live pins. */
      return {
        borderColor: 'hsl(285 92% 62%)',
        glowRgb: '186,104,255',
        glowStrength: 1.15,
      };
    }
    const target = Math.max(targetEgp, 1);
    const funded = Math.max(0, currentFundingEgp);
    const ratio = Math.min(1, funded / target);
    const hue = 165 + ratio * 155;
    const bc = `hsl(${hue} 95% 58%)`;
    const r = Math.round(34 + ratio * 200);
    const g = Math.round(211 - ratio * 80);
    const b = Math.round(238 - ratio * 100);
    /** Live missions on the map: same capsule, softer halo than draft so pins feel less “noisy”. */
    const isCalmLive = variant === 'default' && !isActive;
    const strength = isCalmLive ? 0.58 : 1;
    return { borderColor: bc, glowRgb: `${r},${g},${b}`, glowStrength: strength };
  }, [currentFundingEgp, targetEgp, isDraft, isActive, variant]);

  const fundingWhole = Math.round(Number(currentFundingEgp) || 0);

  const capsuleInner =
    isDraft ? (
      <span className="font-black tracking-tight">NEW</span>
    ) : variant === 'completed' ? (
      <span className="font-black tracking-tight">{label || 'DONE'}</span>
    ) : isActive ? (
      <span className="font-black tracking-tight">{label || 'MY MISSION'}</span>
    ) : (
      <span className="inline-flex items-baseline gap-0.5">
        <span className="font-mono font-bold text-[11px] tabular-nums tracking-tight">{formatEgpDigits(fundingWhole)}</span>
        <span className="text-[8px] font-bold uppercase tracking-wide text-white/90">EGP</span>
      </span>
    );

  const gs = glowStrength;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!isDraft) onClick?.(e);
      }}
      className="mission-marker-cyber-root relative z-[10] isolate flex flex-col items-center group select-none outline-none border-0 p-0 bg-transparent origin-bottom"
      style={{
        transform: `scale(${scale})`,
        transformOrigin: 'bottom center',
      }}
      aria-label={`Mission funding ${formatEgpDigits(currentFundingEgp)} EGP`}
    >
      <div
        className={[
          'mission-marker-cyber-capsule',
          'relative z-[1] mb-0.5 min-w-[3.25rem] px-2.5 py-1.5 rounded-full',
          'backdrop-blur-[8px] bg-white/12 border-2 border-solid',
          'text-[10px] tracking-tight text-white',
          'transition-all duration-300 ease-out',
          entered ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
          'group-hover:scale-105',
        ].join(' ')}
        style={{
          borderColor,
          boxShadow: `0 0 ${Math.round(15 * gs)}px rgba(${glowRgb}, ${0.5 * gs}), 0 0 ${Math.round(8 * gs)}px rgba(${glowRgb}, ${0.35 * gs}), 0 0 ${Math.round(4 * gs)}px rgba(${glowRgb}, ${0.85 * gs}), inset 0 1px 0 rgba(255,255,255,0.14)`,
        }}
      >
        <span className="inline-flex items-center gap-1 whitespace-nowrap drop-shadow-[0_0_8px_rgba(0,0,0,0.9)]">
          {capsuleInner}
          {!isDraft && !isActive && bidCount > 0 && (
            <span className="text-[9px] font-black opacity-95 text-cyan-200 font-mono">{`+${bidCount}`}</span>
          )}
        </span>
      </div>

      <div
        className={[
          'relative flex flex-col items-center transition-all duration-400 ease-out',
          entered ? 'translate-y-0 scale-100' : '-translate-y-1 scale-95 opacity-80',
          'group-hover:scale-110 group-hover:-translate-y-0.5',
        ].join(' ')}
      >
        <div
          className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-9 h-2 rounded-full pointer-events-none opacity-80"
          style={{
            background: `radial-gradient(ellipse, rgba(${glowRgb},${0.55 * gs}) 0%, transparent 70%)`,
            filter: 'blur(2px)',
          }}
          aria-hidden
        />
        <div
          className={[
            'relative w-7 h-9 flex items-start justify-center pt-0.5 rounded-sm',
            isHome ? 'bg-gradient-to-b from-amber-500/25 to-slate-950/90 border border-amber-500/40' : 'bg-gradient-to-b from-emerald-500/25 to-slate-950/90 border border-emerald-500/40',
            variant === 'completed' && 'from-fuchsia-500/30 border-fuchsia-400/50',
            variant === 'in_progress' && 'from-cyan-500/30 border-cyan-400/50',
          ].join(' ')}
        >
          <span className="text-[10px] leading-none drop-shadow-[0_0_2px_rgba(0,0,0,0.9)] z-[1]">{icon}</span>
        </div>
      </div>

      {label && !isDraft && (
        <div className="mt-1.5 bg-black/80 backdrop-blur-sm border border-white/10 px-3 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-[10]">
          <p className="text-[10px] text-white font-bold uppercase tracking-widest">{label}</p>
        </div>
      )}
    </button>
  );
};

export default MissionMarker;
