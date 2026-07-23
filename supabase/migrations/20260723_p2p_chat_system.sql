-- ============================================================================
-- Phase 4: In-app P2P chat (mission_chats) + RLS + Realtime
-- ============================================================================
-- Negotiate on-platform between mission creator and bidders / assigned cleaner
-- before (and after) bid acceptance. Phone numbers stay gated by Phase 3 RPCs.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mission_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message text NOT NULL CHECK (char_length(btrim(message)) > 0 AND char_length(message) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  is_read boolean NOT NULL DEFAULT false,
  CONSTRAINT mission_chats_no_self_message CHECK (sender_id <> receiver_id)
);

COMMENT ON TABLE public.mission_chats IS
  'Phase 4 P2P messages scoped to a mission thread (creator ↔ bidder/cleaner).';

CREATE INDEX IF NOT EXISTS idx_mission_chats_mission_created
  ON public.mission_chats (mission_id, created_at);

CREATE INDEX IF NOT EXISTS idx_mission_chats_sender_receiver
  ON public.mission_chats (sender_id, receiver_id);

CREATE INDEX IF NOT EXISTS idx_mission_chats_receiver_unread
  ON public.mission_chats (receiver_id, is_read, created_at DESC)
  WHERE is_read = false;

-- ---------------------------------------------------------------------------
-- Participant helpers (SECURITY DEFINER so RLS can evaluate cleanly)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_mission_chat_participant(p_mission_id uuid, p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.missions m
    WHERE m.id = p_mission_id
      AND (
        m.creator_id = p_uid
        OR m.cleaner_id = p_uid
        OR EXISTS (
          SELECT 1
          FROM public.mission_bids b
          WHERE b.mission_id = m.id
            AND b.cleaner_id = p_uid
            AND lower(coalesce(b.status::text, '')) IN ('pending', 'accepted')
        )
      )
  );
$$;

COMMENT ON FUNCTION public.is_mission_chat_participant(uuid, uuid) IS
  'True if uid is mission creator, assigned cleaner, or has a pending/accepted bid.';

REVOKE ALL ON FUNCTION public.is_mission_chat_participant(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_mission_chat_participant(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_mission_chat_participant(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.mission_chats ENABLE ROW LEVEL SECURITY;

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
      OR public.is_mission_chat_participant(mission_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS mission_chats_insert_participants ON public.mission_chats;
CREATE POLICY mission_chats_insert_participants
  ON public.mission_chats
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND sender_id = auth.uid()
    AND public.is_mission_chat_participant(mission_id, auth.uid())
    AND public.is_mission_chat_participant(mission_id, receiver_id)
    -- Counterparty must be the other side of the same mission thread
    AND EXISTS (
      SELECT 1
      FROM public.missions m
      WHERE m.id = mission_id
        AND (
          -- Creator messaging a bidder / assigned cleaner
          (
            m.creator_id = auth.uid()
            AND (
              m.cleaner_id = receiver_id
              OR EXISTS (
                SELECT 1
                FROM public.mission_bids b
                WHERE b.mission_id = m.id
                  AND b.cleaner_id = receiver_id
                  AND lower(coalesce(b.status::text, '')) IN ('pending', 'accepted')
              )
            )
          )
          -- Bidder / cleaner messaging the creator
          OR (
            m.creator_id = receiver_id
            AND (
              m.cleaner_id = auth.uid()
              OR EXISTS (
                SELECT 1
                FROM public.mission_bids b
                WHERE b.mission_id = m.id
                  AND b.cleaner_id = auth.uid()
                  AND lower(coalesce(b.status::text, '')) IN ('pending', 'accepted')
              )
            )
          )
        )
    )
  );

-- Receivers (and senders) may mark their inbound messages as read.
DROP POLICY IF EXISTS mission_chats_update_read ON public.mission_chats;
CREATE POLICY mission_chats_update_read
  ON public.mission_chats
  FOR UPDATE
  TO authenticated
  USING (receiver_id = auth.uid() OR sender_id = auth.uid())
  WITH CHECK (receiver_id = auth.uid() OR sender_id = auth.uid());

-- No client deletes (moderation later via admin/service role if needed).
DROP POLICY IF EXISTS mission_chats_no_delete ON public.mission_chats;
CREATE POLICY mission_chats_no_delete
  ON public.mission_chats
  FOR DELETE
  TO authenticated
  USING (false);

-- ---------------------------------------------------------------------------
-- Realtime publication (safe if already added)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.mission_chats;
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'mission_chats already in supabase_realtime publication';
  WHEN undefined_object THEN
    RAISE NOTICE 'supabase_realtime publication missing — enable Realtime in Dashboard';
END $$;

-- Optional: ensure replica identity full for filtered realtime (mission_id filter).
ALTER TABLE public.mission_chats REPLICA IDENTITY FULL;
