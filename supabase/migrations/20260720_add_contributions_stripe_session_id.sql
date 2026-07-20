-- ============================================================================
-- Ensure crowdfunding contributions has Stripe Checkout idempotency column.
-- Live DB may have missed 20260618_stripe_contribution_checkout.sql.
-- apply_stripe_contribution INSERT/SELECT requires stripe_checkout_session_id.
-- ============================================================================

-- USD amount (base crowdfunding column; keep if already present).
ALTER TABLE public.contributions
  ADD COLUMN IF NOT EXISTS amount_usd integer;

UPDATE public.contributions
SET amount_usd = COALESCE(amount_usd, 1)
WHERE amount_usd IS NULL;

DO $$
BEGIN
  -- Only tighten NOT NULL when every row has a value (safe after UPDATE above).
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contributions'
      AND column_name = 'amount_usd'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE public.contributions
      ALTER COLUMN amount_usd SET NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contributions_amount_usd_check'
  ) THEN
    ALTER TABLE public.contributions
      ADD CONSTRAINT contributions_amount_usd_check CHECK (amount_usd > 0);
  END IF;
END $$;

-- Stripe Checkout session id (idempotency / anti-replay).
ALTER TABLE public.contributions
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text NULL;

COMMENT ON COLUMN public.contributions.stripe_checkout_session_id IS
  'Stripe Checkout Session id (cs_…). Unique when set — prevents double-apply of the same payment.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_contributions_stripe_session
  ON public.contributions(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
