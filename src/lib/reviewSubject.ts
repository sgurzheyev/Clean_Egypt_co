/**
 * Profile ОТЗЫВЫ lists reviews *about* this person (they are the reviewee).
 * Legacy rows that predate `reviewee_id` stored the worker in `cleaner_id` only.
 * Reviews this person *wrote* belong on the other participant's profile.
 */
export function isReviewAboutProfile(
  row: { reviewee_id?: string | null; cleaner_id?: string | null },
  profileId: string
): boolean {
  if (!profileId) return false;
  if (row.reviewee_id) return row.reviewee_id === profileId;
  return !!row.cleaner_id && row.cleaner_id === profileId;
}
