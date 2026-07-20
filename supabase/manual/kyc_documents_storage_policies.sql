-- =============================================================================
-- KYC bucket storage policies (manual setup for hosted Supabase)
-- =============================================================================
-- The SQL Editor `postgres` role cannot ALTER/DROP/CREATE policies on
-- storage.objects (ERROR 42501: must be owner of table objects).
-- RLS is already enabled on storage.objects by Supabase — do NOT run ALTER TABLE.
--
-- RECOMMENDED: configure via Dashboard (steps below).
-- OPTIONAL: try the CREATE POLICY block at the bottom via psql session pooler
--           (sometimes works when SQL Editor does not).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- OPTION A — Supabase Dashboard (recommended)
-- -----------------------------------------------------------------------------
-- 1. Storage → Buckets → confirm `kyc_documents` exists (Private, not public).
--    If missing: New bucket → id/name `kyc_documents`, Public OFF.
-- 2. Bucket settings (optional, match migration):
--    - File size limit: 20 MB (20971520 bytes)
--    - Allowed MIME: image/jpeg, image/png, image/webp, video/webm, video/mp4,
--      video/quicktime
-- 3. Open bucket `kyc_documents` → tab **Policies** → **New policy**.
--    For each row below, choose "For full customization" / raw SQL if offered.
--
-- | Policy name                  | Operation | Target roles   | Expression type |
-- |------------------------------|-----------|----------------|-----------------|
-- | kyc_documents_insert_own     | INSERT    | authenticated  | WITH CHECK      |
-- | kyc_documents_select_own     | SELECT    | authenticated  | USING           |
-- | kyc_documents_select_admins  | SELECT    | authenticated  | USING           |
-- | kyc_documents_update_own     | UPDATE    | authenticated  | USING + CHECK   |
-- | kyc_documents_delete_own     | DELETE    | authenticated  | USING           |
--
-- kyc_documents_insert_own — WITH CHECK:
--   bucket_id = 'kyc_documents' AND (select auth.uid()) = owner
--
-- kyc_documents_select_own — USING:
--   bucket_id = 'kyc_documents' AND (select auth.uid()) = owner
--
-- kyc_documents_select_admins — USING:
--   bucket_id = 'kyc_documents' AND EXISTS (
--     SELECT 1 FROM public.profiles p
--     WHERE p.id = (select auth.uid())
--       AND lower(coalesce(p.role, '')) = 'admin'
--   )
--
-- kyc_documents_update_own — USING and WITH CHECK (same):
--   bucket_id = 'kyc_documents' AND (select auth.uid()) = owner
--
-- kyc_documents_delete_own — USING:
--   bucket_id = 'kyc_documents' AND (select auth.uid()) = owner
--
-- 4. Save each policy. KYC upload + admin review previews will fail until these exist.

-- -----------------------------------------------------------------------------
-- OPTION B — psql (optional; Dashboard UI is still preferred)
-- -----------------------------------------------------------------------------
-- Connect via Dashboard → Connect → Session pooler → psql, then run ONLY the
-- CREATE POLICY statements below (skip ALTER TABLE and DROP POLICY).
-- If you get 42501 here too, use Option A.

/*
CREATE POLICY kyc_documents_insert_own
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'kyc_documents'
  AND (select auth.uid()) = owner
);

CREATE POLICY kyc_documents_select_own
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'kyc_documents'
  AND (select auth.uid()) = owner
);

CREATE POLICY kyc_documents_select_admins
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'kyc_documents'
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (select auth.uid())
      AND lower(coalesce(p.role, '')) = 'admin'
  )
);

CREATE POLICY kyc_documents_update_own
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'kyc_documents'
  AND (select auth.uid()) = owner
)
WITH CHECK (
  bucket_id = 'kyc_documents'
  AND (select auth.uid()) = owner
);

CREATE POLICY kyc_documents_delete_own
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'kyc_documents'
  AND (select auth.uid()) = owner
);
*/
