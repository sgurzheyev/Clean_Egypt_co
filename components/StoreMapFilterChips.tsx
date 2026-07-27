/**
 * Horizontal neon filter chips for Store Mode on the interactive map.
 */
import React, { useCallback, useRef } from 'react';
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
  className?: string;
};

const CHIP_BASE =
  'shrink-0 touch-manipulation rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] transition-colors';

const CHIP_IDLE =
  'border-gray-800/80 bg-black/60 text-gray-400 shadow-lg backdrop-blur-md hover:bg-white/5 hover:text-white';

const CHIP_ACTIVE =
  'border-cyan-500 bg-cyan-950/40 text-cyan-400 shadow-[0_0_10px_rgba(0,191,255,0.3)] backdrop-blur-md';

const StoreMapFilterChips: React.FC<StoreMapFilterChipsProps> = ({
  selectedFilter,
  onChange,
  resultCount,
  className = '',
}) => {
  const { t } = useTranslation();
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const clampScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    if (el.scrollLeft < 0) el.scrollLeft = 0;
    else if (el.scrollLeft > max) el.scrollLeft = max;
  }, []);

  return (
    <div
      className={`pointer-events-none ${className}`}
      role="toolbar"
      aria-label={t('storeFilterBarLabel', {
        defaultValue: 'Store filters',
      })}
    >
      <div
        ref={scrollerRef}
        onScroll={clampScroll}
        className="pointer-events-auto flex max-w-full gap-2 overflow-x-auto overscroll-x-contain px-1 py-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
              {active && typeof resultCount === 'number' ? (
                <span className="ml-1.5 tabular-nums text-cyan-300/90">
                  {resultCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default StoreMapFilterChips;
