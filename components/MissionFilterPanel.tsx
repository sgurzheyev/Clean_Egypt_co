/**
 * Filter + sort controls for the missions feed.
 *
 * Two layouts share the SAME logic (global country/city filter, boost-default sort,
 * emerald eco-tag highlight):
 *  - `inline`   (default): compact expandable bar — used inside Profile / LiveMarketFeed lists.
 *  - `floating`         : round FAB that opens an elegant bottom-sheet — used over the map.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { SlidersHorizontal, ChevronDown, X, MapPin, Globe2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  ALL_MISSION_TAGS,
  MISSION_SORT_MODES,
  MISSION_SORT_LABEL_KEYS,
  REPORT_PRIORITY_TAGS,
  isReportFilterTag,
  type MissionSortMode,
} from '../src/lib/missionFilterSort';
import {
  MARKETPLACE_ALL_CITIES_ID,
  MARKETPLACE_ALL_WORLD_ID,
  QUICK_REGION_COUNTRIES,
  isAllCitiesFilter,
  isAllWorldFilter,
  type LocationCatalog,
} from '../src/lib/globalMarketplace';
import {
  STEEL_GLASS_PANEL,
  STEEL_GLASS_PANEL_STYLE,
  BOTTOM_SHEET_MAX_HEIGHT_STYLE,
  BOTTOM_SHEET_SCROLL_PB,
} from '../constants';

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

const SELECT_CLASS =
  'w-full appearance-none rounded-xl border border-emerald-400/30 bg-emerald-500/10 py-2.5 pl-9 pr-9 text-sm font-bold text-emerald-100 outline-none transition-colors focus:border-emerald-400/60';

export interface MissionFilterPanelProps {
  sortMode: MissionSortMode;
  onSortChange: (mode: MissionSortMode) => void;
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
  resultCount?: number;
  /** Country filter (`all_world` | country display name). */
  countryId?: string;
  onCountryChange?: (countryId: string) => void;
  /** City filter (empty = all cities in selected country). */
  cityId?: string;
  onCityChange?: (cityId: string) => void;
  /** Dynamic country/city lists built from loaded missions. */
  locationCatalog?: LocationCatalog;
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
  countryId,
  onCountryChange,
  cityId,
  onCityChange,
  locationCatalog,
  showFreeReports = true,
  onShowFreeReportsChange,
  variant = 'inline',
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(false);
  const activeCount = selectedTags.length;
  const showLocationFilter =
    typeof onCountryChange === 'function' || typeof onCityChange === 'function';
  const countryValue = countryId ?? MARKETPLACE_ALL_WORLD_ID;
  const cityValue = cityId ?? MARKETPLACE_ALL_CITIES_ID;
  const locationActive =
    showLocationFilter &&
    (!isAllWorldFilter(countryValue) || !isAllCitiesFilter(cityValue));
  const showReportsToggle = typeof onShowFreeReportsChange === 'function';
  const reportsMuted = showReportsToggle && !showFreeReports;
  const badgeCount = activeCount + (locationActive ? 1 : 0) + (reportsMuted ? 1 : 0);

  const countries = locationCatalog?.countries ?? [...QUICK_REGION_COUNTRIES];
  const citiesForCountry = useMemo(() => {
    if (!locationCatalog) return [] as string[];
    if (isAllWorldFilter(countryValue)) {
      return locationCatalog.citiesByCountry.__all__ ?? [];
    }
    return locationCatalog.citiesByCountry[countryValue] ?? [];
  }, [locationCatalog, countryValue]);

  const quickCountries = useMemo(() => {
    const fromCatalog = countries.filter((c) =>
      QUICK_REGION_COUNTRIES.some((q) => q.toLowerCase() === c.toLowerCase())
    );
    const seeded = QUICK_REGION_COUNTRIES.filter(
      (q) => !fromCatalog.some((c) => c.toLowerCase() === q.toLowerCase())
    );
    return [...fromCatalog, ...seeded];
  }, [countries]);

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

  const handleCountryChange = (next: string) => {
    onCountryChange?.(next);
    if (!isAllCitiesFilter(cityValue) && onCityChange) {
      const nextCities = isAllWorldFilter(next)
        ? locationCatalog?.citiesByCountry.__all__ ?? []
        : locationCatalog?.citiesByCountry[next] ?? [];
      if (!nextCities.some((c) => c.toLowerCase() === cityValue.toLowerCase())) {
        onCityChange(MARKETPLACE_ALL_CITIES_ID);
      }
    }
  };

  const renderLocationControls = (compact = false) => {
    if (!showLocationFilter) return null;

    const countrySelect = (
      <div className={`relative ${compact ? 'min-w-[7.5rem]' : ''}`}>
        <Globe2
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cyan-300"
          strokeWidth={2.25}
          aria-hidden
        />
        <label className="sr-only" htmlFor="mission-country-select">
          {t('selectCountry', { defaultValue: 'Country' })}
        </label>
        <select
          id="mission-country-select"
          value={countryValue}
          onChange={(e) => handleCountryChange(e.target.value)}
          className={
            compact
              ? 'max-w-[9.5rem] appearance-none rounded-lg border-0 bg-transparent py-1.5 pl-7 pr-6 text-[11px] font-bold text-cyan-100 outline-none focus:ring-0'
              : SELECT_CLASS
          }
        >
          <option value={MARKETPLACE_ALL_WORLD_ID} className="bg-slate-900 text-slate-100">
            {t('marketplaceWorldAll', { defaultValue: 'All World' })}
          </option>
          {countries.map((c) => (
            <option key={c} value={c} className="bg-slate-900 text-slate-100">
              {c}
            </option>
          ))}
        </select>
        {!compact && (
          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-300/70"
            aria-hidden
          />
        )}
      </div>
    );

    const citySelect = (
      <div className={`relative ${compact ? 'min-w-[7rem]' : ''}`}>
        <MapPin
          className={`pointer-events-none absolute ${compact ? 'left-2' : 'left-3'} top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-emerald-300`}
          strokeWidth={2.25}
          aria-hidden
        />
        <label className="sr-only" htmlFor="mission-city-select">
          {t('selectCity')}
        </label>
        <select
          id="mission-city-select"
          value={cityValue}
          onChange={(e) => onCityChange?.(e.target.value)}
          className={
            compact
              ? 'max-w-[9rem] appearance-none rounded-lg border-0 bg-transparent py-1.5 pl-7 pr-5 text-[11px] font-bold text-emerald-100 outline-none focus:ring-0'
              : SELECT_CLASS
          }
        >
          <option value={MARKETPLACE_ALL_CITIES_ID} className="bg-slate-900 text-slate-100">
            {t('marketplaceAllCities', { defaultValue: 'All Cities' })}
          </option>
          {citiesForCountry.map((c) => (
            <option key={c} value={c} className="bg-slate-900 text-slate-100">
              {c}
            </option>
          ))}
        </select>
        {!compact && (
          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-300/70"
            aria-hidden
          />
        )}
      </div>
    );

    if (compact) {
      return (
        <>
          <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-cyan-400/30 bg-cyan-500/10 pl-0.5">
            {countrySelect}
          </div>
          <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-emerald-400/30 bg-emerald-500/10 pl-0.5">
            {citySelect}
          </div>
        </>
      );
    }

    return (
      <section className="space-y-3">
        <div>
          <p className={SECTION_LABEL}>
            {t('selectCountry', { defaultValue: 'Country' })}
          </p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => handleCountryChange(MARKETPLACE_ALL_WORLD_ID)}
              className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] transition-colors ${
                isAllWorldFilter(countryValue)
                  ? 'border-cyan-400/60 bg-cyan-500/25 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.25)]'
                  : 'border-white/12 bg-white/5 text-slate-400 hover:border-white/25 hover:text-slate-200'
              }`}
            >
              {t('marketplaceWorldAll', { defaultValue: 'All World' })}
            </button>
            {quickCountries.map((c) => {
              const active =
                !isAllWorldFilter(countryValue) &&
                countryValue.toLowerCase() === c.toLowerCase();
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => handleCountryChange(c)}
                  className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] transition-colors ${
                    active
                      ? 'border-emerald-400/60 bg-emerald-500/25 text-emerald-100 shadow-[0_0_12px_rgba(16,185,129,0.25)]'
                      : 'border-white/12 bg-white/5 text-slate-400 hover:border-white/25 hover:text-slate-200'
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
          {countrySelect}
        </div>
        <div>
          <p className={SECTION_LABEL}>{t('selectCity')}</p>
          {citySelect}
        </div>
      </section>
    );
  };

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

  const renderTagButtons = () => {
    const coralIdle =
      'border border-rose-500/35 bg-rose-500/10 text-rose-300/90 transition-all font-medium hover:bg-rose-500/20';
    const coralActive =
      'bg-rose-500/20 text-rose-400 border border-rose-500/50 shadow-[0_0_12px_rgba(244,63,94,0.3)] transition-all font-medium hover:bg-rose-500/30';

    const reportButtons = REPORT_PRIORITY_TAGS.map((tag) => {
      const checked = selectedTags.some((x) => x.toLowerCase() === tag.id);
      return (
        <button
          key={tag.id}
          type="button"
          role="checkbox"
          aria-checked={checked}
          onClick={() => {
            onToggleTag(tag.id);
            if (!checked && !showFreeReports) onShowFreeReportsChange?.(true);
          }}
          className={`inline-flex min-h-[2rem] items-center justify-center rounded-full px-3 py-1.5 text-[11px] tracking-wide ${
            checked ? coralActive : coralIdle
          }`}
        >
          {tag.label}
        </button>
      );
    });

    const standardButtons = ALL_MISSION_TAGS.filter((tag) => !isReportFilterTag(tag)).map(
      (tag) => {
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
      }
    );

    return [...reportButtons, ...standardButtons];
  };

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
                className={`ce-bottom-sheet relative w-full max-w-md overflow-hidden rounded-t-2xl shadow-[0_-8px_50px_rgba(0,0,0,0.45)] sm:rounded-3xl ${STEEL_GLASS_PANEL}`}
                style={{
                  ...STEEL_GLASS_PANEL_STYLE,
                  ...BOTTOM_SHEET_MAX_HEIGHT_STYLE,
                }}
                initial={{ y: '100%', opacity: 0.6 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: '100%', opacity: 0.4 }}
                transition={{ type: 'spring', damping: 32, stiffness: 320 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className="ce-bottom-sheet-body touch-pan-y"
                  style={{ WebkitOverflowScrolling: 'touch' }}
                  onTouchMove={(e) => e.stopPropagation()}
                >
                  <div
                    className="sticky top-0 z-10 shrink-0 border-b border-white/10 backdrop-blur-[16px] [-webkit-backdrop-filter:blur(16px)]"
                    style={STEEL_GLASS_PANEL_STYLE}
                  >
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

                  <div className={`space-y-6 p-4 ${BOTTOM_SHEET_SCROLL_PB}`}>
                    {renderLocationControls(false)}

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

  return (
    <div
      className={`rounded-xl ${STEEL_GLASS_PANEL}`}
      style={STEEL_GLASS_PANEL_STYLE}
    >
      <div className="ce-hide-scrollbar flex items-center gap-2 overflow-x-auto whitespace-nowrap p-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-cyan-200 transition-colors hover:bg-cyan-500/20"
          aria-expanded={expanded}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2.25} />
          {t('filtersLabel')}
          {badgeCount > 0 && (
            <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-400 px-1 text-[9px] font-black text-slate-950">
              {badgeCount}
            </span>
          )}
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
            strokeWidth={2.25}
          />
        </button>

        {renderLocationControls(true)}

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

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-white/10"
          >
            <div className="space-y-4 p-3">
              {renderLocationControls(false)}
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MissionFilterPanel;
