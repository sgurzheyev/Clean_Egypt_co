/**
 * Filter + sort controls for the missions feed.
 *
 * Two layouts share the SAME logic (city closest-hub filter, boost-default sort,
 * emerald eco-tag highlight):
 *  - `inline`   (default): compact expandable bar — used inside Profile / LiveMarketFeed lists.
 *  - `floating`         : round FAB (rounded-full, w-12 h-12) that opens an elegant
 *                          bottom-sheet — used over the fullscreen map so nothing
 *                          overlaps the canvas.
 */
import React, { useEffect, useState } from 'react';
import { SlidersHorizontal, ChevronDown, X, MapPin } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  ALL_MISSION_TAGS,
  MISSION_SORT_MODES,
  MISSION_SORT_LABEL_KEYS,
  type MissionSortMode,
} from '../src/lib/missionFilterSort';
import {
  EGYPT_MARKETPLACE_CITIES,
  MARKETPLACE_ALL_EGYPT_ID,
} from '../src/lib/egyptMarketplace';

/**
 * Eco / community / crowdfunding-focused tags get a distinct green accent so they
 * pop out from the regular home/office cleaning tags.
 */
const ECO_TAGS = new Set([
  '#eco',
  '#beach',
  '#street',
  '#cleanup',
  '#junk',
  '#heavy',
  '#haul',
]);

const SECTION_LABEL =
  'mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400';

export interface MissionFilterPanelProps {
  sortMode: MissionSortMode;
  onSortChange: (mode: MissionSortMode) => void;
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
  resultCount?: number;
  /** When provided, renders a City filter dropdown ("All Cities" + core hubs). */
  cityId?: string;
  onCityChange?: (cityId: string) => void;
  /**
   * Free civic Attention Zone reports (`is_report` / status `reported`).
   * Default true when omitted. Toggle does not close the drawer.
   */
  showFreeReports?: boolean;
  onShowFreeReportsChange?: (show: boolean) => void;
  /**
   * `inline` (default) = compact expandable bar for list views.
   * `floating`        = round FAB + bottom-sheet for the map overlay.
   */
  variant?: 'inline' | 'floating';
}

