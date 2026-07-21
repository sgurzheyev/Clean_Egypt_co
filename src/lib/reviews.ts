/** Peer reviews: submit (participant-gated upsert) and read recent reviews. */
import { supabase } from '../../services/supabase';

export interface ProfileReviewRow {
  id: string;
  mission_id: string;
  reviewer_id: string;
  reviewer_name: string | null;
  reviewer_avatar: string | null;
  rating: number;
  comment: string | null;
  created_at: string;
}

export async function submitReview(input: {
  missionId: string;
  revieweeId: string;
  rating: number;
  comment?: string | null;
}): Promise<void> {
  if (!Number.isFinite(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new Error('Rating must be between 1 and 5');
  }
  const { error } = await supabase.rpc('submit_review', {
    p_mission_id: input.missionId,
    p_reviewee_id: input.revieweeId,
    p_rating: Math.round(input.rating),
    p_comment: (input.comment || '').trim().slice(0, 1000) || null,
  });
  if (error) throw error;
}

export async function getProfileReviews(
  profileId: string,
  limit = 10
): Promise<ProfileReviewRow[]> {
  const { data, error } = await supabase.rpc('get_profile_reviews', {
    p_id: profileId,
    p_limit: limit,
  });
  if (error) throw error;
  return (data || []) as ProfileReviewRow[];
}
