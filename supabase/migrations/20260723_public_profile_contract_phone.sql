-- ============================================================================
-- Public profile enrichment + contract-gated client phone unlock
-- ============================================================================
-- • get_public_profile: member_since (auth.users.created_at), verification_status
-- • get_client_phone_if_contracted(client_id): phone only when viewer has an
--   active/accepted private mission with that client (Phase 3 safe)
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_public_profile(uuid);

CREATE OR REPLACE FUNCTION public.get_public_profile(p_id uuid)
RETURNS TABLE (
  id uuid,
  full_name text,
  avatar_url text,
  is_verified boolean,
  verification_status text,
  rating numeric,
  review_count integer,
  missions_created integer,
  missions_completed integer,
  member_since timestamptz
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
    coalesce(p.verification_status::text, CASE WHEN coalesce(p.is_verified, false) THEN 'verified' ELSE 'unverified' END)
      AS verification_status,
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
    ) AS missions_completed,
    (
      SELECT u.created_at
      FROM auth.users u
      WHERE u.id = p.id
    ) AS member_since
  FROM public.profiles p
  WHERE p.id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_public_profile(uuid) IS
  'Public creator card: name, avatar, verified, rating, counts, member_since. Never returns phone.';

-- ---------------------------------------------------------------------------
-- Contract unlock: phone only if viewer↔ client on a private mission
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_client_phone_if_contracted(p_client_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mission_id uuid;
BEGIN
  IF v_uid IS NULL OR p_client_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Own profile: allow self-read (same as get_own_phone_number).
  IF v_uid = p_client_id THEN
    RETURN public.get_own_phone_number();
  END IF;

  IF public.is_platform_admin(v_uid) THEN
    RETURN (
      SELECT nullif(btrim(coalesce(p.phone_number, '')), '')
      FROM public.profiles p
      WHERE p.id = p_client_id
    );
  END IF;

  -- Assigned cleaner on a private (non-crowdfunding) mission with this client.
  SELECT m.id
  INTO v_mission_id
  FROM public.missions m
  WHERE m.creator_id = p_client_id
    AND m.cleaner_id = v_uid
    AND coalesce(m.crowdfunding_mode, false) = false
    AND lower(coalesce(m.status::text, '')) IN (
      'in_progress', 'review', 'pending_approval', 'completed', 'finished'
    )
  ORDER BY m.started_at DESC NULLS LAST, m.created_at DESC
  LIMIT 1;

  IF v_mission_id IS NULL THEN
    SELECT b.mission_id
    INTO v_mission_id
    FROM public.mission_bids b
    INNER JOIN public.missions m ON m.id = b.mission_id
    WHERE m.creator_id = p_client_id
      AND b.cleaner_id = v_uid
      AND lower(coalesce(b.status::text, '')) = 'accepted'
      AND coalesce(m.crowdfunding_mode, false) = false
    ORDER BY b.created_at DESC
    LIMIT 1;
  END IF;

  IF v_mission_id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN public.get_mission_client_phone(v_mission_id);
END;
$$;

COMMENT ON FUNCTION public.get_client_phone_if_contracted(uuid) IS
  'Returns client phone only when viewer is assigned/accepted on a private mission with that client; else NULL.';

REVOKE ALL ON FUNCTION public.get_client_phone_if_contracted(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_client_phone_if_contracted(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_phone_if_contracted(uuid) TO service_role;
