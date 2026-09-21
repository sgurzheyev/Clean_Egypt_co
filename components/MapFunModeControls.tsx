/**
 * RUSH FAB + lift card. One control toggles open↔closed (fun land + live craft).
 * Long-press-safe (click/tap only). No property-price HUD.
 */
import React, { useEffect, useState } from 'react';
import { Palette, Plane, Ship } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type MapFunModeControlsProps = {
  funMapMode: boolean;
  liveTraffic: boolean;
  onFunMapModeChange: (on: boolean) => void;
  onLiveTrafficChange: (on: boolean) => void;
  shipsHint: 'need-key' | 'live' | 'off';
  flightsError?: string | null;
  flightsCount?: number;
  shipsCount?: number;
  flightsLoading?: boolean;
};

const LIFT_MS = 280;

const MapFunModeControls: React.FC<MapFunModeControlsProps> = ({
  funMapMode,
  liveTraffic,
  onFunMapModeChange,
  onLiveTrafficChange,
  shipsHint,
  flightsError,
  flightsCount = 0,
  shipsCount = 0,
  flightsLoading = false,
}) => {
  const { t } = useTranslation();
  const rushOn = funMapMode;
  const [cardMounted, setCardMounted] = useState(funMapMode);
  const [liftOpen, setLiftOpen] = useState(funMapMode);

  useEffect(() => {
    if (funMapMode) {
      setCardMounted(true);
      const id = window.requestAnimationFrame(() => setLiftOpen(true));
      return () => window.cancelAnimationFrame(id);
    }
    setLiftOpen(false);
    const timer = window.setTimeout(() => setCardMounted(false), LIFT_MS);
    return () => window.clearTimeout(timer);
  }, [funMapMode]);

  const toggleRush = () => {
    const next = !funMapMode;
    onFunMapModeChange(next);
    onLiveTrafficChange(next);
  };

  const statusText = (() => {
    if (flightsError) return flightsError;
    if (flightsLoading && flightsCount === 0 && shipsCount === 0) {
      return t('liveMapTrafficLoading', { defaultValue: '…' });
    }
    if (flightsCount + shipsCount === 0) {
      return t('liveMapTrafficEmpty', { defaultValue: 'empty' });
    }
    return `${flightsCount} · ${shipsCount}`;
  })();

  const hint =
    shipsHint === 'need-key'
      ? t('liveMapTrafficShipsOff', { defaultValue: 'ships off' })
      : t('liveMapTrafficHint', { defaultValue: 'plane or ship only!' });

  return (
    <>
      <button
        type="button"
        onClick={toggleRush}
        className={`fixed left-3 top-[max(11.25rem,calc(env(safe-area-inset-top)+10.5rem))] z-[10015] flex h-12 w-12 items-center justify-center rounded-full border backdrop-blur-lg transition-transform active:scale-95 ${
          rushOn
            ? 'border-fuchsia-400 bg-fuchsia-500/90 text-white shadow-[0_0_22px_rgba(217,70,239,0.55)]'
            : 'border-fuchsia-400/50 bg-black/70 text-fuchsia-200 shadow-[0_0_18px_rgba(217,70,239,0.28)]'
        }`}
        aria-label={t('liveMapTraffic', { defaultValue: 'RUSH' })}
        aria-pressed={rushOn}
        aria-expanded={rushOn}
        title={t('liveMapTraffic', { defaultValue: 'RUSH' })}
      >
        <Palette className="h-5 w-5" strokeWidth={2.25} aria-hidden />
      </button>

      {cardMounted && (
        <div
          className={`fixed left-[4.5rem] top-[max(11.25rem,calc(env(safe-area-inset-top)+10.5rem))] z-[10015] max-w-[min(14.5rem,calc(100vw-6rem))] origin-left rounded-2xl border border-cyan-400/25 bg-slate-950/80 px-3 py-2 shadow-[0_8px_28px_rgba(34,211,238,0.16)] backdrop-blur-xl transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            liftOpen
              ? 'translate-x-0 scale-y-100 opacity-100'
              : 'pointer-events-none -translate-x-1 scale-y-0 opacity-0'
          }`}
          style={{ transformOrigin: '0% 50%' }}
          role="group"
          aria-label={t('liveMapTraffic', { defaultValue: 'RUSH' })}
        >
          <button
            type="button"
            onClick={toggleRush}
            className={`flex min-h-[36px] w-full items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition-colors ${
              liveTraffic || funMapMode
                ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-100'
                : 'border-white/10 bg-white/5 text-slate-300'
            }`}
            aria-pressed={rushOn}
          >
            <Plane className="h-3.5 w-3.5 shrink-0 text-lime-300" strokeWidth={2.25} aria-hidden />
            <span className="text-[10px] font-black uppercase tracking-[0.18em]">
              {t('liveMapTraffic', { defaultValue: 'RUSH' })}
            </span>
            <Ship className="ml-auto h-3.5 w-3.5 shrink-0 text-amber-300" strokeWidth={2.25} aria-hidden />
          </button>
          <p className="mt-1.5 text-[9px] font-semibold leading-snug tracking-wide text-slate-200">
            {hint}
          </p>
          <p className="mt-0.5 text-[9px] uppercase tracking-[0.16em] text-slate-500">
            {t('liveMapTrafficGesture', { defaultValue: 'press · look · closed' })}
          </p>
          <p className="mt-1 text-[9px] font-semibold tabular-nums leading-snug text-slate-400">
            {statusText}
          </p>
        </div>
      )}
    </>
  );
};

export default MapFunModeControls;
