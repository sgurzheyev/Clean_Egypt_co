-- ============================================================================
-- KYC Admin Moderation — list pending applications + approve/reject RPC
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verification_rejection_reason text;

COMMENT ON COLUMN public.profiles.verification_rejection_reason IS
  'Optional admin note when KYC is rejected.';

-- Admin-only: list users awaiting KYC review.
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

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.telegram_username,
    p.contact_email,
    p.phone_number,
    p.verification_document_type,
    p.verification_photo_front,
    p.verification_photo_back,
    p.verification_liveness_video,
    p.avatar_url
  FROM public.profiles p
  WHERE lower(coalesce(p.verification_status, '')) = 'pending'
  ORDER BY p.full_name NULLS LAST, p.id;
END;
$$;

REVOKE ALL ON FUNCTION public.list_pending_kyc_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_pending_kyc_profiles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_kyc_profiles() TO service_role;

-- Admin-only: approve or reject a pending KYC application.
CREATE OR REPLACE FUNCTION public.moderate_kyc_verification(
  p_user_id uuid,
  p_decision text,
  p_rejection_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_decision text := lower(trim(coalesce(p_decision, '')));
  v_current_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_platform_admin(v_uid) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User id is required';
  END IF;

  IF v_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Decision must be approve or reject';
  END IF;

  SELECT lower(coalesce(verification_status, ''))
  INTO v_current_status
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF v_current_status <> 'pending' THEN
    RAISE EXCEPTION 'User is not pending KYC review (status=%)', v_current_status;
  END IF;

  IF v_decision = 'approve' THEN
    UPDATE public.profiles
    SET
      verification_status = 'verified',
      verification_rejection_reason = NULL
    WHERE id = p_user_id;
  ELSE
    UPDATE public.profiles
    SET
      verification_status = 'rejected',
      verification_rejection_reason = CASE
        WHEN p_rejection_reason IS NULL OR length(trim(p_rejection_reason)) = 0
          THEN NULL
        ELSE left(trim(p_rejection_reason), 500)
      END
    WHERE id = p_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.moderate_kyc_verification(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.moderate_kyc_verification(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.moderate_kyc_verification(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.moderate_kyc_verification(uuid, text, text) IS
  'Admin-only: approve (verified) or reject pending KYC. Syncs is_verified via trigger.';
