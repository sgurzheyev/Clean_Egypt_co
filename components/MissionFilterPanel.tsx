/**
 * Compact, expandable filter + sort controls for the missions feed.
 * Tag filter is multi-select (check the categories you want); sort is a dropdown.
 */
import React, { useState } from 'react';
import { SlidersHorizontal, ChevronDown, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  ALL_MISSION_TAGS,
  MISSION_SORT_MODES,
  MISSION_SORT_LABEL_KEYS,
  type MissionSortMode,
} from '../src/lib/missionFilterSort';

export interface MissionFilterPanelProps {
  sortMode: MissionSortMode;
  onSortChange: (mode: MissionSortMode) => void;
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
  resultCount?: number;
}

const MissionFilterPanel: React.FC<MissionFilterPanelProps> = ({
  sortMode,
  onSortChange,
  selectedTags,
  onToggleTag,
  onClearTags,
  resultCount,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const activeCount = selectedTags.length;

  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/70 backdrop-blur-md">
      <div className="flex items-center gap-2 p-2">
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
        <div className="border-t border-white/10 p-3">
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
              return (
                <button
                  key={tag}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => onToggleTag(tag)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-bold lowercase tracking-wide transition-colors ${
                    checked
                      ? 'border-cyan-400/60 bg-cyan-500/25 text-cyan-100'
                      : 'border-white/12 bg-white/5 text-slate-300 hover:border-white/25 hover:text-slate-100'
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
          {typeof resultCount === 'number' && (
            <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
              {t('resultsCount', { count: resultCount })}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default MissionFilterPanel;
