-- ============================================================================
-- Closed-loop economy: expired crowdfund keeps USD, issues a Gov Notice,
-- and pays donors in non-withdrawable tokens.
-- ----------------------------------------------------------------------------
-- Apply after 20260927150000 (do NOT db push, do NOT edit earlier vortex
-- or token-donation files):
--   supabase db query --linked -f supabase/migrations/20260927150000_token_donations.sql
--   supabase db query --linked -f supabase/migrations/20260927160000_closed_economy.sql
-- Idempotent. Re-runs do not reset closed_economy_config.
--
-- Stripe USD on an unfinished pin stays with the platform. That is the
-- existing rule in process_expired_crowdfunding_missions: current_funding
-- is not refunded to cards. This file does not add a cash-out of
-- token_balance. Tokens are in-app credit only.
--
-- Formulas (integer division, same as src/lib/closedEconomy.ts):
--   tokens_per_usd = floor(anchor_tokens * (100 + stripe_bonus_percent)
--                          / (anchor_usd * 100))
--   stripe credit  = amount_usd * tokens_per_usd
--   Defaults: floor(5000 * 120 / 9900) = 60, so a $100 donation → 6000.
--   A $99 donation → 5940. Buying the $99 pack in the shop is still 5000;
--   the +20% applies only when a cleanup expires unfinished.
--
--   token refund credit = floor(tokens * (100 + token_refund_bonus_percent) / 100)
--   Defaults: 100 held tokens → 120. Under 5 tokens the floor keeps the gift.
--
-- Completion is unchanged: payout_held_token_donations pays the cleaner the
-- held tokens with no bonus, and Stripe funds follow the existing mission
-- payout path. Cancel, archive, and admin delete stay a 1:1 token refund.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.closed_economy_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  anchor_usd integer NOT NULL DEFAULT 99 CHECK (anchor_usd > 0),
  anchor_tokens integer NOT NULL DEFAULT 5000 CHECK (anchor_tokens > 0),
  stripe_bonus_percent integer NOT NULL DEFAULT 20
    CHECK (stripe_bonus_percent >= 0 AND stripe_bonus_percent <= 200),
  token_refund_bonus_percent integer NOT NULL DEFAULT 20
    CHECK (token_refund_bonus_percent >= 0 AND token_refund_bonus_percent <= 200),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.closed_economy_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.closed_economy_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.closed_economy_config FROM PUBLIC;
REVOKE ALL ON TABLE public.closed_economy_config FROM anon;
REVOKE ALL ON TABLE public.closed_economy_config FROM authenticated;

