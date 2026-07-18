-- Admin moderation: hard-delete illegal/bad missions from the public map.
-- Also alias confirm_mission_work_done for the owner "work done" flow.

CREATE OR REPLACE FUNCTION public.is_platform_admin(p_uid uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_is_admin boolean := false;
BEGIN
  IF p_uid IS NULL THEN
    RETURN false;
  END IF;

  IF coalesce((auth.jwt() ->> 'role'), '') = 'service_role' THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_uid
      AND lower(coalesce(p.role::text, '')) = 'admin'
  ) INTO v_is_admin;

  IF v_is_admin THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE u.id = p_uid
      AND (
        u.email = 'sgurzheyev@gmail.com'
        OR u.email ilike '%tg_6618910143%'
      )
  ) INTO v_is_admin;

  IF v_is_admin THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_uid
      AND lower(p.telegram_username) = 'sergiogurgini'
  ) INTO v_is_admin;

  RETURN coalesce(v_is_admin, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_mission(p_mission_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_platform_admin(v_uid) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.missions WHERE id = p_mission_id) THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  DELETE FROM public.mission_bids WHERE mission_id = p_mission_id;
  DELETE FROM public.missions WHERE id = p_mission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_mission(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_mission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_mission(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_mission_work_done(p_mission_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.confirm_mission_direct_payment(p_mission_id);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_mission_work_done(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_mission_work_done(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_mission_work_done(uuid) TO service_role;
