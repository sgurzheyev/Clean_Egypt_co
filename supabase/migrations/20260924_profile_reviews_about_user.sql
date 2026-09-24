-- ============================================================================
-- Profile ОТЗЫВЫ: reviews ABOUT the profile, including legacy cleaner_id rows
-- ============================================================================
-- PublicProfile calls get_profile_reviews and used to swallow RPC errors, so a
-- failed or too-narrow function looked like "Пока нет отзывов".
--
-- A review belongs on the reviewee's profile. Legacy rows that only filled
-- NOT NULL cleaner_id (the assigned worker) are included when reviewee_id is
-- null. Reviews the person wrote stay on the other participant.
--
-- submit_review notification title/body now carry the reviewer label and the
-- comment, so the bell and the profile show the same text.
-- ============================================================================

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS cleaner_id uuid;

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS reviewee_id uuid;

CREATE OR REPLACE FUNCTION public.recalc_profile_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target uuid := COALESCE(
    NEW.reviewee_id,
    OLD.reviewee_id,
    NEW.cleaner_id,
    OLD.cleaner_id
  );
BEGIN
  IF v_target IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.profiles p
  SET
    rating = sub.avg_rating,
    review_count = sub.cnt
  FROM (
    SELECT
      round(avg(rating)::numeric, 2) AS avg_rating,
      count(*)::integer AS cnt
    FROM public.reviews
    WHERE reviewee_id = v_target
       OR (reviewee_id IS NULL AND cleaner_id = v_target)
  ) sub
  WHERE p.id = v_target;

  RETURN NULL;
END;
$$;

-- Align stored aggregates with the same subject rule (owner/postgres bypasses
-- the economy-column guard).
UPDATE public.profiles p
SET
  rating = sub.avg_rating,
  review_count = sub.cnt
FROM (
  SELECT
    coalesce(r.reviewee_id, r.cleaner_id) AS subject,
    round(avg(r.rating)::numeric, 2) AS avg_rating,
    count(*)::integer AS cnt
  FROM public.reviews r
  WHERE coalesce(r.reviewee_id, r.cleaner_id) IS NOT NULL
  GROUP BY 1
) sub
WHERE p.id = sub.subject
  AND (
    p.review_count IS DISTINCT FROM sub.cnt
    OR p.rating IS DISTINCT FROM sub.avg_rating
  );

CREATE OR REPLACE FUNCTION public.submit_review(
  p_mission_id uuid,
  p_reviewee_id uuid,
  p_rating integer,
  p_comment text DEFAULT NULL,
  p_cleaner_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_mission public.missions%ROWTYPE;
  v_comment text;
  v_id uuid;
  v_cleaner uuid;
  v_accepted_cleaner uuid;
  v_actor text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5';
  END IF;

  SELECT * INTO v_mission FROM public.missions WHERE id = p_mission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  v_cleaner := coalesce(p_cleaner_id, v_mission.cleaner_id);

  IF v_cleaner IS NULL THEN
    SELECT b.cleaner_id
    INTO v_accepted_cleaner
    FROM public.mission_bids b
    WHERE b.mission_id = p_mission_id
      AND lower(coalesce(b.status::text, '')) = 'accepted'
    ORDER BY b.created_at DESC NULLS LAST
    LIMIT 1;
    v_cleaner := v_accepted_cleaner;
  END IF;

  IF v_cleaner IS NULL
     AND p_reviewee_id IS NOT NULL
     AND p_reviewee_id IS DISTINCT FROM v_mission.creator_id THEN
    v_cleaner := p_reviewee_id;
  END IF;

  IF v_cleaner IS NULL THEN
    RAISE EXCEPTION 'Mission has no assigned cleaner';
  END IF;

  IF uid IS DISTINCT FROM v_mission.creator_id AND uid IS DISTINCT FROM v_cleaner THEN
    RAISE EXCEPTION 'Only mission participants can review';
  END IF;

  IF p_reviewee_id IS NULL OR p_reviewee_id = uid THEN
    RAISE EXCEPTION 'Invalid reviewee';
  END IF;

  IF p_reviewee_id IS DISTINCT FROM v_mission.creator_id
     AND p_reviewee_id IS DISTINCT FROM v_cleaner THEN
    RAISE EXCEPTION 'Reviewee is not part of this mission';
  END IF;

  IF lower(coalesce(v_mission.status::text, '')) NOT IN ('completed', 'finished', 'approved') THEN
    RAISE EXCEPTION 'Mission is not completed yet';
  END IF;

  v_comment := nullif(trim(coalesce(p_comment, '')), '');
  IF v_comment IS NOT NULL THEN
    v_comment := left(v_comment, 1000);
  END IF;

  INSERT INTO public.reviews (
    mission_id,
    reviewer_id,
    reviewee_id,
    cleaner_id,
    rating,
    comment
  )
  VALUES (
    p_mission_id,
    uid,
    p_reviewee_id,
    v_cleaner,
    p_rating,
    v_comment
  )
  ON CONFLICT (mission_id, reviewer_id)
  DO UPDATE SET
    rating = excluded.rating,
    comment = excluded.comment,
    reviewee_id = excluded.reviewee_id,
    cleaner_id = coalesce(excluded.cleaner_id, public.reviews.cleaner_id),
    created_at = now()
  RETURNING id INTO v_id;

  v_actor := coalesce(public.notification_actor_label(uid), 'Eco-Hero');

  PERFORM public.create_notification(
    p_reviewee_id,
    'new_review',
    p_mission_id,
    uid,
    left(format('Review from %s', v_actor), 120),
    coalesce(v_comment, 'You received a new review.')
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_review(uuid, uuid, integer, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_review(uuid, uuid, integer, text, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.submit_review(uuid, uuid, integer, text, uuid) IS
  'Participant-gated peer review upsert. Notifies the reviewee with the reviewer label and comment.';

-- Return type gains mission_label — must drop before recreate.
DROP FUNCTION IF EXISTS public.get_profile_reviews(uuid, integer);

CREATE OR REPLACE FUNCTION public.get_profile_reviews(
  p_id uuid,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  mission_id uuid,
  reviewer_id uuid,
  reviewer_name text,
  reviewer_avatar text,
  rating integer,
  comment text,
  created_at timestamptz,
  mission_label text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.mission_id,
    r.reviewer_id,
    rp.full_name::text,
    rp.avatar_url::text,
    r.rating,
    r.comment,
    r.created_at,
    nullif(btrim(coalesce(m.service_type, '')), '')::text
  FROM public.reviews r
  LEFT JOIN public.profiles rp ON rp.id = r.reviewer_id
  LEFT JOIN public.missions m ON m.id = r.mission_id
  WHERE r.reviewee_id = p_id
     OR (r.reviewee_id IS NULL AND r.cleaner_id = p_id)
  ORDER BY r.created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 10), 50));
END;
$$;

REVOKE ALL ON FUNCTION public.get_profile_reviews(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profile_reviews(uuid, integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_profile_reviews(uuid, integer) IS
  'Public: reviews ABOUT this profile (reviewee_id, or legacy cleaner_id when reviewee is null). Includes comment and service_type.';
