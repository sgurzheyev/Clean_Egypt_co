-- ============================================================================
-- KYC Identity Verification (workers for Home/Private missions)
-- ============================================================================
-- Phase 1: Database & Storage security
--   - profiles.verification_status + KYC media references
--   - private storage bucket: kyc_documents
--   - strict Storage RLS: users can only access their own objects; admins can
--     view all objects in this bucket.
--   - user-facing RPC: submit_kyc_verification (sets status='pending')
-- ============================================================================

-- 1) Storage bucket: kyc_documents (private)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'kyc_documents') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('kyc_documents', 'kyc_documents', false);
  END IF;
END $$;

-- Tighten allowed mime types + upload size for KYC media.
-- Images: jpeg/png/webp; Video: webm/mp4/quicktime
UPDATE storage.buckets
SET
  public = false,
  file_size_limit = 20971520,
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/webm',
    'video/mp4',
    'video/quicktime'
  ]::text[]
WHERE id = 'kyc_documents';

-- 2) profiles columns for verification flow
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verification_status text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verification_document_type text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verification_photo_front text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verification_photo_back text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verification_liveness_video text;

-- Default to "unverified" when missing.
UPDATE public.profiles
SET verification_status = 'unverified'
WHERE verification_status IS NULL;

-- Ensure verification_status is within expected values.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_verification_status_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_verification_status_check
      CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected'));
  END IF;
END $$;

-- Keep is_verified and verification_status consistent.
-- Admin currently toggles public.profiles.is_verified, so we sync verification_status.
CREATE OR REPLACE FUNCTION public._sync_is_verified_from_verification_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.verification_status = 'verified' THEN
    NEW.is_verified := true;
  ELSIF NEW.verification_status IN ('pending', 'unverified', 'rejected') THEN
    NEW.is_verified := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS _sync_is_verified_from_verification_status ON public.profiles;
CREATE TRIGGER _sync_is_verified_from_verification_status
BEFORE INSERT OR UPDATE OF verification_status
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public._sync_is_verified_from_verification_status();

CREATE OR REPLACE FUNCTION public._sync_verification_status_from_is_verified()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_verified = true THEN
    NEW.verification_status := 'verified';
  ELSE
    -- Only demote verified -> unverified. Preserve pending/rejected.
    IF OLD.verification_status = 'verified' THEN
      NEW.verification_status := 'unverified';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS _sync_verification_status_from_is_verified ON public.profiles;
CREATE TRIGGER _sync_verification_status_from_is_verified
BEFORE INSERT OR UPDATE OF is_verified
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public._sync_verification_status_from_is_verified();

-- 3) User submission RPC: upload must happen client-side to storage, then this RPC
--    marks verification_status='pending' and stores object names in profiles.
CREATE OR REPLACE FUNCTION public.submit_kyc_verification(
  p_doc_type text,
  p_photo_front_object_name text,
  p_liveness_video_object_name text,
  p_photo_back_object_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  front_ok boolean;
  back_ok boolean;
  live_ok boolean;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_photo_front_object_name IS NULL OR length(trim(p_photo_front_object_name)) = 0 THEN
    RAISE EXCEPTION 'Front document is required';
  END IF;

  -- Front must exist in kyc_documents and belong to this user.
  SELECT true INTO front_ok
  FROM storage.objects o
  WHERE o.bucket_id = 'kyc_documents'
    AND o.owner = uid
    AND o.name = p_photo_front_object_name
  LIMIT 1;

  IF front_ok IS NULL THEN
    RAISE EXCEPTION 'Front document is missing from storage or not owned by user';
  END IF;

  -- Back is optional.
  IF p_photo_back_object_name IS NOT NULL AND length(trim(p_photo_back_object_name)) > 0 THEN
    SELECT true INTO back_ok
    FROM storage.objects o
    WHERE o.bucket_id = 'kyc_documents'
      AND o.owner = uid
      AND o.name = p_photo_back_object_name
    LIMIT 1;

    IF back_ok IS NULL THEN
      RAISE EXCEPTION 'Back document is missing from storage or not owned by user';
    END IF;
  ELSE
    p_photo_back_object_name := NULL;
  END IF;

  IF p_liveness_video_object_name IS NULL OR length(trim(p_liveness_video_object_name)) = 0 THEN
    RAISE EXCEPTION 'Liveness video is required';
  END IF;

  -- Liveness video must exist and be owned by this user.
  SELECT true INTO live_ok
  FROM storage.objects o
  WHERE o.bucket_id = 'kyc_documents'
    AND o.owner = uid
    AND o.name = p_liveness_video_object_name
  LIMIT 1;

  IF live_ok IS NULL THEN
    RAISE EXCEPTION 'Liveness video is missing from storage or not owned by user';
  END IF;

  UPDATE public.profiles
  SET
    verification_status = 'pending',
    verification_document_type = p_doc_type,
    verification_photo_front = p_photo_front_object_name,
    verification_photo_back = p_photo_back_object_name,
    verification_liveness_video = p_liveness_video_object_name
  WHERE id = uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_kyc_verification(
  text, text, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_kyc_verification(
  text, text, text, text
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.submit_kyc_verification(
  text, text, text, text
) TO service_role;

-- 4) Storage RLS for kyc_documents
-- Hosted Supabase projects: postgres cannot ALTER/DROP/CREATE policies on storage.objects
-- (ERROR 42501: must be owner of table objects). RLS is already enabled on storage.objects.
-- Configure bucket policies via Dashboard OR supabase/manual/kyc_documents_storage_policies.sql

