/**
 * RUSH control in the bottom-left debug cluster: cycle off → ships → planes → off.
 * Idle uses the same chip as the collapsed WX button (padding, type, radius, faint ink).
 * Ships / planes keep that footprint, then add accent color plus the icon and count.
 * Peek card (title + count chip) lifts then slides back so the map stays visible.
 * Long-press-safe (click/tap only). No property-price HUD.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Plane, Ship } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cycleRushCraftMode, type RushCraftMode } from '../src/lib/mapFunMode';
import { formatRushFlightChip, formatRushShipChip } from '../src/lib/mapLiveTraffic';

/**
 * Collapsed weather chip in MapPicker. Idle RUSH must use this string verbatim
 * so the two controls share footprint and contrast.
 */
export const MAP_DEBUG_CHIP_IDLE_CLASS =
  'pointer-events-auto rounded-md border border-white/10 bg-black/40 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-500/80 opacity-40 hover:opacity-90 hover:text-amber-200';

const RUSH_CHIP_ACTIVE_SIZE =
  'pointer-events-auto inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider opacity-100';

/** Active craft chip: same metrics as the WX chip, with mode color and glow. */
export function rushChipClass(mode: RushCraftMode): string {
  if (mode === 'planes') {
    return `${RUSH_CHIP_ACTIVE_SIZE} border-lime-400/60 bg-lime-500/25 text-lime-50 shadow-[0_0_10px_rgba(163,230,53,0.45)]`;
  }
  if (mode === 'ships') {
    return `${RUSH_CHIP_ACTIVE_SIZE} border-amber-400/60 bg-amber-500/25 text-amber-50 shadow-[0_0_10px_rgba(251,191,36,0.4)]`;
  }
  return MAP_DEBUG_CHIP_IDLE_CLASS;
}

export type MapFunModeControlsProps = {
  mode: RushCraftMode;
  onModeChange: (mode: RushCraftMode) => void;
  flightsCount?: number;
  flightError?: string | null;
  flightsLoading?: boolean;
  shipsCount?: number;
  shipError?: string | null;
  shipsLoading?: boolean;
};

const LIFT_MS = 280;
const PEEK_MS = 720;

const MapFunModeControls: React.FC<MapFunModeControlsProps> = ({
  mode,
  onModeChange,
  flightsCount = 0,
  flightError = null,
  flightsLoading = false,
  shipsCount = 0,
  shipError = null,
  shipsLoading = false,
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

  const shipChip = formatRushShipChip({
    count: shipsCount,
    error: shipError,
    loading: shipsLoading,
  });
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

  const rushLabel = t('liveMapTraffic', { defaultValue: 'RUSH' });

  return (
    <div className="pointer-events-auto relative shrink-0">
      <button
        type="button"
        onClick={cycle}
        data-rush-mode={mode}
        className={rushChipClass(mode)}
        aria-label={fabLabel}
        aria-pressed={rushOn}
        title={fabLabel}
      >
        {mode === 'planes' ? (
          <Plane className="h-2.5 w-2.5 shrink-0" strokeWidth={2.25} aria-hidden />
        ) : mode === 'ships' ? (
          <Ship className="h-2.5 w-2.5 shrink-0" strokeWidth={2.25} aria-hidden />
        ) : null}
        <span>{rushLabel}</span>
        {rushOn ? (
          <span className="max-w-[4.5rem] truncate tabular-nums">
            {mode === 'planes' ? planeChip : shipChip}
          </span>
        ) : null}
      </button>

      {cardMounted && peekMode ? (
        <div className="pointer-events-none absolute left-full top-1/2 z-[2] ml-2 -translate-y-1/2">
          <div
            className={`origin-left w-max rounded-2xl border border-cyan-400/25 bg-slate-950/80 px-3 py-2 shadow-[0_8px_28px_rgba(34,211,238,0.16)] backdrop-blur-xl transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
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
                {rushLabel}
              </span>
              <span
                className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] ${
                  peekMode === 'planes'
                    ? 'bg-lime-400/20 text-lime-200'
                    : 'bg-amber-400/20 text-amber-200'
                }`}
              >
                {chip}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default MapFunModeControls;
