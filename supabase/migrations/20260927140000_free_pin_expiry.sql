-- ============================================================================
-- Free garbage pins — lazy expiry + optional pg_cron
-- ----------------------------------------------------------------------------
-- Apply after the Garba-Vortex files (do NOT db push):
--   supabase db query --linked -f supabase/migrations/20260927140000_free_pin_expiry.sql
-- Idempotent. Does not rewrite apply_stripe_contribution.
--
-- A $0 free pin (status=reported) is hidden once crowdfunding_expires_at
-- (or created_at + 7 days) is in the past. Reads already drop those rows via
-- garba_free_pin_still_live, so a missed cron job does not keep them on the map.
--
-- Any successful Stripe contribution already sets
-- crowdfunding_expires_at = GREATEST(existing, now() + 30 days)
-- inside apply_stripe_contribution. A later contribution extends again.
-- There is no token-denominated contribution RPC; current_funding is USD.
-- This file does not create a mission. Opening a Cleanup Sector stays on
-- open_cleanup_sector_mission (explicit auth.uid() action).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.expire_stale_free_garbage_pins()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  -- pg_cron and the service role call with no end-user JWT.
  -- A signed-in caller must be a platform admin.
  IF auth.uid() IS NOT NULL AND NOT coalesce(public.is_platform_admin(auth.uid()), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.missions
  SET
    status = 'hidden',
    crowdfunding_expires_at = COALESCE(
      crowdfunding_expires_at,
      created_at + interval '7 days'
    )
  WHERE hidden_at IS NULL
    AND lower(coalesce(status::text, '')) = 'reported'
    AND coalesce(current_funding, 0) <= 0
    AND (
      coalesce(is_report, false)
      OR lower(coalesce(status::text, '')) = 'reported'
    )
    AND coalesce(crowdfunding_expires_at, created_at + interval '7 days') <= now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_free_garbage_pins() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_stale_free_garbage_pins() FROM anon;
GRANT EXECUTE ON FUNCTION public.expire_stale_free_garbage_pins() TO authenticated, service_role;

COMMENT ON FUNCTION public.expire_stale_free_garbage_pins() IS
  'Hide $0 free reports past the 7-day clock. service_role, pg_cron, or a platform admin. Does not create missions or city notices.';

-- Schedule only when pg_cron is already installed or can be created.
-- Supabase often requires the extension to be enabled in the dashboard first.
DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron is not installed. Call expire_stale_free_garbage_pins() from service_role or an admin. Reads already omit expired free pins.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-free-garbage-pins') THEN
    PERFORM cron.unschedule('expire-free-garbage-pins');
  END IF;

  PERFORM cron.schedule(
    'expire-free-garbage-pins',
    '15 * * * *',
    $job$SELECT public.expire_stale_free_garbage_pins();$job$
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron unavailable (%). Call expire_stale_free_garbage_pins() from service_role or an admin. Reads already omit expired free pins.',
      SQLERRM;
END
$cron$;
