-- Direct-payment model: mission creator confirms they paid the worker offline and closes the mission.

CREATE OR REPLACE FUNCTION public.block_participants_status_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid;
  v_is_admin boolean := false;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF coalesce((auth.jwt() ->> 'role'), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE u.id = v_uid
      AND (
        u.email = 'sgurzheyev@gmail.com'
        OR u.email ilike '%tg_6618910143%'
      )
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = v_uid
        AND lower(p.telegram_username) = 'sergiogurgini'
    ) INTO v_is_admin;
  END IF;

  -- Creator confirms direct payment after worker proof (review → completed).
  IF NEW.status = 'completed'
     AND NOT v_is_admin
     AND OLD.creator_id IS NOT NULL
     AND OLD.creator_id = v_uid
     AND lower(coalesce(OLD.status::text, '')) IN ('review', 'pending_approval')
  THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'completed'
     AND NOT v_is_admin
     AND (
       (OLD.cleaner_id IS NOT NULL AND OLD.cleaner_id = v_uid)
       OR
       (OLD.creator_id IS NOT NULL AND OLD.creator_id = v_uid)
     )
  THEN
    RAISE EXCEPTION 'Security Error: Only admin/system can mark missions as completed.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_mission_direct_payment(p_mission_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mission record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT *
  INTO v_mission
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  IF v_mission.creator_id IS NULL OR v_mission.creator_id <> v_uid THEN
    RAISE EXCEPTION 'Only the mission creator can confirm payment';
  END IF;

  IF lower(coalesce(v_mission.status::text, '')) NOT IN ('review', 'pending_approval') THEN
    RAISE EXCEPTION 'Mission is not awaiting client review';
  END IF;

  IF v_mission.cleaner_id IS NULL THEN
    RAISE EXCEPTION 'No worker assigned';
  END IF;

  UPDATE public.missions
  SET
    status = 'completed',
    is_disputed = false
  WHERE id = p_mission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_mission_direct_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_mission_direct_payment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_mission_direct_payment(uuid) TO service_role;
