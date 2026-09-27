/**
 * Fun / cartoon map toggle — stylized land and neon roads only.
 * No live craft, weather, or peek card.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';

/** Faint idle chip. Active cartoon mode uses the same footprint with cyan ink. */
export const MAP_DEBUG_CHIP_IDLE_CLASS =
  'pointer-events-auto rounded-md border border-white/10 bg-black/40 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-500/80 opacity-40 hover:opacity-90 hover:text-cyan-200';

const FUN_CHIP_ON_CLASS =
  'pointer-events-auto inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-md border border-cyan-400/60 bg-cyan-500/25 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-cyan-50 opacity-100 shadow-[0_0_10px_rgba(34,211,238,0.4)]';

export function funChipClass(on: boolean): string {
  return on ? FUN_CHIP_ON_CLASS : MAP_DEBUG_CHIP_IDLE_CLASS;
}

export type MapFunModeControlsProps = {
  on: boolean;
  onChange: (on: boolean) => void;
};

const MapFunModeControls: React.FC<MapFunModeControlsProps> = ({ on, onChange }) => {
  const { t } = useTranslation();
  const label = t('funMapMode', { defaultValue: 'FUN' });

  return (
    <div className="pointer-events-auto relative shrink-0">
      <button
        type="button"
        onClick={() => onChange(!on)}
        data-fun-map={on ? 'on' : 'off'}
        className={funChipClass(on)}
        aria-label={label}
        aria-pressed={on}
        title={label}
      >
        <span>{label}</span>
      </button>
    </div>
  );
};

export default MapFunModeControls;
