/**
 * Floating weather debug panel (dev / ?weatherDebug=1 / localStorage).
 * Auto (Live) uses Open-Meteo for the map center.
 */
import React from 'react';
import type { MapWeatherMode } from '../lib/mapWeather';
import {
  WEATHER_CONTROL_LABELS,
  WEATHER_CONTROL_MODES,
  type WeatherControlMode,
} from '../lib/openMeteoWeather';

type WeatherDebugPanelProps = {
  control: WeatherControlMode;
  effectiveWeather: MapWeatherMode;
  onChange: (mode: WeatherControlMode) => void;
  liveLoading?: boolean;
  liveError?: string | null;
  liveHint?: string | null;
  onHide?: () => void;
};

const WeatherDebugPanel: React.FC<WeatherDebugPanelProps> = ({
  control,
  effectiveWeather,
  onChange,
  liveLoading,
  liveError,
  liveHint,
  onHide,
}) => {
  return (
    <div className="pointer-events-auto absolute left-3 bottom-[max(2.25rem,calc(env(safe-area-inset-bottom)+2rem))] z-[40] max-w-[min(100vw-1.5rem,16rem)] rounded-2xl border border-white/15 bg-slate-950/85 p-2.5 shadow-xl backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
        <p className="text-[9px] font-black uppercase tracking-[0.18em] text-amber-200/90">
          Weather debug
        </p>
        {onHide && (
          <button
            type="button"
            onClick={onHide}
            className="text-[9px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-300"
          >
            Hide
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {WEATHER_CONTROL_MODES.map((mode) => {
          const active = control === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onChange(mode)}
              className={`rounded-xl px-3 py-2 text-left text-[11px] font-semibold transition-colors ${
                active
                  ? 'border border-amber-400/40 bg-amber-500/20 text-amber-50'
                  : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              {WEATHER_CONTROL_LABELS[mode]}
            </button>
          );
        })}
      </div>
      <p className="mt-2 px-0.5 text-[10px] text-slate-500">
        Active:{' '}
        <span className="font-semibold text-slate-300">{effectiveWeather}</span>
        {control === 'auto' && liveLoading ? ' · fetching…' : null}
      </p>
      {control === 'auto' && liveHint ? (
        <p className="mt-0.5 px-0.5 text-[10px] text-slate-500">{liveHint}</p>
      ) : null}
      {control === 'auto' && liveError ? (
        <p className="mt-1 px-0.5 text-[10px] text-red-300/90">{liveError}</p>
      ) : null}
    </div>
  );
};

export default WeatherDebugPanel;