CREATE TABLE IF NOT EXISTS public.closed_economy_token_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('stripe_expiry', 'token_donation_expiry')),
  source_id uuid NOT NULL,
  amount_usd integer,
  tokens_in integer,
  tokens_credited integer NOT NULL CHECK (tokens_credited >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_closed_economy_credits_profile
  ON public.closed_economy_token_credits (profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_closed_economy_credits_mission
  ON public.closed_economy_token_credits (mission_id);

ALTER TABLE public.closed_economy_token_credits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.closed_economy_token_credits FROM PUBLIC;
REVOKE ALL ON TABLE public.closed_economy_token_credits FROM anon;
REVOKE ALL ON TABLE public.closed_economy_token_credits FROM authenticated;

DROP POLICY IF EXISTS closed_economy_credits_select_own ON public.closed_economy_token_credits;
CREATE POLICY closed_economy_credits_select_own
  ON public.closed_economy_token_credits
  FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid() OR public.is_platform_admin(auth.uid()));

GRANT SELECT ON TABLE public.closed_economy_token_credits TO authenticated;

CREATE TABLE IF NOT EXISTS public.closed_economy_expiries (
  mission_id uuid PRIMARY KEY,
  raised_usd integer NOT NULL DEFAULT 0,
  report_count integer NOT NULL DEFAULT 1,
  notice_event_id uuid,
  notice_pdf_url text,
  stripe_tokens_credited integer NOT NULL DEFAULT 0,
  token_refund_credited integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.closed_economy_expiries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.closed_economy_expiries FROM PUBLIC;
REVOKE ALL ON TABLE public.closed_economy_expiries FROM anon;
REVOKE ALL ON TABLE public.closed_economy_expiries FROM authenticated;

DROP POLICY IF EXISTS closed_economy_expiries_select_admin ON public.closed_economy_expiries;
CREATE POLICY closed_economy_expiries_select_admin
  ON public.closed_economy_expiries
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin(auth.uid()));

GRANT SELECT ON TABLE public.closed_economy_expiries TO authenticated;

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS authority_notice_pdf_url text;

COMMENT ON COLUMN public.missions.authority_notice_pdf_url IS
  'Public URL of the municipal Gov Notice PDF after an unfinished crowdfund expires. Copied from city_notification_events.pdf_url.';

REVOKE UPDATE (authority_notice_pdf_url) ON TABLE public.missions FROM PUBLIC;
REVOKE UPDATE (authority_notice_pdf_url) ON TABLE public.missions FROM anon;
REVOKE UPDATE (authority_notice_pdf_url) ON TABLE public.missions FROM authenticated;

-- ---------------------------------------------------------------------------
-- Rate helpers. Owner-only. Match src/lib/closedEconomy.ts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.closed_economy_tokens_per_usd()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_usd integer := 99;
  v_tokens integer := 5000;
  v_bonus integer := 20;
BEGIN
  SELECT anchor_usd, anchor_tokens, stripe_bonus_percent
    INTO v_usd, v_tokens, v_bonus
  FROM public.closed_economy_config
  WHERE id = 1;

  IF v_usd IS NULL OR v_usd <= 0 OR v_tokens IS NULL OR v_tokens <= 0 OR v_bonus IS NULL OR v_bonus < 0 THEN
    RETURN 0;
  END IF;

  RETURN ((v_tokens::bigint * (100 + v_bonus)) / (v_usd::bigint * 100))::integer;
END;
$$;

CREATE OR REPLACE FUNCTION public.closed_economy_stripe_bonus_tokens(p_amount_usd integer)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
BEGIN
  IF coalesce(p_amount_usd, 0) <= 0 THEN
    RETURN 0;
  END IF;
  RETURN p_amount_usd * public.closed_economy_tokens_per_usd();
END;
$$;

CREATE OR REPLACE FUNCTION public.closed_economy_token_refund_tokens(p_tokens integer)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_bonus integer := 20;
BEGIN
  IF coalesce(p_tokens, 0) <= 0 THEN
    RETURN 0;
  END IF;

  SELECT token_refund_bonus_percent
    INTO v_bonus
  FROM public.closed_economy_config
  WHERE id = 1;

  IF v_bonus IS NULL OR v_bonus < 0 THEN
    v_bonus := 20;
  END IF;

  RETURN ((p_tokens::bigint * (100 + v_bonus)) / 100)::integer;
END;
$$;

REVOKE ALL ON FUNCTION public.closed_economy_tokens_per_usd() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.closed_economy_tokens_per_usd() FROM anon;
REVOKE ALL ON FUNCTION public.closed_economy_tokens_per_usd() FROM authenticated;
REVOKE ALL ON FUNCTION public.closed_economy_stripe_bonus_tokens(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.closed_economy_stripe_bonus_tokens(integer) FROM anon;
REVOKE ALL ON FUNCTION public.closed_economy_stripe_bonus_tokens(integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.closed_economy_token_refund_tokens(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.closed_economy_token_refund_tokens(integer) FROM anon;
REVOKE ALL ON FUNCTION public.closed_economy_token_refund_tokens(integer) FROM authenticated;

CREATE OR REPLACE FUNCTION public.closed_economy_notice_photos(p_mission_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_photos text[] := ARRAY[]::text[];
  v_extra text[] := ARRAY[]::text[];
BEGIN
  SELECT coalesce(m.photo_urls, ARRAY[]::text[])
    INTO v_photos
  FROM public.missions m
  WHERE m.id = p_mission_id;

  IF to_regclass('public.garba_vortex_contributions') IS NOT NULL THEN
    SELECT coalesce(array_agg(u), ARRAY[]::text[])
      INTO v_extra
    FROM (
      SELECT DISTINCT unnest(c.photo_urls) AS u
      FROM public.garba_vortex_contributions c
      WHERE c.mission_id = p_mission_id
    ) s
    WHERE u IS NOT NULL AND btrim(u) <> '';
  END IF;

  RETURN (coalesce(v_photos, ARRAY[]::text[]) || coalesce(v_extra, ARRAY[]::text[]))[1:9];
END;
$$;

CREATE OR REPLACE FUNCTION public.closed_economy_report_count(p_mission_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_score integer := 1;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'missions'
      AND column_name = 'severity_score'
  ) THEN
    EXECUTE
      'SELECT greatest(coalesce(severity_score, 1), 1) FROM public.missions WHERE id = $1'
      INTO v_score
      USING p_mission_id;
    RETURN coalesce(v_score, 1);
  END IF;
  RETURN 1;
END;
$$;

REVOKE ALL ON FUNCTION public.closed_economy_notice_photos(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.closed_economy_notice_photos(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.closed_economy_notice_photos(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.closed_economy_report_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.closed_economy_report_count(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.closed_economy_report_count(uuid) FROM authenticated;

-- ---------------------------------------------------------------------------
-- Idempotent credits. Mission row is locked by the caller when possible.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_stripe_expiry_tokens(p_mission_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_row record;
  v_credit integer;
  v_inserted uuid;
  v_sum integer := 0;
BEGIN
  IF p_mission_id IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM 1
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  FOR v_row IN
    SELECT c.id, c.contributor_id, c.amount_usd
    FROM public.contributions c
    WHERE c.mission_id = p_mission_id
      AND coalesce(c.amount_usd, 0) > 0
    ORDER BY c.contributor_id, c.id
    FOR UPDATE
  LOOP
    PERFORM 1
    FROM public.profiles
    WHERE id = v_row.contributor_id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_credit := public.closed_economy_stripe_bonus_tokens(v_row.amount_usd);
    IF v_credit <= 0 THEN
      CONTINUE;
    END IF;

    v_inserted := NULL;
    INSERT INTO public.closed_economy_token_credits (
      mission_id, profile_id, source, source_id, amount_usd, tokens_in, tokens_credited
    )
    VALUES (
      p_mission_id, v_row.contributor_id, 'stripe_expiry', v_row.id,
      v_row.amount_usd, NULL, v_credit
    )
    ON CONFLICT (source, source_id) DO NOTHING
    RETURNING id INTO v_inserted;

    IF v_inserted IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE public.profiles
       SET token_balance = coalesce(token_balance, 0) + v_credit
     WHERE id = v_row.contributor_id;

    v_sum := v_sum + v_credit;
  END LOOP;

  RETURN v_sum;
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_held_token_donations_with_bonus(p_mission_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_row record;
  v_credit integer;
  v_inserted uuid;
  v_sum integer := 0;
BEGIN
  IF p_mission_id IS NULL OR to_regclass('public.token_donations') IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM 1
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  FOR v_row IN
    SELECT d.id, d.donor_id, d.tokens
    FROM public.token_donations d
    WHERE d.mission_id = p_mission_id
      AND d.status = 'held'
    ORDER BY d.donor_id, d.created_at
    FOR UPDATE
  LOOP
    PERFORM 1
    FROM public.profiles
    WHERE id = v_row.donor_id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_credit := public.closed_economy_token_refund_tokens(v_row.tokens);
    IF v_credit <= 0 THEN
      v_credit := v_row.tokens;
    END IF;

    v_inserted := NULL;
    INSERT INTO public.closed_economy_token_credits (
      mission_id, profile_id, source, source_id, amount_usd, tokens_in, tokens_credited
    )
    VALUES (
      p_mission_id, v_row.donor_id, 'token_donation_expiry', v_row.id,
      NULL, v_row.tokens, v_credit
    )
    ON CONFLICT (source, source_id) DO NOTHING
    RETURNING id INTO v_inserted;

    IF v_inserted IS NULL THEN
      UPDATE public.token_donations
         SET status = 'refunded',
             settled_at = coalesce(settled_at, now())
       WHERE id = v_row.id
         AND status = 'held';
      CONTINUE;
    END IF;

    UPDATE public.profiles
       SET token_balance = coalesce(token_balance, 0) + v_credit
     WHERE id = v_row.donor_id;

    UPDATE public.token_donations
       SET status = 'refunded',
           settled_at = now()
     WHERE id = v_row.id;

    v_sum := v_sum + v_credit;
  END LOOP;

  UPDATE public.missions
     SET token_donation_pool = 0
   WHERE id = p_mission_id
     AND coalesce(token_donation_pool, 0) <> 0;

  RETURN v_sum;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_stripe_expiry_tokens(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.credit_stripe_expiry_tokens(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.credit_stripe_expiry_tokens(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.refund_held_token_donations_with_bonus(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_held_token_donations_with_bonus(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.refund_held_token_donations_with_bonus(uuid) FROM authenticated;

-- Expired status uses the +20% refund. Hide / archive / cancel stay 1:1.
-- Completion still pays the cleaner the held amount with no bonus.
CREATE OR REPLACE FUNCTION public.trg_settle_token_donations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_new text := lower(coalesce(NEW.status::text, ''));
  v_old text := lower(coalesce(OLD.status::text, ''));
BEGIN
  IF v_new IS NOT DISTINCT FROM v_old THEN
    RETURN NEW;
  END IF;

  IF v_new = 'completed' THEN
    PERFORM public.payout_held_token_donations(NEW.id);
  ELSIF v_new = 'expired'
        AND v_old NOT IN ('hidden', 'expired', 'archived', 'cancelled', 'completed') THEN
    PERFORM public.refund_held_token_donations_with_bonus(NEW.id);
  ELSIF v_new IN ('hidden', 'archived', 'cancelled')
        AND v_old NOT IN ('hidden', 'expired', 'archived', 'cancelled', 'completed') THEN
    PERFORM public.refund_held_token_donations(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_settle_token_donations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_settle_token_donations() FROM anon;
REVOKE ALL ON FUNCTION public.trg_settle_token_donations() FROM authenticated;

-- $0 free-pin sweep: bonus-refund held tokens, then hide.
-- The status trigger's plain refund then finds no held rows.
CREATE OR REPLACE FUNCTION public.expire_stale_free_garbage_pins()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
  v_updated integer;
  v_token_credit integer;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT coalesce(public.is_platform_admin(auth.uid()), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  FOR v_row IN
    SELECT m.id
    FROM public.missions m
    WHERE m.hidden_at IS NULL
      AND lower(coalesce(m.status::text, '')) = 'reported'
      AND coalesce(m.current_funding, 0) <= 0
      AND (
        coalesce(m.is_report, false)
        OR lower(coalesce(m.status::text, '')) = 'reported'
      )
      AND coalesce(m.crowdfunding_expires_at, m.created_at + interval '7 days') <= now()
    FOR UPDATE OF m SKIP LOCKED
  LOOP
    v_token_credit := public.refund_held_token_donations_with_bonus(v_row.id);

    UPDATE public.missions
       SET status = 'hidden',
           crowdfunding_expires_at = COALESCE(
             crowdfunding_expires_at,
             created_at + interval '7 days'
           )
     WHERE id = v_row.id
       AND lower(coalesce(status::text, '')) = 'reported'
       AND coalesce(current_funding, 0) <= 0;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated > 0 THEN
      v_count := v_count + 1;
      IF v_token_credit > 0 THEN
        INSERT INTO public.closed_economy_expiries (
          mission_id, raised_usd, report_count, token_refund_credited
        )
        VALUES (
          v_row.id, 0, public.closed_economy_report_count(v_row.id), v_token_credit
        )
        ON CONFLICT (mission_id) DO NOTHING;
      END IF;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_free_garbage_pins() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_stale_free_garbage_pins() FROM anon;
GRANT EXECUTE ON FUNCTION public.expire_stale_free_garbage_pins() TO authenticated, service_role;

COMMENT ON FUNCTION public.expire_stale_free_garbage_pins() IS
  'Hide $0 free reports past the clock. Held token donations are refunded with the closed-economy bonus. No Gov Notice and no card movement.';

-- Underfunded Stripe campaigns: keep the USD, queue the existing Gov Notice
-- PDF (city_notification_events → city-notification-pipeline), credit donors.
CREATE OR REPLACE FUNCTION public.process_expired_crowdfunding_missions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
  v_expires timestamptz;
  v_updated integer;
  v_raised integer;
  v_target integer;
  v_stripe_credit integer := 0;
  v_token_credit integer := 0;
  v_event_id uuid;
  v_reports integer;
  v_photos text[];
BEGIN
  FOR v_row IN
    SELECT m.*
    FROM public.missions m
    WHERE COALESCE(
            m.crowdfunding_expires_at,
            m.created_at + interval '7 days',
            now() - interval '1 second'
          ) < now()
      AND (
        (
          lower(coalesce(m.status::text, '')) = 'reported'
          AND coalesce(m.current_funding, 0) = 0
        )
        OR
        (
          coalesce(m.crowdfunding_mode, false) = true
          AND lower(coalesce(m.status::text, '')) = 'funding'
          AND (
            coalesce(m.expected_price, 0) < 1
            OR coalesce(m.current_funding, 0) < coalesce(m.expected_price, 0)
          )
        )
      )
    FOR UPDATE OF m SKIP LOCKED
  LOOP
    v_expires := COALESCE(
      v_row.crowdfunding_expires_at,
      v_row.created_at + interval '7 days',
      now()
    );
    v_raised := coalesce(v_row.current_funding, 0);
    v_target := coalesce(v_row.expected_price, 0);
    v_stripe_credit := 0;
    v_token_credit := 0;
    v_event_id := NULL;

    IF v_raised <= 0 THEN
      -- Bonus-refund first. If the status update loses the race, roll it back
      -- so a still-live pin does not pay the expiry bonus.
      SAVEPOINT closed_economy_pin;
      v_token_credit := public.refund_held_token_donations_with_bonus(v_row.id);

      UPDATE public.missions
      SET
        status = 'hidden',
        cleaner_id = NULL,
        crowdfunding_expires_at = COALESCE(crowdfunding_expires_at, v_expires),
        history_public_until = NULL
      WHERE id = v_row.id
        AND lower(coalesce(status::text, '')) IN ('reported', 'funding')
        AND coalesce(current_funding, 0) <= 0;

      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated = 0 THEN
        ROLLBACK TO SAVEPOINT closed_economy_pin;
        RELEASE SAVEPOINT closed_economy_pin;
        CONTINUE;
      END IF;

      UPDATE public.mission_bids
      SET status = 'rejected'
      WHERE mission_id = v_row.id
        AND lower(coalesce(status::text, '')) IN ('pending', 'accepted');

      IF v_token_credit > 0 THEN
        INSERT INTO public.closed_economy_expiries (
          mission_id, raised_usd, report_count, token_refund_credited
        )
        VALUES (
          v_row.id, 0, public.closed_economy_report_count(v_row.id), v_token_credit
        )
        ON CONFLICT (mission_id) DO NOTHING;
      END IF;

      RELEASE SAVEPOINT closed_economy_pin;
      v_count := v_count + 1;
      CONTINUE;
    END IF;

    IF v_target >= 1 AND v_raised >= v_target THEN
      CONTINUE;
    END IF;

    SAVEPOINT closed_economy_pin;
    v_token_credit := public.refund_held_token_donations_with_bonus(v_row.id);
    v_stripe_credit := public.credit_stripe_expiry_tokens(v_row.id);
    v_reports := public.closed_economy_report_count(v_row.id);
    v_photos := public.closed_economy_notice_photos(v_row.id);

    UPDATE public.missions
    SET
      status = 'expired',
      cleaner_id = NULL,
      crowdfunding_expires_at = COALESCE(crowdfunding_expires_at, v_expires),
      history_public_until = COALESCE(history_public_until, now() + interval '7 days')
    WHERE id = v_row.id
      AND lower(coalesce(status::text, '')) = 'funding'
      AND coalesce(current_funding, 0) > 0
      AND (
        coalesce(expected_price, 0) < 1
        OR coalesce(current_funding, 0) < coalesce(expected_price, 0)
      );

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      ROLLBACK TO SAVEPOINT closed_economy_pin;
      RELEASE SAVEPOINT closed_economy_pin;
      CONTINUE;
    END IF;

    UPDATE public.mission_bids
    SET status = 'rejected'
    WHERE mission_id = v_row.id
      AND lower(coalesce(status::text, '')) IN ('pending', 'accepted');

    INSERT INTO public.city_notification_events (mission_id, event_type, payload, pdf_status)
    VALUES (
      v_row.id,
      'crowdfunding_expired',
      jsonb_build_object(
        'service_type', v_row.service_type,
        'location_lat', v_row.location_lat,
        'location_lng', v_row.location_lng,
        'city', v_row.city,
        'country', v_row.country,
        'target_budget', v_row.expected_price,
        'raised', v_raised,
        'description', v_row.description,
        'created_at', v_row.created_at,
        'funding_expires_at', v_expires,
        'expired_at', now(),
        'history_public_until', now() + interval '7 days',
        'report_count', v_reports,
        'photo_urls', to_jsonb(coalesce(v_photos, ARRAY[]::text[]))
      ),
      'pending'
    )
    RETURNING id INTO v_event_id;

    INSERT INTO public.closed_economy_expiries (
      mission_id,
      raised_usd,
      report_count,
      notice_event_id,
      stripe_tokens_credited,
      token_refund_credited
    )
    VALUES (
      v_row.id,
      v_raised,
      v_reports,
      v_event_id,
      v_stripe_credit,
      v_token_credit
    )
    ON CONFLICT (mission_id) DO NOTHING;

    RELEASE SAVEPOINT closed_economy_pin;

    BEGIN
      PERFORM private.write_admin_audit(
        'closed_economy_expiry',
        'mission',
        v_row.id::text,
        jsonb_build_object('status', 'funding', 'raised_usd', v_raised),
        jsonb_build_object(
          'status', 'expired',
          'raised_usd', v_raised,
          'report_count', v_reports,
          'notice_event_id', v_event_id,
          'stripe_tokens_credited', v_stripe_credit,
          'token_refund_credited', v_token_credit,
          'usd_retained', true
        )
      );
    EXCEPTION
      WHEN undefined_function OR invalid_schema_name THEN
        NULL;
    END;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.process_expired_crowdfunding_missions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_expired_crowdfunding_missions() FROM anon;
REVOKE ALL ON FUNCTION public.process_expired_crowdfunding_missions() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_expired_crowdfunding_missions() TO service_role;

COMMENT ON FUNCTION public.process_expired_crowdfunding_missions() IS
  'Service-role / pg_cron. $0 past the clock → hidden, token donations refunded with bonus, no Gov Notice. Underfunded Stripe campaign → USD retained, status=expired, city_notification_events queues the municipal PDF, each donor is credited tokens at the closed-economy rate. Completion payout is untouched.';

-- The pipeline writes city_notification_events.pdf_url. Copy it onto the
-- mission and the expiry ledger. Do not edit the edge function's storage path.
CREATE OR REPLACE FUNCTION public.trg_store_authority_notice_pdf()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net, pg_temp
AS $$
BEGIN
  IF NEW.pdf_url IS NULL OR NEW.pdf_url IS NOT DISTINCT FROM OLD.pdf_url THEN
    RETURN NEW;
  END IF;
  IF lower(coalesce(NEW.event_type, '')) <> 'crowdfunding_expired' THEN
    RETURN NEW;
  END IF;

  UPDATE public.missions
     SET authority_notice_pdf_url = NEW.pdf_url
   WHERE id = NEW.mission_id;

  UPDATE public.closed_economy_expiries
     SET notice_pdf_url = NEW.pdf_url
   WHERE mission_id = NEW.mission_id;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_store_authority_notice_pdf() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_store_authority_notice_pdf() FROM anon;
REVOKE ALL ON FUNCTION public.trg_store_authority_notice_pdf() FROM authenticated;

DROP TRIGGER IF EXISTS trg_store_authority_notice_pdf ON public.city_notification_events;
CREATE TRIGGER trg_store_authority_notice_pdf
  AFTER UPDATE OF pdf_url
  ON public.city_notification_events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_store_authority_notice_pdf();

DO $pf$
BEGIN
  IF has_function_privilege('anon', 'public.credit_stripe_expiry_tokens(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: anon can execute credit_stripe_expiry_tokens';
  END IF;
  IF has_function_privilege('anon', 'public.refund_held_token_donations_with_bonus(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: anon can execute refund_held_token_donations_with_bonus';
  END IF;
  IF has_function_privilege('authenticated', 'public.credit_stripe_expiry_tokens(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: authenticated can execute credit_stripe_expiry_tokens';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.process_expired_crowdfunding_missions()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-flight failed: service_role cannot execute process_expired_crowdfunding_missions';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.closed_economy_config
    WHERE id = 1
      AND anchor_usd = 99
      AND anchor_tokens = 5000
      AND stripe_bonus_percent = 20
      AND token_refund_bonus_percent = 20
  ) THEN
    IF public.closed_economy_stripe_bonus_tokens(100) IS DISTINCT FROM 6000 THEN
      RAISE EXCEPTION 'Post-flight failed: $100 stripe expiry credit is not 6000 tokens';
    END IF;
    IF public.closed_economy_token_refund_tokens(100) IS DISTINCT FROM 120 THEN
      RAISE EXCEPTION 'Post-flight failed: 100 token refund is not 120';
    END IF;
  END IF;
END
$pf$;
