-- Enrich pending KYC list with auth.users email when profiles.full_name /
-- contact_email are empty (common for Telegram / incomplete profiles).

CREATE OR REPLACE FUNCTION public.list_pending_kyc_profiles()
RETURNS TABLE (
  id uuid,
  full_name text,
  telegram_username text,
  contact_email text,
  phone_number text,
  verification_document_type text,
  verification_photo_front text,
  verification_photo_back text,
  verification_liveness_video text,
  avatar_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
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

  RETURN QUERY
  SELECT
    p.id,
    COALESCE(
      NULLIF(trim(p.full_name), ''),
      NULLIF(split_part(COALESCE(u.email, ''), '@', 1), ''),
      'Worker'
    ) AS full_name,
    p.telegram_username,
    COALESCE(
      NULLIF(trim(p.contact_email), ''),
      NULLIF(trim(u.email), '')
    ) AS contact_email,
    p.phone_number,
    p.verification_document_type,
    p.verification_photo_front,
    p.verification_photo_back,
    p.verification_liveness_video,
    p.avatar_url
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE lower(coalesce(p.verification_status, '')) = 'pending'
  ORDER BY 2 NULLS LAST, p.id;
END;
$$;

REVOKE ALL ON FUNCTION public.list_pending_kyc_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_pending_kyc_profiles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_kyc_profiles() TO service_role;

COMMENT ON FUNCTION public.list_pending_kyc_profiles() IS
  'Admin-only: pending KYC rows with auth.users email fallback for display name/contact.';

-- Allow authenticated clients / Edge Functions (user JWT) to call admin check.
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO service_role;
