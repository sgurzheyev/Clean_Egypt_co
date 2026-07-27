-- ============================================================================
-- Mission chat photo attachments (image_url + chat-photos storage)
-- ============================================================================
-- Pre-job photo negotiation alongside text in mission_chats.
-- Path convention: {mission_id}/{user_id}/{filename}.jpg
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Schema: optional image_url; allow caption-less photo messages
-- ---------------------------------------------------------------------------
ALTER TABLE public.mission_chats
  ADD COLUMN IF NOT EXISTS image_url text;

COMMENT ON COLUMN public.mission_chats.image_url IS
  'Optional public Storage URL for an in-chat photo (chat-photos bucket).';

ALTER TABLE public.mission_chats
  ALTER COLUMN message SET DEFAULT '';

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'mission_chats'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%message%'
      AND c.conname <> 'mission_chats_no_self_message'
  LOOP
    EXECUTE format('ALTER TABLE public.mission_chats DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.mission_chats
  DROP CONSTRAINT IF EXISTS mission_chats_message_or_image_check;

ALTER TABLE public.mission_chats
  ADD CONSTRAINT mission_chats_message_or_image_check CHECK (
    (
      char_length(btrim(coalesce(message, ''))) > 0
      AND char_length(coalesce(message, '')) <= 4000
    )
    OR (
      image_url IS NOT NULL
      AND char_length(btrim(image_url)) > 0
      AND char_length(coalesce(message, '')) <= 4000
    )
  );

-- ---------------------------------------------------------------------------
-- 2) Notification copy for photo-only messages
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_mission_chat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_snippet text;
  v_body text;
  v_msg text;
BEGIN
  IF NEW.receiver_id IS NULL OR NEW.sender_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.receiver_id = NEW.sender_id THEN
    RETURN NEW;
  END IF;

  v_name := coalesce(public.notification_actor_label(NEW.sender_id), 'Eco-Hero');
  v_msg := trim(coalesce(NEW.message, ''));

  IF v_msg <> '' THEN
    v_snippet := left(v_msg, 80);
    IF length(v_msg) > 80 THEN
      v_snippet := v_snippet || '…';
    END IF;
  ELSIF NEW.image_url IS NOT NULL AND length(btrim(NEW.image_url)) > 0 THEN
    v_snippet := '📷 Photo';
  ELSE
    v_snippet := '…';
  END IF;

  v_body := format('New message from %s: %s', v_name, v_snippet);

  PERFORM public.create_notification(
    NEW.receiver_id,
    'chat_message',
    NEW.mission_id,
    NEW.sender_id,
    'New chat message',
    v_body
  );

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Storage bucket for compressed chat images
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-photos',
  'chat-photos',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Hosted Supabase may reject storage.objects policy DDL (must be owner).
-- Bucket insert above still applies; run supabase/manual/chat_photos_storage_policies.sql
-- in the Dashboard SQL editor if the policies below fail.
DO $$
BEGIN
  BEGIN
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
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE
        'chat-photos storage policies skipped (not owner of storage.objects) — run supabase/manual/chat_photos_storage_policies.sql';
    WHEN OTHERS THEN
      RAISE NOTICE 'chat-photos storage policies skipped: %', SQLERRM;
  END;
END $$;
