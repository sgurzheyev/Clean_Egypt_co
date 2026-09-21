/**
 * Fun map FAB + live traffic chip. Long-press-safe (click/tap only).
 * No property-price HUD.
 */
import React from 'react';
import { Palette, Plane, Ship } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type MapFunModeControlsProps = {
  funMapMode: boolean;
  liveTraffic: boolean;
  onFunMapModeChange: (on: boolean) => void;
  onLiveTrafficChange: (on: boolean) => void;
  shipsHint: 'need-key' | 'live' | 'off';
  flightsError?: string | null;
};

const MapFunModeControls: React.FC<MapFunModeControlsProps> = ({
  funMapMode,
  liveTraffic,
  onFunMapModeChange,
  onLiveTrafficChange,
  shipsHint,
  flightsError,
}) => {
  const { t } = useTranslation();
  const trafficOn = funMapMode || liveTraffic;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          const next = !funMapMode;
          onFunMapModeChange(next);
          if (next && !liveTraffic) onLiveTrafficChange(true);
        }}
        className={`fixed left-3 top-[max(11.25rem,calc(env(safe-area-inset-top)+10.5rem))] z-[10015] flex h-12 w-12 items-center justify-center rounded-full border backdrop-blur-lg transition-transform active:scale-95 ${
          funMapMode
            ? 'border-fuchsia-400 bg-fuchsia-500/90 text-white shadow-[0_0_22px_rgba(217,70,239,0.55)]'
            : 'border-fuchsia-400/50 bg-black/70 text-fuchsia-200 shadow-[0_0_18px_rgba(217,70,239,0.28)]'
        }`}
        aria-label={t('funMapMode', { defaultValue: 'Fun map' })}
        aria-pressed={funMapMode}
        title={t('funMapMode', { defaultValue: 'Fun map' })}
      >
        <Palette className="h-5 w-5" strokeWidth={2.25} aria-hidden />
      </button>

      {funMapMode && (
        <div
          className="fixed left-[4.5rem] top-[max(11.25rem,calc(env(safe-area-inset-top)+10.5rem))] z-[10015] max-w-[min(16.5rem,calc(100vw-6rem))] rounded-2xl border border-cyan-400/25 bg-slate-950/80 px-3 py-2 shadow-[0_8px_28px_rgba(34,211,238,0.16)] backdrop-blur-xl"
          role="group"
          aria-label={t('liveMapTraffic', { defaultValue: 'Live traffic' })}
        >
          <button
            type="button"
            onClick={() => onLiveTrafficChange(!liveTraffic)}
            className={`flex min-h-[36px] w-full items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition-colors ${
              trafficOn
                ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-100'
                : 'border-white/10 bg-white/5 text-slate-300'
            }`}
            aria-pressed={liveTraffic}
          >
            <Plane className="h-3.5 w-3.5 shrink-0 text-cyan-300" strokeWidth={2.25} aria-hidden />
            <span className="text-[10px] font-black uppercase tracking-[0.14em]">
              {t('liveMapTraffic', { defaultValue: 'Live traffic' })}
            </span>
          </button>
          <p className="mt-1.5 flex items-start gap-1.5 text-[9px] leading-snug text-slate-400">
            <Ship className="mt-0.5 h-3 w-3 shrink-0 text-violet-300" strokeWidth={2.25} aria-hidden />
            <span>
              {shipsHint === 'need-key'
                ? t('liveMapTrafficShipsOff', {
                    defaultValue:
                      'Ships off — add a free AISStream key (aisstream.io) as VITE_AISSTREAM_API_KEY.',
                  })
                : shipsHint === 'live'
                  ? t('liveMapTrafficShipsOn', {
                      defaultValue: 'Ships live via AISStream.',
                    })
                  : t('liveMapTrafficHint', {
                      defaultValue: 'Planes from OpenSky. Ships need a free AISStream key.',
                    })}
            </span>
          </p>
          {flightsError ? (
            <p className="mt-1 text-[9px] leading-snug text-amber-200/80">{flightsError}</p>
          ) : null}
        </div>
      )}
    </>
  );
};

export default MapFunModeControls;
