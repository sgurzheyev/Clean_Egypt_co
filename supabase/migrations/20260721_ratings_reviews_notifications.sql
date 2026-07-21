-- ============================================================================
-- Ratings & Reviews + In-App Notifications
-- ----------------------------------------------------------------------------
-- 1) notifications table (+ RLS: owner read/update/delete; inserts via SECURITY
--    DEFINER RPCs only) and a live-friendly index.
-- 2) reviews table (+ public read RLS) with UNIQUE (mission_id, reviewer_id).
-- 3) Trigger: recompute profiles.rating (avg) + profiles.review_count on any
--    review insert/update/delete for the reviewee.
-- 4) RPCs: submit_review (participant-gated, upsert, notifies reviewee),
--    notify_mission_event (participant-gated proof/reject/approve dispatch),
--    create_notification (internal), get_profile_reviews, and get_public_profile
--    updated to include review_count.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Profile aggregate columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS rating numeric;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS review_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.rating IS 'Average review rating (1-5), maintained by trg_reviews_recalc_rating.';
COMMENT ON COLUMN public.profiles.review_count IS 'Number of reviews received, maintained by trg_reviews_recalc_rating.';

-- ---------------------------------------------------------------------------
-- 1) notifications
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  mission_id uuid REFERENCES public.missions(id) ON DELETE CASCADE,
  type text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotent column guards: if a legacy `notifications` table already existed with
-- a different shape, CREATE TABLE IF NOT EXISTS is a no-op — ensure every column
-- exists before any index/policy references it.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS actor_id uuid;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS mission_id uuid;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

COMMENT ON TABLE public.notifications IS
  'In-app notification feed. Rows are created only by SECURITY DEFINER RPCs (create_notification / notify_mission_event / submit_review).';

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, is_read, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS notifications_delete_own ON public.notifications;
CREATE POLICY notifications_delete_own ON public.notifications
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- No INSERT policy: only SECURITY DEFINER functions (run as owner) may insert.
GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) reviews
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mission_id, reviewer_id)
);

-- Idempotent column guards: if a legacy `reviews` table already existed without
-- these columns, CREATE TABLE IF NOT EXISTS is a no-op — add every column BEFORE
-- the index / unique constraint / RPCs reference reviewee_id (fixes 42703).
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS mission_id uuid;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS reviewer_id uuid;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS reviewee_id uuid;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS rating integer;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS comment text;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Ensure the (mission_id, reviewer_id) uniqueness exists even on a legacy table.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reviews'::regclass
      AND contype = 'u'
      AND conname = 'reviews_mission_id_reviewer_id_key'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'reviews_mission_reviewer_uidx'
  ) THEN
    CREATE UNIQUE INDEX reviews_mission_reviewer_uidx
      ON public.reviews (mission_id, reviewer_id);
  END IF;
END $$;

COMMENT ON TABLE public.reviews IS
  'Per-mission peer reviews (creator<->worker). Public read; writes via submit_review RPC only.';

CREATE INDEX IF NOT EXISTS idx_reviews_reviewee
  ON public.reviews (reviewee_id, created_at DESC);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reviews_select_all ON public.reviews;
CREATE POLICY reviews_select_all ON public.reviews
  FOR SELECT TO anon, authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policy: writes go through submit_review (SECURITY DEFINER).
GRANT SELECT ON public.reviews TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Trigger: recompute reviewee rating + review_count
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.recalc_profile_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target uuid := COALESCE(NEW.reviewee_id, OLD.reviewee_id);
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
  ) sub
  WHERE p.id = v_target;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_reviews_recalc_rating ON public.reviews;
CREATE TRIGGER trg_reviews_recalc_rating
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.recalc_profile_rating();

