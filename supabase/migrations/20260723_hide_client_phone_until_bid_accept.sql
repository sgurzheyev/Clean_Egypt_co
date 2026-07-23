-- ============================================================================
-- Phase 3: Hide client phone until bid acceptance (private missions)
-- ============================================================================
-- • get_mission_client_phone(mission_id) — creator OR accepted bidder only;
--   always NULL for crowdfunding_mode.
-- • get_own_phone_number() — read own phone after column revoke.
-- • get_mission_worker_phone(mission_id) — creator reads assigned cleaner phone.
-- • admin_get_profile_phones(uuid[]) — platform admins only (dashboard).
-- • REVOKE SELECT (phone_number) from anon/authenticated so PostgREST cannot
--   leak other users' phones via .from('profiles').select('phone_number').
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Own phone (replaces direct SELECT of phone_number for self)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_own_phone_number()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT nullif(btrim(coalesce(p.phone_number, '')), '')
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$;

COMMENT ON FUNCTION public.get_own_phone_number() IS
  'Returns auth.uid() phone_number. Use instead of selecting profiles.phone_number.';

REVOKE ALL ON FUNCTION public.get_own_phone_number() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_own_phone_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_own_phone_number() TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Mission client (creator) phone — tender win unlock
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_mission_client_phone(p_mission_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_creator uuid;
  v_cleaner uuid;
  v_crowdfunding boolean;
  v_phone text;
  v_ok boolean := false;
BEGIN
  IF v_uid IS NULL OR p_mission_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    m.creator_id,
    m.cleaner_id,
    coalesce(m.crowdfunding_mode, false),
    nullif(btrim(coalesce(p.phone_number, '')), '')
  INTO v_creator, v_cleaner, v_crowdfunding, v_phone
  FROM public.missions m
  LEFT JOIN public.profiles p ON p.id = m.creator_id
  WHERE m.id = p_mission_id;

  IF v_creator IS NULL THEN
    RETURN NULL;
  END IF;

  -- Crowdfunding / public campaigns: never expose a private client phone.
  IF v_crowdfunding THEN
    RETURN NULL;
  END IF;

  -- Creator always sees own contact.
  IF v_uid = v_creator THEN
    RETURN v_phone;
  END IF;

  -- Platform admins (moderation).
  IF public.is_platform_admin(v_uid) THEN
    RETURN v_phone;
  END IF;

  -- Explicitly accepted bid on this mission.
  SELECT EXISTS (
    SELECT 1
    FROM public.mission_bids b
    WHERE b.mission_id = p_mission_id
      AND b.cleaner_id = v_uid
      AND lower(coalesce(b.status::text, '')) = 'accepted'
  ) INTO v_ok;

  IF coalesce(v_ok, false) THEN
    RETURN v_phone;
  END IF;

  -- Belt-and-suspenders: assigned cleaner on the mission row after accept.
  IF v_cleaner IS NOT NULL AND v_cleaner = v_uid THEN
    RETURN v_phone;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.get_mission_client_phone(uuid) IS
  'Private missions only: returns creator phone to creator, accepted bidder, assigned cleaner, or platform admin. Always NULL for crowdfunding.';

REVOKE ALL ON FUNCTION public.get_mission_client_phone(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mission_client_phone(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_mission_client_phone(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Assigned worker phone for mission creator (review / P2P contact)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_mission_worker_phone(p_mission_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_creator uuid;
  v_cleaner uuid;
  v_phone text;
BEGIN
  IF v_uid IS NULL OR p_mission_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT m.creator_id, m.cleaner_id
  INTO v_creator, v_cleaner
  FROM public.missions m
  WHERE m.id = p_mission_id;

  IF v_creator IS NULL OR v_cleaner IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_uid <> v_creator AND NOT public.is_platform_admin(v_uid) AND v_uid <> v_cleaner THEN
    RETURN NULL;
  END IF;

  SELECT nullif(btrim(coalesce(p.phone_number, '')), '')
  INTO v_phone
  FROM public.profiles p
  WHERE p.id = v_cleaner;

  RETURN v_phone;
END;
$$;

COMMENT ON FUNCTION public.get_mission_worker_phone(uuid) IS
  'Returns assigned cleaner phone to mission creator, the cleaner, or platform admin.';

REVOKE ALL ON FUNCTION public.get_mission_worker_phone(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mission_worker_phone(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_mission_worker_phone(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Admin batch phone lookup (dashboard)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_profile_phones(p_user_ids uuid[])
RETURNS TABLE(user_id uuid, phone_number text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT p.id, nullif(btrim(coalesce(p.phone_number, '')), '')
  FROM public.profiles p
  WHERE p.id = ANY (p_user_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_profile_phones(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_profile_phones(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_profile_phones(uuid[]) TO service_role;

-- ---------------------------------------------------------------------------
-- 5) Column-level lockdown (PostgREST cannot SELECT phone_number)
-- ---------------------------------------------------------------------------
REVOKE SELECT (phone_number) ON TABLE public.profiles FROM PUBLIC;
REVOKE SELECT (phone_number) ON TABLE public.profiles FROM anon;
REVOKE SELECT (phone_number) ON TABLE public.profiles FROM authenticated;

-- service_role / postgres retain access for Edge Functions & SECURITY DEFINER.
GRANT SELECT (phone_number) ON TABLE public.profiles TO service_role;

COMMENT ON COLUMN public.profiles.phone_number IS
  'PRIVATE contact. Clients: get_own_phone_number / get_mission_client_phone / get_mission_worker_phone. Admins: admin_get_profile_phones. Direct SELECT revoked for anon/authenticated.';