const MissionFilterPanel: React.FC<MissionFilterPanelProps> = ({
  sortMode,
  onSortChange,
  selectedTags,
  onToggleTag,
  onClearTags,
  resultCount,
  cityId,
  onCityChange,
  showFreeReports = true,
  onShowFreeReportsChange,
  variant = 'inline',
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false); // inline bar
  const [open, setOpen] = useState(false); // floating sheet
  const activeCount = selectedTags.length;
  const showCityFilter = typeof onCityChange === 'function';
  const cityValue = cityId ?? MARKETPLACE_ALL_EGYPT_ID;
  const cityActive = showCityFilter && cityValue !== MARKETPLACE_ALL_EGYPT_ID;
  const showReportsToggle = typeof onShowFreeReportsChange === 'function';
  const reportsMuted = showReportsToggle && !showFreeReports;
  // FAB badge counts every applied constraint (tags + city + muted free reports).
  const badgeCount = activeCount + (cityActive ? 1 : 0) + (reportsMuted ? 1 : 0);

  // Bottom-sheet: lock body scroll + close on Escape while it is open.
  useEffect(() => {
    if (variant !== 'floating' || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [variant, open]);

  const cityOptions = (
    <>
      <option value={MARKETPLACE_ALL_EGYPT_ID} className="bg-slate-900 text-slate-100">
        {t('marketplaceCityAll')}
      </option>
      {EGYPT_MARKETPLACE_CITIES.map((c) => (
        <option key={c.id} value={c.id} className="bg-slate-900 text-slate-100">
          {t(c.nameKey)}
        </option>
      ))}
    </>
  );

  // Shared renderers — identical behaviour in both layouts; equal-size grid cells.
  const renderSortButtons = () =>
    MISSION_SORT_MODES.map((mode) => {
      const active = sortMode === mode;
      return (
        <button
          key={mode}
          type="button"
          aria-pressed={active}
          onClick={() => onSortChange(mode)}
          className={`flex min-h-[2.75rem] w-full items-center justify-center rounded-xl border px-3 py-2 text-center text-[11px] font-bold leading-snug tracking-wide transition-colors ${
            active
              ? 'border-cyan-400/60 bg-cyan-500/25 text-cyan-100'
              : 'border-white/12 bg-white/5 text-slate-300 hover:border-white/25 hover:text-slate-100'
          }`}
        >
          {t(MISSION_SORT_LABEL_KEYS[mode])}
        </button>
      );
    });

  const renderTagButtons = () =>
    ALL_MISSION_TAGS.map((tag) => {
      const checked = selectedTags.includes(tag);
      const isEco = ECO_TAGS.has(tag.toLowerCase());
      const className = isEco
        ? checked
          ? 'border-emerald-400 bg-emerald-500/30 text-emerald-50 shadow-[0_0_10px_rgba(16,185,129,0.25)]'
          : 'border-emerald-500 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
        : checked
          ? 'border-cyan-400/60 bg-cyan-500/25 text-cyan-100'
          : 'border-white/12 bg-white/5 text-slate-300 hover:border-white/25 hover:text-slate-100';
      return (
        <button
          key={tag}
          type="button"
          role="checkbox"
          aria-checked={checked}
          onClick={() => onToggleTag(tag)}
          className={`inline-flex min-h-[2rem] items-center justify-center rounded-full border px-3 py-1.5 text-[11px] font-bold lowercase tracking-wide transition-colors ${className}`}
        >
          {isEco && <span aria-hidden>🌿 </span>}
          {tag}
        </button>
      );
    });

  const renderFreeReportsToggle = () => {
    if (!showReportsToggle) return null;
    const active = showFreeReports;
    return (
      <section>
        <p className={SECTION_LABEL}>
          {t('missionTypesLabel', { defaultValue: 'Mission types' })}
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={active}
          onClick={() => onShowFreeReportsChange?.(!showFreeReports)}
          className={`flex w-full min-h-[2.75rem] items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-center text-[11px] font-medium leading-snug tracking-wide transition-all active:scale-[0.99] ${
            active
              ? 'border border-rose-500/50 bg-rose-500/20 text-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.3)]'
              : 'border border-white/5 bg-white/5 text-gray-500 opacity-60'
          }`}
        >
          <span aria-hidden>⚠️</span>
          <span>
            {t('filterAttentionZones', {
              defaultValue: 'Attention Zones (Free Reports)',
            })}
          </span>
        </button>
      </section>
    );
  };

  // ── Floating layout: round FAB (top-left) + elegant bottom-sheet ──────────────
  if (variant === 'floating') {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[10015] flex h-12 w-12 items-center justify-center rounded-full border border-cyan-400/50 bg-black/70 text-cyan-200 shadow-[0_0_18px_rgba(34,211,238,0.28)] backdrop-blur-lg transition-transform active:scale-95"
          aria-label={t('filtersLabel')}
          aria-expanded={open}
        >
          <SlidersHorizontal className="h-5 w-5" strokeWidth={2.25} />
          {badgeCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border border-black/40 bg-emerald-500 px-1 text-[10px] font-black text-white">
              {badgeCount}
            </span>
          )}
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              className="fixed inset-0 z-[10070] flex items-end justify-center sm:items-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={() => setOpen(false)}
                aria-hidden
              />

              <motion.div
                role="dialog"
                aria-modal="true"
                aria-label={t('filtersLabel')}
                className="relative w-full max-w-md overflow-hidden rounded-t-2xl border-t border-white/10 bg-[#0A0A12]/95 shadow-[0_-8px_50px_rgba(0,0,0,0.6)] backdrop-blur-xl sm:rounded-3xl sm:border"
                style={{ maxHeight: 'min(85dvh, 85vh)' }}
                initial={{ y: '100%', opacity: 0.6 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: '100%', opacity: 0.4 }}
                transition={{ type: 'spring', damping: 32, stiffness: 320 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className="flex max-h-[inherit] flex-col overflow-y-auto overscroll-contain touch-pan-y"
                  style={{
                    maxHeight: 'min(85dvh, 85vh)',
                    WebkitOverflowScrolling: 'touch',
                  }}
                  onTouchMove={(e) => e.stopPropagation()}
                >
                  {/* Sticky chrome — stays pinned while the body scrolls */}
                  <div className="sticky top-0 z-10 shrink-0 border-b border-white/10 bg-[#0A0A12]/95 backdrop-blur-xl">
                    <div className="flex justify-center pt-3 sm:hidden" aria-hidden>
                      <span className="h-1.5 w-10 rounded-full bg-white/20" />
                    </div>
                    <div className="flex items-center justify-between gap-3 p-4 pt-3">
                      <div className="min-w-0">
                        <p className="text-[12px] font-black uppercase tracking-[0.2em] text-cyan-300">
                          {t('filtersLabel')}
                        </p>
                        {typeof resultCount === 'number' && (
                          <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                            {t('resultsCount', { count: resultCount })}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setOpen(false)}
                        aria-label={t('close', { defaultValue: 'Close' })}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        <X className="h-4 w-4" strokeWidth={2.25} />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-6 p-4 pb-12">
                    {showCityFilter && (
                      <section>
                        <p className={SECTION_LABEL}>{t('selectCity')}</p>
                        <div className="relative">
                          <MapPin
                            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-300"
                            strokeWidth={2.25}
                            aria-hidden
                          />
                          <select
                            value={cityValue}
                            onChange={(e) => onCityChange?.(e.target.value)}
                            aria-label={t('selectCity')}
                            className="w-full appearance-none rounded-xl border border-emerald-400/30 bg-emerald-500/10 py-2.5 pl-9 pr-9 text-sm font-bold text-emerald-100 outline-none transition-colors focus:border-emerald-400/60"
                          >
                            {cityOptions}
                          </select>
                          <ChevronDown
                            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-300/70"
                            aria-hidden
                          />
                        </div>
                      </section>
                    )}

                    <section>
                      <p className={SECTION_LABEL}>{t('sortByLabel')}</p>
                      <div className="grid grid-cols-2 gap-2">{renderSortButtons()}</div>
                    </section>

                    <section>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className={`${SECTION_LABEL} mb-0`}>{t('filterByTags')}</p>
                        {activeCount > 0 && (
                          <button
                            type="button"
                            onClick={onClearTags}
                            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 hover:text-slate-200"
                          >
                            <X className="h-3 w-3" strokeWidth={2.5} />
                            {t('clearFilters')}
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">{renderTagButtons()}</div>
                    </section>

                    {renderFreeReportsToggle()}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  }

  // ── Inline layout (default): single-row header with horizontal scroll ─────────
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/70 backdrop-blur-md">
      <div className="ce-hide-scrollbar flex items-center gap-2 overflow-x-auto whitespace-nowrap p-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-cyan-200 transition-colors hover:bg-cyan-500/20"
          aria-expanded={expanded}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2.25} />
          {t('filtersLabel')}
          {activeCount > 0 && (
            <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-400 px-1 text-[9px] font-black text-slate-950">
              {activeCount}
            </span>
          )}
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
            strokeWidth={2.25}
          />
        </button>

        {showCityFilter && (
          <div className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-emerald-400/30 bg-emerald-500/10 pl-2">
            <MapPin className="h-3.5 w-3.5 text-emerald-300" strokeWidth={2.25} aria-hidden />
            <label className="sr-only" htmlFor="mission-city-select">
              {t('selectCity')}
            </label>
            <select
              id="mission-city-select"
              value={cityValue}
              onChange={(e) => onCityChange?.(e.target.value)}
              className="max-w-[9.5rem] rounded-lg border-0 bg-transparent px-1 py-1.5 text-[11px] font-bold text-emerald-100 outline-none focus:ring-0"
            >
              {cityOptions}
            </select>
          </div>
        )}

        <label className="sr-only" htmlFor="mission-sort-select">
          {t('sortByLabel')}
        </label>
        <select
          id="mission-sort-select"
          value={sortMode}
          onChange={(e) => onSortChange(e.target.value as MissionSortMode)}
          className="ml-auto shrink-0 rounded-lg border border-white/15 bg-slate-950/80 px-2 py-1.5 text-[11px] font-bold text-slate-100 outline-none focus:border-cyan-400/50"
        >
          {MISSION_SORT_MODES.map((mode) => (
            <option key={mode} value={mode} className="bg-slate-900 text-slate-100">
              {t(MISSION_SORT_LABEL_KEYS[mode])}
            </option>
          ))}
        </select>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-white/10 p-3">
          <div>
            <p className={SECTION_LABEL}>{t('sortByLabel')}</p>
            <div className="grid grid-cols-2 gap-2">{renderSortButtons()}</div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className={`${SECTION_LABEL} mb-0`}>{t('filterByTags')}</p>
              {activeCount > 0 && (
                <button
                  type="button"
                  onClick={onClearTags}
                  className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 hover:text-slate-200"
                >
                  <X className="h-3 w-3" strokeWidth={2.5} />
                  {t('clearFilters')}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">{renderTagButtons()}</div>
          </div>

          {renderFreeReportsToggle()}

          {typeof resultCount === 'number' && (
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
              {t('resultsCount', { count: resultCount })}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default MissionFilterPanel;
