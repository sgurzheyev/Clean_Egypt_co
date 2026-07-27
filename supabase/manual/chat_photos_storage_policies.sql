-- ============================================================================
-- Manual: chat-photos storage RLS (Dashboard SQL Editor / storage owner)
-- ============================================================================
-- Hosted Supabase often blocks migration DDL on storage.objects
-- (ERROR 42501: must be owner of table objects). Run this once after
-- 20260727_mission_chat_photos.sql creates the bucket.
-- Path convention: {mission_id}/{user_id}/{filename}.jpg
-- ============================================================================

DROP POLICY IF EXISTS chat_photos_public_read ON storage.objects;
CREATE POLICY chat_photos_public_read
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'chat-photos');

DROP POLICY IF EXISTS chat_photos_insert_participants ON storage.objects;
CREATE POLICY chat_photos_insert_participants
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'chat-photos'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND public.is_mission_chat_participant(
      ((storage.foldername(name))[1])::uuid,
      auth.uid()
    )
  );

DROP POLICY IF EXISTS chat_photos_update_own ON storage.objects;
CREATE POLICY chat_photos_update_own
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'chat-photos'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[2] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'chat-photos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS chat_photos_delete_own ON storage.objects;
CREATE POLICY chat_photos_delete_own
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'chat-photos'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
