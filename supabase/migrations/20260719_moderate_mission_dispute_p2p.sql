-- ============================================================================
-- moderate_mission_dispute — P2P moderation (NO escrow / wallet payout)
-- ----------------------------------------------------------------------------
-- Replaces resolve_mission_dispute wallet transfers. Approve + Reject only touch
-- mission status / retry state. Client↔ Payment remains confirm_mission_* .
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_mission_dispute(
  p_mission_id uuid,
  p_decision text,
  p_supervisor_comment text,
  p_supervisor_verified boolean DEFAULT false,
  p_supervisor_user_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mission record;
  v_retry_count integer;
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Admin (is_platform_admin) or supervisor flag
  SELECT
    public.is_platform_admin(v_uid)
    OR coalesce(
      (SELECT p.is_supervisor FROM public.profiles p WHERE p.id = v_uid),
      false
    )
  INTO v_is_admin;

  IF NOT coalesce(v_is_admin, false) THEN
    RAISE EXCEPTION 'Moderator access required';
  END IF;

  SELECT * INTO v_mission
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  IF lower(coalesce(v_mission.status::text, '')) = 'completed'
     OR lower(coalesce(v_mission.status::text, '')) = 'finished' THEN
    RAISE EXCEPTION 'Mission already closed';
  END IF;

  IF lower(coalesce(p_decision, '')) = 'approve' THEN
    -- P2P: content moderation only — mark completed. No wallet / frozen_balance moves.
    UPDATE public.missions
    SET
      status = 'completed',
      rejection_reason = NULL,
      is_disputed = false
    WHERE id = p_mission_id;

  ELSIF lower(coalesce(p_decision, '')) = 'reject' THEN
    UPDATE public.missions
    SET retry_count = coalesce(retry_count, 0) + 1
    WHERE id = p_mission_id
    RETURNING retry_count INTO v_retry_count;

    IF coalesce(v_retry_count, 0) < 3 THEN
      UPDATE public.missions
      SET
        status = 'in_progress',
        after_photo_urls = NULL,
        proof_video_url = NULL,
        report_submitted_at = NULL,
        rejection_reason = nullif(trim(coalesce(p_supervisor_comment, '')), ''),
        is_disputed = false
      WHERE id = p_mission_id;
    ELSE
      -- Too many retries: reopen for bidding (no refunds — P2P / tokens retained)
      UPDATE public.missions
      SET
        status = 'available',
        cleaner_id = NULL,
        after_photo_urls = NULL,
        proof_video_url = NULL,
        report_submitted_at = NULL,
        rejection_reason = nullif(trim(coalesce(p_supervisor_comment, '')), ''),
        retry_count = 0,
        is_disputed = false,
        started_at = NULL
      WHERE id = p_mission_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid decision: %', p_decision;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.resolve_mission_dispute(uuid, text, text, boolean, uuid) IS
  'Moderator content decision only. No escrow debit/credit. Approve → completed; reject → retry or reopen.';

REVOKE ALL ON FUNCTION public.resolve_mission_dispute(uuid, text, text, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_mission_dispute(uuid, text, text, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_mission_dispute(uuid, text, text, boolean, uuid) TO service_role;

-- Harden: revoke legacy wallet-debit funding RPCs from clients if they still exist
DO $$
BEGIN
  BEGIN
    REVOKE ALL ON FUNCTION public.complete_funding_and_assign(uuid, numeric) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.complete_funding_and_assign(uuid, numeric) FROM authenticated;
    REVOKE ALL ON FUNCTION public.complete_funding_and_assign(uuid, numeric) FROM anon;
  EXCEPTION WHEN undefined_function THEN NULL;
  END;
  BEGIN
    REVOKE ALL ON FUNCTION public.co_fund_and_accept_mission(uuid, integer) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.co_fund_and_accept_mission(uuid, integer) FROM authenticated;
    REVOKE ALL ON FUNCTION public.co_fund_and_accept_mission(uuid, integer) FROM anon;
  EXCEPTION WHEN undefined_function THEN NULL;
  END;
  BEGIN
    REVOKE ALL ON FUNCTION public.donate_to_mission(uuid, integer) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.donate_to_mission(uuid, integer) FROM authenticated;
    REVOKE ALL ON FUNCTION public.donate_to_mission(uuid, integer) FROM anon;
  EXCEPTION WHEN undefined_function THEN NULL;
  END;
END $$;
