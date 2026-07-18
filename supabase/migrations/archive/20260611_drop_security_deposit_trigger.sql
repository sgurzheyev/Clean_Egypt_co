-- SaaS transition: remove the legacy 50% security-deposit enforcement on mission bids.
-- Workers now access jobs via subscription + tokens only; no escrow/deposit funds required.

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'mission_bids'
  ) THEN
    DROP TRIGGER IF EXISTS trg_mission_bid_security_deposit ON public.mission_bids;
  END IF;
END
$migration$;

DROP FUNCTION IF EXISTS public.enforce_mission_bid_security_deposit();
