-- ============================================================================
-- Harden mission_chats RLS: stop cross-bidder message leaks
-- ============================================================================
-- Problem: SELECT used is_mission_chat_participant(), so any pending/accepted
-- bidder on a mission could read ALL threads on that mission (not only their
-- pair with the creator). UPDATE also allowed the sender to rewrite rows.
--
-- Fix:
--   SELECT  → auth.uid() IN (sender_id, receiver_id) OR platform admin
--   UPDATE  → receiver only (mark-as-read) OR platform admin
-- INSERT stays participant-gated (creator ↔ bidder/cleaner pair checks).
-- service_role continues to bypass RLS (delete-account, admin cascades).
-- ============================================================================

-- Pair-only SELECT (plus platform admin for moderation / support).
DROP POLICY IF EXISTS mission_chats_select_participants ON public.mission_chats;
CREATE POLICY mission_chats_select_participants
  ON public.mission_chats
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      sender_id = auth.uid()
      OR receiver_id = auth.uid()
      OR public.is_platform_admin(auth.uid())
    )
  );

COMMENT ON POLICY mission_chats_select_participants ON public.mission_chats IS
  'Read only own thread messages (sender or receiver); platform admins retain full SELECT.';

-- Receiver-only UPDATE (mark is_read). Senders can no longer rewrite content.
-- Admins keep UPDATE for moderation tooling.
DROP POLICY IF EXISTS mission_chats_update_read ON public.mission_chats;
CREATE POLICY mission_chats_update_read
  ON public.mission_chats
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      receiver_id = auth.uid()
      OR public.is_platform_admin(auth.uid())
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      receiver_id = auth.uid()
      OR public.is_platform_admin(auth.uid())
    )
  );

COMMENT ON POLICY mission_chats_update_read ON public.mission_chats IS
  'Only the receiver may update (e.g. is_read); platform admins retain UPDATE.';

-- Prevent non-admin clients from mutating body / parties via UPDATE.
-- Receivers may only flip is_read (and touch nothing else).
CREATE OR REPLACE FUNCTION public.mission_chats_restrict_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_platform_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF NEW.mission_id IS DISTINCT FROM OLD.mission_id
     OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.receiver_id IS DISTINCT FROM OLD.receiver_id
     OR NEW.message IS DISTINCT FROM OLD.message
     OR NEW.image_url IS DISTINCT FROM OLD.image_url
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'mission_chats: only is_read may be updated by the receiver'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.mission_chats_restrict_update() IS
  'Blocks non-admin UPDATEs from changing anything except is_read.';

DROP TRIGGER IF EXISTS trg_mission_chats_restrict_update ON public.mission_chats;
CREATE TRIGGER trg_mission_chats_restrict_update
  BEFORE UPDATE ON public.mission_chats
  FOR EACH ROW
  EXECUTE FUNCTION public.mission_chats_restrict_update();

REVOKE ALL ON FUNCTION public.mission_chats_restrict_update() FROM PUBLIC;
