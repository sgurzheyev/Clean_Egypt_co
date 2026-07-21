-- ============================================================================
-- 20260721_cleanup_legacy_finance_rpcs.sql
-- ----------------------------------------------------------------------------
-- Finalize the pivot to the non-refundable contribution / token-boost model by
-- removing legacy manual-payout & withdrawal backend logic.
--
--   1) Drop legacy payout/withdrawal RPCs (dead code — no frontend callers).
--   2) Recreate admin_financial_metrics() WITHOUT pending_payouts /
--      pending_withdrawals; return only contribution-model data
--      (retained contributions, supervisor bounties, active/completed counts).
--
-- Idempotent: DROP ... IF EXISTS + DROP-before-CREATE for the return-type change.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Drop legacy payout & withdrawal functions.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.approve_manual_payout(uuid);
DROP FUNCTION IF EXISTS public.reject_withdrawal_request(uuid);
DROP FUNCTION IF EXISTS public.process_withdrawal_request(numeric, text, text);
DROP FUNCTION IF EXISTS public.is_withdrawal_admin_caller();

-- ---------------------------------------------------------------------------
-- 2) Rebuild the admin financial metrics RPC for the contribution model.
--    (CREATE OR REPLACE can't alter a function's return columns, so drop first.)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_financial_metrics();

CREATE OR REPLACE FUNCTION public.admin_financial_metrics()
RETURNS TABLE (
  total_donated numeric,
  supervisor_bounties_total numeric,
  active_missions bigint,
  completed_missions bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    -- Retained (non-refundable) contribution inflow.
    COALESCE((
      SELECT SUM(t.amount)
      FROM public.transactions t
      WHERE t.type IN ('donation', 'deposit', 'wallet_topup', 'mission_reward')
    ), 0) AS total_donated,
    -- Ahmed-Pro supervisor network rewards.
    COALESCE((
      SELECT SUM(t.amount)
      FROM public.transactions t
      WHERE t.type = 'supervisor_bounty'
    ), 0) AS supervisor_bounties_total,
    -- Live marketplace volume.
    COALESCE((
      SELECT COUNT(*)
      FROM public.missions m
      WHERE m.status IN ('pending', 'available', 'funding', 'in_progress', 'review', 'pending_approval')
    ), 0) AS active_missions,
    COALESCE((
      SELECT COUNT(*)
      FROM public.missions m
      WHERE m.status IN ('completed', 'finished')
    ), 0) AS completed_missions;
$$;

GRANT EXECUTE ON FUNCTION public.admin_financial_metrics() TO authenticated;
