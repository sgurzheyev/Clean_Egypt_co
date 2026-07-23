-- ============================================================================
-- Lifecycle + chat → in-app Notification Bell
-- ============================================================================
-- Extends public.notifications with title/message, enables Realtime, and
-- automates inserts for: chat messages, new bids, bid accepted, funding
-- target bumps / campaign complete.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Schema: title + message (keep table name `notifications` — already live)
-- ---------------------------------------------------------------------------
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS title text;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS message text;

COMMENT ON COLUMN public.notifications.title IS
  'Short headline for the bell feed (optional; UI may fall back to type labels).';
COMMENT ON COLUMN public.notifications.message IS
  'Body / snippet shown under the title.';

-- ---------------------------------------------------------------------------
-- create_notification — support title/message (drop 4-arg overload)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_notification(uuid, text, uuid, uuid);

CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id uuid,
  p_type text,
  p_mission_id uuid DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_message text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_type IS NULL OR length(trim(p_type)) = 0 THEN
    RETURN NULL;
  END IF;
  -- Never notify yourself.
  IF p_actor_id IS NOT NULL AND p_user_id = p_actor_id THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notifications (user_id, type, mission_id, actor_id, title, message)
  VALUES (
    p_user_id,
    left(trim(p_type), 64),
    p_mission_id,
    p_actor_id,
    nullif(left(trim(coalesce(p_title, '')), 120), ''),
    nullif(left(trim(coalesce(p_message, '')), 500), '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_notification(uuid, text, uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid, text, uuid, uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.create_notification(uuid, text, uuid, uuid, text, text) IS
  'Internal: insert a notification (bypasses RLS). Used by triggers + lifecycle RPCs.';

-- Helper: display name for notification copy
CREATE OR REPLACE FUNCTION public.notification_actor_label(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    nullif(trim(p.full_name), ''),
    nullif(trim(p.telegram_username), ''),
    'Eco-Hero'
  )
  FROM public.profiles p
  WHERE p.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.notification_actor_label(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notification_actor_label(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Trigger: new chat message → recipient
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
BEGIN
  IF NEW.receiver_id IS NULL OR NEW.sender_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.receiver_id = NEW.sender_id THEN
    RETURN NEW;
  END IF;

  v_name := coalesce(public.notification_actor_label(NEW.sender_id), 'Eco-Hero');
  v_snippet := left(trim(coalesce(NEW.message, '')), 80);
  IF length(trim(coalesce(NEW.message, ''))) > 80 THEN
    v_snippet := v_snippet || '…';
  END IF;

  v_body := format('New message from %s: %s', v_name, coalesce(nullif(v_snippet, ''), '…'));

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

DROP TRIGGER IF EXISTS trg_notify_mission_chat ON public.mission_chats;
CREATE TRIGGER trg_notify_mission_chat
  AFTER INSERT ON public.mission_chats
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_mission_chat();

-- ---------------------------------------------------------------------------
-- Trigger: new pending bid → mission creator
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_mission_bid_new()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator uuid;
  v_amount integer;
BEGIN
  IF lower(coalesce(NEW.status::text, '')) <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT m.creator_id
  INTO v_creator
  FROM public.missions m
  WHERE m.id = NEW.mission_id;

  IF v_creator IS NULL THEN
    RETURN NEW;
  END IF;

  v_amount := greatest(1, floor(coalesce(NEW.bid_amount, 0)::numeric)::integer);

  PERFORM public.create_notification(
    v_creator,
    'bid_new',
    NEW.mission_id,
    NEW.cleaner_id,
    'New bid',
    format('New bid of $%s placed on your mission!', v_amount)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_mission_bid_new ON public.mission_bids;
CREATE TRIGGER trg_notify_mission_bid_new
  AFTER INSERT ON public.mission_bids
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_mission_bid_new();

-- ---------------------------------------------------------------------------
-- Trigger: bid accepted → winning worker
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_mission_bid_accepted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_raised integer;
  v_budget integer;
  v_msg text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF lower(coalesce(OLD.status::text, '')) = 'accepted' THEN
    RETURN NEW;
  END IF;
  IF lower(coalesce(NEW.status::text, '')) <> 'accepted' THEN
    RETURN NEW;
  END IF;

  SELECT
    lower(coalesce(m.status::text, '')),
    greatest(0, floor(coalesce(m.current_funding, 0)::numeric)::integer)
  INTO v_status, v_raised
  FROM public.missions m
  WHERE m.id = NEW.mission_id;

  v_budget := greatest(1, floor(coalesce(NEW.bid_amount, 0)::numeric)::integer);

  IF v_status = 'funding' AND v_raised < v_budget THEN
    v_msg := format(
      'Your bid was accepted! You are locked in — waiting for $%s more in crowdfunding.',
      greatest(0, v_budget - v_raised)
    );
  ELSE
    v_msg := 'Your bid was accepted! You are now the assigned cleaner.';
  END IF;

  PERFORM public.create_notification(
    NEW.cleaner_id,
    'bid_accepted',
    NEW.mission_id,
    NULL,
    'Bid accepted',
    v_msg
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_mission_bid_accepted ON public.mission_bids;
CREATE TRIGGER trg_notify_mission_bid_accepted
  AFTER UPDATE OF status ON public.mission_bids
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_mission_bid_accepted();

-- ---------------------------------------------------------------------------
-- Trigger: funding target bump / campaign funded → participants
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_mission_funding_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_status text := lower(coalesce(OLD.status::text, ''));
  v_new_status text := lower(coalesce(NEW.status::text, ''));
  v_old_target integer := greatest(0, floor(coalesce(OLD.expected_price, 0)::numeric)::integer);
  v_new_target integer := greatest(0, floor(coalesce(NEW.expected_price, 0)::numeric)::integer);
  v_raised integer := greatest(0, floor(coalesce(NEW.current_funding, 0)::numeric)::integer);
  v_cleaner_changed boolean := NEW.cleaner_id IS DISTINCT FROM OLD.cleaner_id;
BEGIN
  -- Target bumped during active funding (skip the accept-assign UPDATE —
  -- that case is covered by bid_accepted).
  IF v_new_status = 'funding'
     AND v_new_target > v_old_target
     AND NOT v_cleaner_changed
  THEN
    IF NEW.cleaner_id IS NOT NULL THEN
      PERFORM public.create_notification(
        NEW.cleaner_id,
        'funding_bumped',
        NEW.id,
        NEW.creator_id,
        'Funding target updated',
        format(
          'Campaign target is now $%s — $%s still needed to start.',
          v_new_target,
          greatest(0, v_new_target - v_raised)
        )
      );
    END IF;
    IF NEW.creator_id IS NOT NULL THEN
      PERFORM public.create_notification(
        NEW.creator_id,
        'funding_bumped',
        NEW.id,
        NULL,
        'Funding target updated',
        format('Your mission target was updated to $%s.', v_new_target)
      );
    END IF;
  END IF;

  -- Crowdfunding finished: funding → available | in_progress
  IF v_old_status = 'funding' AND v_new_status IN ('available', 'in_progress') THEN
    IF NEW.creator_id IS NOT NULL THEN
      PERFORM public.create_notification(
        NEW.creator_id,
        'funding_complete',
        NEW.id,
        NULL,
        'Campaign funded',
        CASE
          WHEN v_new_status = 'in_progress' THEN
            'Crowdfunding complete — work can begin!'
          ELSE
            'Crowdfunding complete — your mission is open for bidding.'
        END
      );
    END IF;
    IF NEW.cleaner_id IS NOT NULL THEN
      PERFORM public.create_notification(
        NEW.cleaner_id,
        'funding_complete',
        NEW.id,
        NEW.creator_id,
        'Campaign funded',
        'Crowdfunding complete — you can start the job!'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_mission_funding_events ON public.missions;
CREATE TRIGGER trg_notify_mission_funding_events
  AFTER UPDATE OF status, expected_price, current_funding, cleaner_id ON public.missions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_mission_funding_events();

-- ---------------------------------------------------------------------------
-- Realtime on notifications (bell unread count)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'notifications already in supabase_realtime publication';
  WHEN undefined_object THEN
    RAISE NOTICE 'supabase_realtime publication missing — enable Realtime in Dashboard';
END $$;

ALTER TABLE public.notifications REPLICA IDENTITY FULL;
