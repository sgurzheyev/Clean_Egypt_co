/** Peer reviews: submit (participant-gated upsert) and read reviews ABOUT a profile. */
import { supabase } from '../../services/supabase';
import { isReviewAboutProfile } from './reviewSubject';
import { ALL_SECTOR_SERVICES } from './serviceSectors';

export { isReviewAboutProfile };

export interface ProfileReviewRow {
  id: string;
  mission_id: string;
  reviewer_id: string;
  reviewer_name: string | null;
  reviewer_avatar: string | null;
  rating: number;
  comment: string | null;
  created_at: string;
  /** Mission title, else service_type id (UI translates known ids). */
  mission_label: string | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function submitReview(input: {
  missionId: string;
  revieweeId: string;
  rating: number;
  comment?: string | null;
  /** Mission assigned worker — required by legacy reviews.cleaner_id NOT NULL. */
  cleanerId?: string | null;
}): Promise<void> {
  if (!Number.isFinite(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new Error('Rating must be between 1 and 5');
  }
  const payload: Record<string, unknown> = {
    p_mission_id: input.missionId,
    p_reviewee_id: input.revieweeId,
    p_rating: Math.round(input.rating),
    p_comment: (input.comment || '').trim().slice(0, 1000) || null,
  };
  if (input.cleanerId) {
    payload.p_cleaner_id = input.cleanerId;
  }
  const { error } = await supabase.rpc('submit_review', payload);
  if (error) throw error;
}

function asRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') return [data as Record<string, unknown>];
  return [];
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function mapRpcRow(row: Record<string, unknown>): ProfileReviewRow | null {
  const id = textOrNull(row.id);
  const missionId = textOrNull(row.mission_id);
  const reviewerId = textOrNull(row.reviewer_id);
  if (!id || !missionId || !reviewerId) return null;
  const rating = Number(row.rating);
  return {
    id,
    mission_id: missionId,
    reviewer_id: reviewerId,
    reviewer_name: textOrNull(row.reviewer_name),
    reviewer_avatar: textOrNull(row.reviewer_avatar),
    rating: Number.isFinite(rating) ? rating : 0,
    comment: textOrNull(row.comment),
    created_at: textOrNull(row.created_at) || new Date(0).toISOString(),
    mission_label: textOrNull(row.mission_label) || textOrNull(row.mission_title),
  };
}

const SERVICE_LABEL_KEYS = new Map(ALL_SECTOR_SERVICES.map((s) => [s.id, s.labelKey]));

/** i18n key for a stored service_type, when the profile card should translate it. */
export function reviewMissionLabelKey(label: string | null | undefined): string | null {
  if (!label) return null;
  return SERVICE_LABEL_KEYS.get(label as (typeof ALL_SECTOR_SERVICES)[number]['id']) ?? null;
}

async function attachMissionLabels(rows: ProfileReviewRow[]): Promise<ProfileReviewRow[]> {
  const ids = [...new Set(rows.map((r) => r.mission_id).filter(Boolean))];
  if (ids.length === 0) return rows;
  const { data, error } = await supabase
    .from('missions')
    .select('id, service_type')
    .in('id', ids);
  if (error || !data) return rows;
  const byId = new Map<string, string | null>();
  for (const raw of data as Record<string, unknown>[]) {
    const id = textOrNull(raw.id);
    if (!id) continue;
    byId.set(id, textOrNull(raw.service_type));
  }
  return rows.map((row) => {
    if (row.mission_label) return row;
    const serviceType = byId.get(row.mission_id);
    if (!serviceType) return row;
    return { ...row, mission_label: serviceType };
  });
}

/**
 * Direct table read. `reviews` is publicly selectable; this still works when
 * `get_profile_reviews` is missing, errors, or only matches `reviewee_id`
 * while a legacy row stored the subject in `cleaner_id`.
 */
async function readReviewsAboutProfile(
  profileId: string,
  limit: number
): Promise<ProfileReviewRow[]> {
  const capped = Math.max(1, Math.min(limit, 50));
  const filter = `reviewee_id.eq.${profileId},and(reviewee_id.is.null,cleaner_id.eq.${profileId})`;
  const primary = await supabase
    .from('reviews')
    .select('id, mission_id, reviewer_id, reviewee_id, cleaner_id, rating, comment, created_at')
    .or(filter)
    .order('created_at', { ascending: false })
    .limit(capped);

  let rawSource: Record<string, unknown>[] = [];
  if (primary.error) {
    const fallback = await supabase
      .from('reviews')
      .select('id, mission_id, reviewer_id, reviewee_id, rating, comment, created_at')
      .eq('reviewee_id', profileId)
      .order('created_at', { ascending: false })
      .limit(capped);
    if (fallback.error) throw fallback.error;
    rawSource = (fallback.data || []) as Record<string, unknown>[];
  } else {
    rawSource = (primary.data || []) as Record<string, unknown>[];
  }

  const rawRows = rawSource.filter((row) =>
    isReviewAboutProfile(
      {
        reviewee_id: textOrNull(row.reviewee_id),
        cleaner_id: textOrNull(row.cleaner_id),
      },
      profileId
    )
  );

  const reviewerIds = [
    ...new Set(
      rawRows
        .map((row) => textOrNull(row.reviewer_id))
        .filter((id): id is string => !!id)
    ),
  ];
  const names = new Map<string, { full_name: string | null; avatar_url: string | null }>();
  if (reviewerIds.length > 0) {
    const { data: people } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url')
      .in('id', reviewerIds);
    for (const person of (people || []) as Record<string, unknown>[]) {
      const id = textOrNull(person.id);
      if (!id) continue;
      names.set(id, {
        full_name: textOrNull(person.full_name),
        avatar_url: textOrNull(person.avatar_url),
      });
    }
  }

  const mapped: ProfileReviewRow[] = [];
  for (const row of rawRows) {
    const id = textOrNull(row.id);
    const missionId = textOrNull(row.mission_id);
    const reviewerId = textOrNull(row.reviewer_id);
    if (!id || !missionId || !reviewerId) continue;
    const person = names.get(reviewerId);
    const rating = Number(row.rating);
    mapped.push({
      id,
      mission_id: missionId,
      reviewer_id: reviewerId,
      reviewer_name: person?.full_name ?? null,
      reviewer_avatar: person?.avatar_url ?? null,
      rating: Number.isFinite(rating) ? rating : 0,
      comment: textOrNull(row.comment),
      created_at: textOrNull(row.created_at) || new Date(0).toISOString(),
      mission_label: null,
    });
  }
  return attachMissionLabels(mapped);
}

export async function getProfileReviews(
  profileId: string,
  limit = 10
): Promise<ProfileReviewRow[]> {
  if (!UUID_RE.test(profileId)) return [];
  const capped = Math.max(1, Math.min(limit, 50));

  let rpcRows: ProfileReviewRow[] = [];
  let rpcFailed = false;
  try {
    const { data, error } = await supabase.rpc('get_profile_reviews', {
      p_id: profileId,
      p_limit: capped,
    });
    if (error) {
      rpcFailed = true;
      console.warn('get_profile_reviews', error.message);
    } else {
      rpcRows = asRows(data)
        .map(mapRpcRow)
        .filter((row): row is ProfileReviewRow => !!row);
    }
  } catch (err) {
    rpcFailed = true;
    console.warn('get_profile_reviews', err);
  }

  if (!rpcFailed && rpcRows.length > 0) {
    return attachMissionLabels(rpcRows);
  }

  // Empty RPC can mean "no reviews" OR an older function that ignores legacy
  // cleaner_id-only rows. The public table read distinguishes those.
  try {
    const direct = await readReviewsAboutProfile(profileId, capped);
    if (direct.length > 0) return direct;
  } catch (err) {
    console.warn('reviews direct read', err);
    if (rpcFailed) throw err;
  }

  return rpcRows;
}

/** Prefer mission.cleaner_id; fall back to accepted bid worker. */
export function resolveMissionCleanerId(input: {
  cleanerId?: string | null;
  acceptedBidCleanerId?: string | null;
  revieweeId?: string | null;
  creatorId?: string | null;
}): string | null {
  if (input.cleanerId) return input.cleanerId;
  if (input.acceptedBidCleanerId) return input.acceptedBidCleanerId;
  if (
    input.revieweeId &&
    input.creatorId &&
    input.revieweeId !== input.creatorId
  ) {
    return input.revieweeId;
  }
  return null;
}
