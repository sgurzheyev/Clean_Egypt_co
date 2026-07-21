/**
 * Compact, expandable filter + sort controls for the missions feed.
 * Tag filter is multi-select (check the categories you want); sort is a dropdown.
 */
import React, { useState } from 'react';
import { SlidersHorizontal, ChevronDown, X, MapPin } from 'lucide-react';
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
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const activeCount = selectedTags.length;
  const showCityFilter = typeof onCityChange === 'function';
  const cityValue = cityId ?? MARKETPLACE_ALL_EGYPT_ID;

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

  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/70 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-2 p-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-cyan-200 transition-colors hover:bg-cyan-500/20"
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
          <div className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/30 bg-emerald-500/10 pl-2">
            <MapPin className="h-3.5 w-3.5 text-emerald-300" strokeWidth={2.25} aria-hidden />
            <label className="sr-only" htmlFor="mission-city-select">
              {t('selectCity')}
            </label>
            <select
              id="mission-city-select"
              value={cityValue}
              onChange={(e) => onCityChange?.(e.target.value)}
              className="rounded-lg border-0 bg-transparent px-1 py-1.5 text-[11px] font-bold text-emerald-100 outline-none focus:ring-0"
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
          className="ml-auto rounded-lg border border-white/15 bg-slate-950/80 px-2 py-1.5 text-[11px] font-bold text-slate-100 outline-none focus:border-cyan-400/50"
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
            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
              {t('sortByLabel')}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {MISSION_SORT_MODES.map((mode) => {
                const active = sortMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSortChange(mode)}
                    className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-bold tracking-wide transition-colors ${
                      active
                        ? 'border-cyan-400/60 bg-cyan-500/25 text-cyan-100'
                        : 'border-white/12 bg-white/5 text-slate-300 hover:border-white/25 hover:text-slate-100'
                    }`}
                  >
                    {t(MISSION_SORT_LABEL_KEYS[mode])}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                {t('filterByTags')}
              </p>
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
            <div className="flex flex-wrap gap-1.5">
              {ALL_MISSION_TAGS.map((tag) => {
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
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-bold lowercase tracking-wide transition-colors ${className}`}
                  >
                    {isEco && <span aria-hidden>🌿 </span>}
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>

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
