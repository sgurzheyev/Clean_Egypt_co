-- ============================================================================
-- Wave H — Surface & Token Hardening (SEC-5)
-- ----------------------------------------------------------------------------
-- SEC-5: upsert_user_push_token token theft prevention.
--   - If token already belongs to another user (user_id <> auth.uid()),
--     reject the update instead of silently stealing device tokens.
--   - Keep on-device re-registration safe for the same user.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.upsert_user_push_token(
  p_token text,
  p_platform text DEFAULT 'web'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  v_platform text;
  v_id uuid;
  v_existing_user uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_token IS NULL OR length(trim(p_token)) < 8 THEN
    RAISE EXCEPTION 'Invalid push token';
  END IF;

  v_platform := lower(trim(coalesce(nullif(p_platform, ''), 'web')));
  IF v_platform NOT IN ('web', 'android', 'ios') THEN
    v_platform := 'web';
  END IF;

  -- SEC-5 check: prevent device token hijacking
  SELECT user_id INTO v_existing_user
  FROM public.user_push_tokens
  WHERE token = trim(p_token);

  IF v_existing_user IS NOT NULL AND v_existing_user <> uid THEN
    RAISE EXCEPTION 'Push token is already registered to another user';
  END IF;

  INSERT INTO public.user_push_tokens (user_id, token, platform, last_used_at)
  VALUES (uid, trim(p_token), v_platform, now())
  ON CONFLICT (token) DO UPDATE
  SET
    platform = EXCLUDED.platform,
    last_used_at = now()
  WHERE public.user_push_tokens.user_id = uid
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_user_push_token(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_user_push_token(text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.upsert_user_push_token(text, text) IS
  'Wave H (SEC-5): Safe token registration. Blocks hijacking tokens belonging to another user.';

COMMIT;
