-- Admin factory reset (Nuke All) — wipe operational data, keep profiles.
-- For staging / QA only. Requires is_platform_admin(auth.uid()).

CREATE OR REPLACE FUNCTION public.admin_factory_reset()
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

  -- 1. Dependent tables first
  IF to_regclass('public.mission_chats') IS NOT NULL THEN DELETE FROM public.mission_chats; END IF;
  IF to_regclass('public.mission_bids') IS NOT NULL THEN DELETE FROM public.mission_bids; END IF;
  IF to_regclass('public.contributions') IS NOT NULL THEN DELETE FROM public.contributions; END IF;
  IF to_regclass('public.notifications') IS NOT NULL THEN DELETE FROM public.notifications; END IF;
  IF to_regclass('public.reviews') IS NOT NULL THEN DELETE FROM public.reviews; END IF;
  IF to_regclass('public.city_notification_events') IS NOT NULL THEN DELETE FROM public.city_notification_events; END IF;
  IF to_regclass('public.transactions') IS NOT NULL THEN DELETE FROM public.transactions; END IF;

  -- 2. Missions last
  IF to_regclass('public.missions') IS NOT NULL THEN DELETE FROM public.missions; END IF;
END;
$$;

COMMENT ON FUNCTION public.admin_factory_reset() IS
  'Platform-admin only. Deletes all missions/bids/transactions/etc. Keeps profiles.';

REVOKE ALL ON FUNCTION public.admin_factory_reset() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_factory_reset() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_factory_reset() TO service_role;