-- ---------------------------------------------------------------------------
-- 4a) create_notification — internal helper (service_role / definer callers)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id uuid,
  p_type text,
  p_mission_id uuid DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_type IS NULL OR length(trim(p_type)) = 0 THEN
    RETURN NULL;
  END IF;
  -- Never notify yourself.
  IF p_actor_id IS NOT NULL AND p_user_id = p_actor_id THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notifications (user_id, type, mission_id, actor_id)
  VALUES (p_user_id, left(trim(p_type), 64), p_mission_id, p_actor_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_notification(uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid, text, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.create_notification(uuid, text, uuid, uuid) IS
  'Internal: insert a notification row (bypasses RLS as definer). Called by lifecycle RPCs.';

-- ---------------------------------------------------------------------------
-- 4b) notify_mission_event — participant-gated dispatch from the client
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_mission_event(
  p_mission_id uuid,
  p_type text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_mission public.missions%ROWTYPE;
  v_target uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_mission FROM public.missions WHERE id = p_mission_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF uid IS DISTINCT FROM v_mission.creator_id AND uid IS DISTINCT FROM v_mission.cleaner_id THEN
    RAISE EXCEPTION 'Not a mission participant';
  END IF;

  -- Route the notification to the correct recipient by event type.
  IF p_type = 'proof_uploaded' THEN
    v_target := v_mission.creator_id;          -- worker → creator
  ELSIF p_type IN ('proof_rejected', 'mission_approved') THEN
    v_target := v_mission.cleaner_id;          -- creator → worker
  ELSE
    v_target := CASE
      WHEN uid = v_mission.creator_id THEN v_mission.cleaner_id
      ELSE v_mission.creator_id
    END;
  END IF;

  IF v_target IS NULL OR v_target = uid THEN
    RETURN NULL;
  END IF;

  RETURN public.create_notification(v_target, p_type, p_mission_id, uid);
END;
$$;

REVOKE ALL ON FUNCTION public.notify_mission_event(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_mission_event(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.notify_mission_event(uuid, text) IS
  'Participant-gated: emit a mission notification (proof_uploaded/proof_rejected/mission_approved) to the counterparty.';

-- ---------------------------------------------------------------------------
-- 4c) submit_review — participant-gated upsert; notifies reviewee
-- ---------------------------------------------------------------------------

-- Drop the legacy 3-arg version (p_cleaner_id) if it exists.
DROP FUNCTION IF EXISTS public.submit_review(uuid, uuid, integer);

CREATE OR REPLACE FUNCTION public.submit_review(
  p_mission_id uuid,
  p_reviewee_id uuid,
  p_rating integer,
  p_comment text DEFAULT NULL
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

  -- Caller must be a participant.
  IF uid IS DISTINCT FROM v_mission.creator_id AND uid IS DISTINCT FROM v_mission.cleaner_id THEN
    RAISE EXCEPTION 'Only mission participants can review';
  END IF;

  -- Reviewee must be the other participant.
  IF p_reviewee_id IS NULL OR p_reviewee_id = uid THEN
    RAISE EXCEPTION 'Invalid reviewee';
  END IF;
  IF p_reviewee_id IS DISTINCT FROM v_mission.creator_id
     AND p_reviewee_id IS DISTINCT FROM v_mission.cleaner_id THEN
    RAISE EXCEPTION 'Reviewee is not part of this mission';
  END IF;

  -- Only completed missions can be reviewed.
  IF lower(coalesce(v_mission.status::text, '')) NOT IN ('completed', 'finished') THEN
    RAISE EXCEPTION 'Mission is not completed yet';
  END IF;

  v_comment := nullif(trim(coalesce(p_comment, '')), '');
  IF v_comment IS NOT NULL THEN
    v_comment := left(v_comment, 1000);
  END IF;

  INSERT INTO public.reviews (mission_id, reviewer_id, reviewee_id, rating, comment)
  VALUES (p_mission_id, uid, p_reviewee_id, p_rating, v_comment)
  ON CONFLICT (mission_id, reviewer_id)
  DO UPDATE SET
    rating = excluded.rating,
    comment = excluded.comment,
    reviewee_id = excluded.reviewee_id,
    created_at = now()
  RETURNING id INTO v_id;

  PERFORM public.create_notification(p_reviewee_id, 'new_review', p_mission_id, uid);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_review(uuid, uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_review(uuid, uuid, integer, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.submit_review(uuid, uuid, integer, text) IS
  'Participant-gated peer review upsert on a completed mission; recalcs reviewee rating and notifies them.';

-- ---------------------------------------------------------------------------
-- 4d) get_profile_reviews — recent public reviews for a profile
-- ---------------------------------------------------------------------------

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
  WHERE r.reviewee_id = p_id
  ORDER BY r.created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 10), 50));
END;
$$;

REVOKE ALL ON FUNCTION public.get_profile_reviews(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profile_reviews(uuid, integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_profile_reviews(uuid, integer) IS
  'Public: recent reviews received by a profile, with reviewer name/avatar.';

-- ---------------------------------------------------------------------------
-- 4e) get_public_profile — add review_count to the public card
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_public_profile(uuid);

CREATE OR REPLACE FUNCTION public.get_public_profile(p_id uuid)
RETURNS TABLE (
  id uuid,
  full_name text,
  avatar_url text,
  is_verified boolean,
  rating numeric,
  review_count integer,
  missions_created integer,
  missions_completed integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.avatar_url,
    coalesce(p.is_verified, false) AS is_verified,
    p.rating::numeric AS rating,
    coalesce(p.review_count, 0) AS review_count,
    (
      SELECT count(*)::integer
      FROM public.missions m
      WHERE m.creator_id = p.id
    ) AS missions_created,
    (
      SELECT count(*)::integer
      FROM public.missions m
      WHERE m.creator_id = p.id
        AND lower(coalesce(m.status::text, '')) IN ('completed', 'finished')
    ) AS missions_completed
  FROM public.profiles p
  WHERE p.id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_public_profile(uuid) IS
  'Public, minimal creator card (name, avatar, verified, rating, review_count, mission counts) for /profile/:id.';
