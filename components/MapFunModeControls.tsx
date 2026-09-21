/**
 * RUSH FAB: cycle off → ships → planes → off.
 * Peek card (title + one-word chip) lifts then slides back so the map stays visible.
 * Long-press-safe (click/tap only). No property-price HUD.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Palette, Plane, Ship } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cycleRushCraftMode, hasAisstreamApiKey, type RushCraftMode } from '../src/lib/mapFunMode';
import { formatRushFlightChip } from '../src/lib/mapLiveTraffic';

export type MapFunModeControlsProps = {
  mode: RushCraftMode;
  onModeChange: (mode: RushCraftMode) => void;
  flightsCount?: number;
  flightError?: string | null;
  flightsLoading?: boolean;
};

const LIFT_MS = 280;
const PEEK_MS = 720;

const MapFunModeControls: React.FC<MapFunModeControlsProps> = ({
  mode,
  onModeChange,
  flightsCount = 0,
  flightError = null,
  flightsLoading = false,
}) => {
  const { t } = useTranslation();
  const rushOn = mode !== 'off';
  const [cardMounted, setCardMounted] = useState(false);
  const [liftOpen, setLiftOpen] = useState(false);
  const [peekMode, setPeekMode] = useState<Exclude<RushCraftMode, 'off'> | null>(
    mode === 'off' ? null : mode
  );
  const skipPeekRef = useRef(true);
  const hideTimerRef = useRef<number | undefined>(undefined);
  const unmountTimerRef = useRef<number | undefined>(undefined);

  const clearPeekTimers = () => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    if (unmountTimerRef.current) window.clearTimeout(unmountTimerRef.current);
    hideTimerRef.current = undefined;
    unmountTimerRef.current = undefined;
  };

  const retractCard = () => {
    setLiftOpen(false);
    unmountTimerRef.current = window.setTimeout(() => {
      setCardMounted(false);
    }, LIFT_MS);
  };

  const peekCard = (next: Exclude<RushCraftMode, 'off'>) => {
    clearPeekTimers();
    setPeekMode(next);
    setCardMounted(true);
    window.requestAnimationFrame(() => setLiftOpen(true));
    hideTimerRef.current = window.setTimeout(() => {
      retractCard();
    }, PEEK_MS);
  };

  useEffect(() => {
    if (skipPeekRef.current) {
      skipPeekRef.current = false;
      return;
    }
    if (mode === 'off') {
      clearPeekTimers();
      retractCard();
      return;
    }
    peekCard(mode);
    return undefined;
  }, [mode]);

  useEffect(() => {
    return () => clearPeekTimers();
  }, []);

  const cycle = () => {
    onModeChange(cycleRushCraftMode(mode));
  };

  const shipsLive = hasAisstreamApiKey();
  const shipChip = shipsLive
    ? t('liveMapTrafficShip', { defaultValue: 'SHIP' })
    : t('liveMapTrafficShipsOff', { defaultValue: 'ships off' });
  const planeChip = formatRushFlightChip({
    count: flightsCount,
    error: flightError,
    loading: flightsLoading,
  });
  const chip = peekMode === 'planes' ? planeChip : shipChip;

  const fabLabel =
    mode === 'ships'
      ? `${t('liveMapTraffic', { defaultValue: 'RUSH' })} ${shipChip}`
      : mode === 'planes'
        ? `${t('liveMapTraffic', { defaultValue: 'RUSH' })} ${planeChip}`
        : t('liveMapTraffic', { defaultValue: 'RUSH' });

  return (
    <>
      <button
        type="button"
        onClick={cycle}
        className={`fixed left-3 top-[max(11.25rem,calc(env(safe-area-inset-top)+10.5rem))] z-[10015] flex h-12 w-12 flex-col items-center justify-center rounded-full border backdrop-blur-lg transition-transform active:scale-95 ${
          rushOn
            ? mode === 'planes'
              ? 'border-lime-400 bg-lime-500/90 text-white shadow-[0_0_22px_rgba(74,222,128,0.5)]'
              : shipsLive
                ? 'border-amber-400 bg-amber-500/90 text-white shadow-[0_0_22px_rgba(245,158,11,0.5)]'
                : 'border-amber-400/40 bg-black/70 text-amber-200/80 shadow-[0_0_14px_rgba(245,158,11,0.18)]'
            : 'border-fuchsia-400/50 bg-black/70 text-fuchsia-200 shadow-[0_0_18px_rgba(217,70,239,0.28)]'
        }`}
        aria-label={fabLabel}
        aria-pressed={rushOn}
        title={fabLabel}
      >
        {mode === 'planes' ? (
          <Plane className="h-4 w-4" strokeWidth={2.25} aria-hidden />
        ) : mode === 'ships' ? (
          <Ship className="h-4 w-4" strokeWidth={2.25} aria-hidden />
        ) : (
          <Palette className="h-5 w-5" strokeWidth={2.25} aria-hidden />
        )}
        {rushOn ? (
          <span className="mt-0.5 max-w-[44px] truncate text-[6px] font-black uppercase leading-none tracking-[0.08em]">
            {mode === 'planes'
              ? planeChip
              : shipChip}
          </span>
        ) : null}
      </button>

      {cardMounted && peekMode ? (
        <div
          className={`fixed left-[4.5rem] top-[max(11.25rem,calc(env(safe-area-inset-top)+10.5rem))] z-[10015] origin-left rounded-2xl border border-cyan-400/25 bg-slate-950/80 px-3 py-2 shadow-[0_8px_28px_rgba(34,211,238,0.16)] backdrop-blur-xl transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            liftOpen
              ? 'translate-x-0 scale-y-100 opacity-100'
              : 'pointer-events-none -translate-x-1 scale-y-0 opacity-0'
          }`}
          style={{ transformOrigin: '0% 50%' }}
          role="status"
          aria-label={fabLabel}
        >
          <div className="flex min-h-[36px] items-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-2.5 py-1.5">
            {peekMode === 'planes' ? (
              <Plane className="h-3.5 w-3.5 shrink-0 text-lime-300" strokeWidth={2.25} aria-hidden />
            ) : (
              <Ship className="h-3.5 w-3.5 shrink-0 text-amber-300" strokeWidth={2.25} aria-hidden />
            )}
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100">
              {t('liveMapTraffic', { defaultValue: 'RUSH' })}
            </span>
            <span
              className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] ${
                peekMode === 'planes'
                  ? 'bg-lime-400/20 text-lime-200'
                  : shipsLive
                    ? 'bg-amber-400/20 text-amber-200'
                    : 'bg-white/10 text-slate-200'
              }`}
            >
              {chip}
            </span>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default MapFunModeControls;
