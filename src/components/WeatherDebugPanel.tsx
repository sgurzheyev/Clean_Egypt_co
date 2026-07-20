/**
 * Floating weather debug panel (dev / ?weatherDebug=1 / localStorage).
 */
import React from 'react';
import {
  MAP_WEATHER_LABELS,
  MAP_WEATHER_MODES,
  type MapWeatherMode,
} from '../lib/mapWeather';

type WeatherDebugPanelProps = {
  weather: MapWeatherMode;
  onChange: (mode: MapWeatherMode) => void;
  onHide?: () => void;
};

const WeatherDebugPanel: React.FC<WeatherDebugPanelProps> = ({
  weather,
  onChange,
  onHide,
}) => {
  return (
    <div className="pointer-events-auto absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[40] max-w-[min(100vw-1.5rem,16rem)] rounded-2xl border border-white/15 bg-slate-950/85 p-2.5 shadow-xl backdrop-blur-md">
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
        {MAP_WEATHER_MODES.map((mode) => {
          const active = weather === mode;
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
              {MAP_WEATHER_LABELS[mode]}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default WeatherDebugPanel;
