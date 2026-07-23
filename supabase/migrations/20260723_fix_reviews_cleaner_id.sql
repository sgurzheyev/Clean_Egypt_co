-- ============================================================================
-- Fix reviews.cleaner_id NOT NULL on submit_review (legacy column)
-- ============================================================================
-- Live DBs may still have NOT NULL `cleaner_id` from an older reviews schema.
-- Canonical peer reviews use `reviewee_id`; we always populate `cleaner_id` with
-- the mission's assigned worker so inserts succeed. Profile feed matches
-- reviewee_id (or legacy cleaner_id) and returns comment text.
-- ============================================================================

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS cleaner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS reviewee_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS reviewer_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS comment text;

-- Backfill cleaner_id from mission assignment when missing.
UPDATE public.reviews r
SET cleaner_id = m.cleaner_id
FROM public.missions m
WHERE r.mission_id = m.id
  AND r.cleaner_id IS NULL
  AND m.cleaner_id IS NOT NULL;

-- Backfill reviewee_id for legacy worker-only rows.
UPDATE public.reviews
SET reviewee_id = cleaner_id
WHERE reviewee_id IS NULL
  AND cleaner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reviews_cleaner
  ON public.reviews (cleaner_id, created_at DESC)
  WHERE cleaner_id IS NOT NULL;

-- Replace both 4-arg and 5-arg overloads with a single 5-arg function
-- (trailing p_cleaner_id defaults so existing 4-arg RPC calls still work).
DROP FUNCTION IF EXISTS public.submit_review(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.submit_review(uuid, uuid, integer, text);
DROP FUNCTION IF EXISTS public.submit_review(uuid, uuid, integer, text, uuid);

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

  -- Resolve assigned cleaner: explicit arg → mission → accepted bid → reviewee(worker).
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

  IF lower(coalesce(v_mission.status::text, '')) NOT IN ('completed', 'finished') THEN
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

  PERFORM public.create_notification(
    p_reviewee_id,
    'new_review',
    p_mission_id,
    uid,
    'New review',
    'You received a new review.'
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_review(uuid, uuid, integer, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_review(uuid, uuid, integer, text, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.submit_review(uuid, uuid, integer, text, uuid) IS
  'Participant-gated peer review upsert; always sets cleaner_id (mission worker) for legacy NOT NULL.';

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
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.mission_id,
    r.reviewer_id,
    rp.full_name,
    rp.avatar_url,
    r.rating,
    r.comment,
    r.created_at
  FROM public.reviews r
  LEFT JOIN public.profiles rp ON rp.id = r.reviewer_id
  WHERE coalesce(r.reviewee_id, r.cleaner_id) = p_id
  ORDER BY r.created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 10), 50));
END;
$$;

REVOKE ALL ON FUNCTION public.get_profile_reviews(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profile_reviews(uuid, integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_profile_reviews(uuid, integer) IS
  'Public: recent reviews for a profile (reviewee_id, fallback cleaner_id), including comment text.';
