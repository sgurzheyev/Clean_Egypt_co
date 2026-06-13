import type { ServiceType } from './serviceSectors';

/** Default smart hashtags per service type (2–3 each). */
const SERVICE_TYPE_HASHTAGS: Record<ServiceType, string[]> = {
  home_office: ['#home', '#office', '#cleaning'],
  ac_cleaning: ['#ac', '#hvac', '#cleaning'],
  pool_maintenance: ['#pool', '#cleaning', '#maintenance'],
  pest_control: ['#pest', '#control', '#home'],
  windows_facades: ['#windows', '#facade', '#cleaning'],
  terrace_garden: ['#garden', '#terrace', '#outdoor'],
  car_detailing: ['#car', '#detailing', '#shine'],
  yacht_boat_cleaning: ['#yacht', '#boat', '#marine'],
  solar_panels: ['#solar', '#panels', '#roof'],
  ultrasound_cleaning: ['#ultrasound', '#deep', '#cleaning'],
  carpets_mattresses: ['#carpets', '#mattress', '#deep'],
  kitchen_hoods_grease: ['#kitchen', '#grease', '#hood'],
  laundry_ironing: ['#laundry', '#ironing', '#home'],
  water_tank_cleaning: ['#water', '#tank', '#cleaning'],
  junk_removal: ['#junk', '#heavy', '#haul'],
};

const HASHTAG_RE = /#\S+/gi;

function collectHashtags(text: string): Set<string> {
  const tags = new Set<string>();
  for (const match of text.matchAll(HASHTAG_RE)) {
    tags.add(match[0].toLowerCase());
  }
  return tags;
}

/**
 * Keeps the user's text and appends 2–3 service-type hashtags that are not already present.
 */
export function processMissionDescription(
  text: string,
  serviceType: ServiceType | string
): string {
  const base = String(text || '').trim();
  const defaults =
    SERVICE_TYPE_HASHTAGS[serviceType as ServiceType] ?? ['#cleaning', '#service'];
  const present = collectHashtags(base);
  const toAppend = defaults.filter((tag) => !present.has(tag.toLowerCase()));
  if (!base) return toAppend.join(' ');
  if (toAppend.length === 0) return base;
  return `${base} ${toAppend.join(' ')}`;
}

/** Strip the leading pin/location line from stored mission descriptions. */
export function extractMissionFeedDescription(
  description: string | null | undefined
): string | undefined {
  const raw = String(description ?? '').trim();
  if (!raw) return undefined;

  if (raw.includes('\n\n')) {
    const [head, ...rest] = raw.split(/\n\n+/);
    if (head.trim().startsWith('📍')) {
      const body = rest.join('\n\n').trim();
      return body || undefined;
    }
  }

  const lines = raw.split('\n');
  if (lines[0]?.trim().startsWith('📍')) {
    const body = lines.slice(1).join('\n').trim();
    return body || undefined;
  }

  return raw;
}

export type DescriptionToken =
  | { kind: 'text'; value: string }
  | { kind: 'hashtag'; value: string };

/** Split description into plain text and hashtag tokens for feed rendering. */
export function tokenizeDescriptionHashtags(text: string): DescriptionToken[] {
  const tokens: DescriptionToken[] = [];
  const parts = text.split(/(\s+)/);

  for (const part of parts) {
    if (!part) continue;
    if (/^#\S+$/.test(part)) {
      tokens.push({ kind: 'hashtag', value: part });
    } else {
      tokens.push({ kind: 'text', value: part });
    }
  }

  return tokens;
}

export const MISSION_SHORT_DESCRIPTION_MAX = 200;
