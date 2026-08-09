/**
 * Store Mode filters — expandable glassmorphic card toggled by the top-left FAB.
 * Keeps the top HUD (menu / notifications) fully clear until the user opens filters.
 */
import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { SlidersHorizontal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  STORE_MAP_FILTERS,
  type StoreMapFilterId,
} from '../src/lib/storeMapFilter';

export type StoreMapFilterChipsProps = {
  selectedFilter: StoreMapFilterId;
  onChange: (id: StoreMapFilterId) => void;
  /** Optional live count for the active filter. */
  resultCount?: number;
  /** Controlled open state (FAB toggle). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const CHIP_BASE =
  'touch-manipulation rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] transition-colors';

const CHIP_IDLE =
  'border-white/15 bg-white/5 text-slate-400 hover:border-white/25 hover:bg-white/10 hover:text-white';

const CHIP_ACTIVE =
  'border-cyan-400 bg-cyan-500/20 text-cyan-300 shadow-[0_0_12px_rgba(0,191,255,0.28)]';

const StoreMapFilterChips: React.FC<StoreMapFilterChipsProps> = ({
  selectedFilter,
  onChange,
  resultCount,
  open,
  onOpenChange,
}) => {
  const { t } = useTranslation();
  const filterActive = selectedFilter !== 'all';

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={`fixed left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[10015] flex h-12 w-12 items-center justify-center rounded-full border transition-transform active:scale-95 ${
          open || filterActive
            ? 'glass-button-neon border-cyan-400 text-white'
            : 'glass-button-neon border-cyan-400/50 text-cyan-200'
        }`}
        aria-label={t('storeFilterBarLabel', { defaultValue: 'Store filters' })}
        aria-expanded={open}
        aria-controls="store-map-filter-card"
      >
        <SlidersHorizontal className="h-5 w-5" strokeWidth={2.25} />
        {filterActive && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border border-black/40 bg-emerald-500 px-1 text-[10px] font-black text-white">
            1
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.button
              type="button"
              key="store-filter-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-[10013] bg-black/25"
              aria-label={t('close', { defaultValue: 'Close' })}
              onClick={() => onOpenChange(false)}
            />
            <motion.div
              key="store-filter-card"
              id="store-map-filter-card"
              role="dialog"
              aria-modal="true"
              aria-label={t('storeFilterBarLabel', { defaultValue: 'Store filters' })}
              initial={{ opacity: 0, y: -12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 380, damping: 28 }}
              className="pointer-events-auto fixed left-4 right-4 top-[max(5rem,calc(env(safe-area-inset-top)+4.25rem))] z-[10014] max-w-md rounded-2xl border border-[rgba(0,191,255,0.4)] p-3 shadow-[0_4px_20px_rgba(0,0,0,0.6),0_0_15px_rgba(0,191,255,0.2)] sm:left-4 sm:right-auto sm:w-full"
              style={{
                background: 'rgba(10, 12, 16, 0.85)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
              }}
            >
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300/90">
                  {t('storeFilterBarLabel', { defaultValue: 'Store filters' })}
                  {typeof resultCount === 'number' ? (
                    <span className="ml-2 tabular-nums text-slate-400">
                      {resultCount}
                    </span>
                  ) : null}
                </p>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label={t('close', { defaultValue: 'Close' })}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
              </div>

              <div
                className="flex flex-wrap gap-2"
                role="toolbar"
                aria-label={t('storeFilterBarLabel', { defaultValue: 'Store filters' })}
              >
                {STORE_MAP_FILTERS.map((opt) => {
                  const active = selectedFilter === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => onChange(opt.id)}
                      aria-pressed={active}
                      className={`${CHIP_BASE} ${active ? CHIP_ACTIVE : CHIP_IDLE}`}
                    >
                      {t(opt.labelKey, { defaultValue: opt.defaultLabel })}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export default StoreMapFilterChips;
