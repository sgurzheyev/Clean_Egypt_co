/**
 * Shared filtering + sorting for the missions list/map feed.
 * Tags are derived from `service_type` (there is no `tags` column) via
 * SERVICE_TYPE_HASHTAGS; budget uses the canonical USD work budget.
 */
import { missionTokenBid, missionWorkBudgetUsd } from './missionBudget';
import { SERVICE_TYPE_HASHTAGS, serviceTypeHashtags } from './missionDescription';
import { isGarbageZoneReport } from './garbageZoneReport';

export type MissionSortMode =
  | 'boost_desc'
  | 'date_desc'
  | 'date_asc'
  | 'budget_desc'
  | 'budget_asc';

// Token-boost first: promoted (higher token bid) missions rank strictly at the top.
export const MISSION_SORT_MODES: MissionSortMode[] = [
  'boost_desc',
  'date_desc',
  'date_asc',
  'budget_desc',
  'budget_asc',
];

/** i18n key per sort mode (added to src/i18n.ts). */
export const MISSION_SORT_LABEL_KEYS: Record<MissionSortMode, string> = {
  boost_desc: 'sortBoostTop',
  date_desc: 'sortDateNewest',
  date_asc: 'sortDateOldest',
  budget_desc: 'sortBudgetHighest',
  budget_asc: 'sortBudgetLowest',
};

// Ranking pivot: token promotion ("продвижение за токены") is the default order.
export const DEFAULT_MISSION_SORT: MissionSortMode = 'boost_desc';

/**
 * Coral priority tags — isolate free civil Attention Zone reports.
 * Canonical keys are lowercase; UI may show a display label with emoji.
 */
export const REPORT_PRIORITY_TAGS = [
  { id: '#garbagini', label: '#Garbagini 🗑️' },
  { id: '#garbage', label: '#garbage' },
] as const;

export const REPORT_FILTER_TAG_IDS = new Set(
  REPORT_PRIORITY_TAGS.map((t) => t.id.toLowerCase())
);

export function isReportFilterTag(tag: string | null | undefined): boolean {
  return REPORT_FILTER_TAG_IDS.has(String(tag || '').toLowerCase());
}

/** Unique, ordered list of all filterable tags across every service type. */
export const ALL_MISSION_TAGS: string[] = (() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tags of Object.values(SERVICE_TYPE_HASHTAGS)) {
    for (const raw of tags) {
      const tag = raw.toLowerCase();
      if (!seen.has(tag)) {
        seen.add(tag);
        out.push(tag);
      }
    }
  }
  return out;
})();

type SortableMission = {
  created_at?: string | null;
  expected_price?: number | null;
  /** Token promotion / boost (listing rank). Higher = ranks higher. */
  amount_target?: number | null;
};

type TaggableMission = {
  service_type?: string | null;
  description?: string | null;
  is_report?: boolean | null;
  status?: string | null;
  category?: string | null;
};

function createdAtMs(mission: SortableMission): number {
  const ts = mission.created_at ? Date.parse(mission.created_at) : NaN;
  return Number.isFinite(ts) ? ts : 0;
}

const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;

/** All tags for a mission: service-type defaults + any hashtags in the description. */
export function missionTags(mission: TaggableMission): string[] {
  const tags = new Set<string>(serviceTypeHashtags(mission.service_type).map((t) => t.toLowerCase()));
  const desc = String(mission.description ?? '');
  for (const match of desc.matchAll(HASHTAG_RE)) {
    tags.add(match[0].toLowerCase());
  }
  return [...tags];
}

/**
 * Keep missions matching ANY selected tag. An empty selection means "no filter"
 * (show everything). Coral report tags (`#garbagini` / `#garbage`) match free
 * Attention Zone reports (`is_report` / status `reported`).
 */
export function filterMissionsByTags<T extends TaggableMission>(
  missions: T[],
  selectedTags: string[]
): T[] {
  if (!selectedTags || selectedTags.length === 0) return missions;
  const wanted = new Set(selectedTags.map((t) => t.toLowerCase()));
  const wantsReports = [...wanted].some((t) => REPORT_FILTER_TAG_IDS.has(t));
  const otherWanted = new Set(
    [...wanted].filter((t) => !REPORT_FILTER_TAG_IDS.has(t))
  );

  return missions.filter((mission) => {
    if (wantsReports && isGarbageZoneReport(mission)) return true;
    if (otherWanted.size === 0) return false;
    return missionTags(mission).some((tag) => otherWanted.has(tag));
  });
}

/** Stable sort by the chosen mode (does not mutate the input array). */
export function sortMissions<T extends SortableMission>(
  missions: T[],
  mode: MissionSortMode
): T[] {
  const copy = [...missions];
  copy.sort((a, b) => {
    switch (mode) {
      case 'boost_desc':
        // Token promotion first, newest as tiebreaker.
        return missionTokenBid(b) - missionTokenBid(a) || createdAtMs(b) - createdAtMs(a);
      case 'date_asc':
        return createdAtMs(a) - createdAtMs(b);
      case 'budget_desc':
        return missionWorkBudgetUsd(b) - missionWorkBudgetUsd(a) || createdAtMs(b) - createdAtMs(a);
      case 'budget_asc':
        return missionWorkBudgetUsd(a) - missionWorkBudgetUsd(b) || createdAtMs(b) - createdAtMs(a);
      case 'date_desc':
        return createdAtMs(b) - createdAtMs(a);
      default:
        // Default ranking = token boost desc, then newest.
        return missionTokenBid(b) - missionTokenBid(a) || createdAtMs(b) - createdAtMs(a);
    }
  });
  return copy;
}

const RELATIVE_UNITS: Array<{ limit: number; div: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { limit: 60, div: 1, unit: 'second' },
  { limit: 3600, div: 60, unit: 'minute' },
  { limit: 86400, div: 3600, unit: 'hour' },
  { limit: 604800, div: 86400, unit: 'day' },
  { limit: 2629800, div: 604800, unit: 'week' },
  { limit: 31557600, div: 2629800, unit: 'month' },
];

/**
 * Human-readable submission time. Recent → relative ("2 hours ago"), older than
 * ~30 days → absolute date ("July 20"). Locale-aware (RU/EN etc.).
 */
export function formatSubmittedRelative(
  createdAt: string | null | undefined,
  locale: string,
  nowMs: number = Date.now()
): string {
  if (!createdAt) return '';
  const then = Date.parse(createdAt);
  if (!Number.isFinite(then)) return '';

  const diffSec = Math.round((then - nowMs) / 1000);
  const absSec = Math.abs(diffSec);

  if (absSec >= 2629800) {
    return new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(new Date(then));
  }

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const { limit, div, unit } of RELATIVE_UNITS) {
    if (absSec < limit) {
      return rtf.format(Math.round(diffSec / div), unit);
    }
  }
  return new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(new Date(then));
}
