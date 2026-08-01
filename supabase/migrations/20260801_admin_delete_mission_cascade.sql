-- Admin hard-delete mission with explicit child cleanup (SECURITY DEFINER).
-- Fixes FK / RLS failures when moderating illegal missions from Admin Console.

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

  IF p_mission_id IS NULL THEN
    RAISE EXCEPTION 'Mission id required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.missions WHERE id = p_mission_id) THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  -- Explicit deletes so missing ON DELETE CASCADE / RLS never blocks admin moderation.
  IF to_regclass('public.mission_chats') IS NOT NULL THEN
    DELETE FROM public.mission_chats WHERE mission_id = p_mission_id;
  END IF;

  IF to_regclass('public.mission_bids') IS NOT NULL THEN
    DELETE FROM public.mission_bids WHERE mission_id = p_mission_id;
  END IF;

  IF to_regclass('public.contributions') IS NOT NULL THEN
    DELETE FROM public.contributions WHERE mission_id = p_mission_id;
  END IF;

  IF to_regclass('public.notifications') IS NOT NULL THEN
    DELETE FROM public.notifications WHERE mission_id = p_mission_id;
  END IF;

  IF to_regclass('public.reviews') IS NOT NULL THEN
    DELETE FROM public.reviews WHERE mission_id = p_mission_id;
  END IF;

  IF to_regclass('public.city_notification_events') IS NOT NULL THEN
    DELETE FROM public.city_notification_events WHERE mission_id = p_mission_id;
  END IF;

  -- Ledger rows may reference missions with ON DELETE SET NULL or RESTRICT.
  IF to_regclass('public.transactions') IS NOT NULL THEN
    BEGIN
      UPDATE public.transactions
      SET mission_id = NULL
      WHERE mission_id = p_mission_id;
    EXCEPTION
      WHEN undefined_column THEN
        NULL;
      WHEN OTHERS THEN
        -- If mission_id is NOT NULL, fall back to deleting the rows.
        BEGIN
          DELETE FROM public.transactions WHERE mission_id = p_mission_id;
        EXCEPTION
          WHEN OTHERS THEN
            RAISE NOTICE 'admin_delete_mission: transactions cleanup skipped: %', SQLERRM;
        END;
    END;
  END IF;

  DELETE FROM public.missions WHERE id = p_mission_id;
END;
$$;

COMMENT ON FUNCTION public.admin_delete_mission(uuid) IS
  'Platform-admin only. Cascades child rows then deletes the mission (moderation).';

REVOKE ALL ON FUNCTION public.admin_delete_mission(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_mission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_mission(uuid) TO service_role;
