-- Crowdfunding layer for Garbage Removal only (junk_removal / beach_street_cleanup).
-- Direct-payment missions stay unchanged (crowdfunding_mode defaults to false).

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS crowdfunding_mode boolean NOT NULL DEFAULT false;

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS crowdfunding_expires_at timestamptz NULL;

COMMENT ON COLUMN public.missions.crowdfunding_mode IS
  'When true (Garbage Removal only), mission raises contributions until expected_price is met, then opens for bidding.';

COMMENT ON COLUMN public.missions.crowdfunding_expires_at IS
  'Optional deadline for crowdfunding. On expiry without target, city notification queue is populated.';

CREATE TABLE IF NOT EXISTS public.contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  contributor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount_usd integer NOT NULL CHECK (amount_usd > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contributions_mission_id ON public.contributions(mission_id);
CREATE INDEX IF NOT EXISTS idx_contributions_contributor_id ON public.contributions(contributor_id);

ALTER TABLE public.contributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contributions_select_authenticated ON public.contributions;
CREATE POLICY contributions_select_authenticated
  ON public.contributions FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS contributions_insert_own ON public.contributions;
CREATE POLICY contributions_insert_own
  ON public.contributions FOR INSERT TO authenticated
  WITH CHECK (contributor_id = auth.uid());

-- Queue for municipal PDF / city authority notifications when crowdfunding fails.
CREATE TABLE IF NOT EXISTS public.city_notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  event_type text NOT NULL DEFAULT 'crowdfunding_expired',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_status text NOT NULL DEFAULT 'pending'
    CHECK (pdf_status IN ('pending', 'generated', 'sent', 'skipped')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_city_notification_mission
  ON public.city_notification_events(mission_id);

ALTER TABLE public.city_notification_events ENABLE ROW LEVEL SECURITY;

-- Helpers
CREATE OR REPLACE FUNCTION public.is_garbage_removal_service(p_service_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(coalesce(p_service_type, '')) IN ('junk_removal', 'beach_street_cleanup');
$$;

-- Single signature: crowdfunding flag defaults to false (direct-payment path unchanged).
CREATE OR REPLACE FUNCTION public.create_lead_mission_with_token(
  p_service_type text,
  p_location_lat double precision,
  p_location_lng double precision,
  p_description text,
  p_photo_urls text[],
  p_building_id text DEFAULT NULL,
  p_building_height_m double precision DEFAULT NULL,
  p_token_bid integer DEFAULT 1,
  p_expected_price integer DEFAULT NULL,
  p_crowdfunding_mode boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_balance integer;
  v_bid integer;
  v_budget integer;
  v_mid uuid;
  v_category text;
  v_crowdfund boolean := coalesce(p_crowdfunding_mode, false);
  v_status text := 'available';
  v_expires timestamptz := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_service_type IS NULL OR length(trim(p_service_type)) = 0 THEN
    RAISE EXCEPTION 'Missing service_type';
  END IF;

  IF v_crowdfund AND NOT public.is_garbage_removal_service(p_service_type) THEN
    RAISE EXCEPTION 'Crowdfunding is only allowed for Garbage Removal services';
  END IF;

  v_bid := greatest(1, floor(coalesce(p_token_bid, 1)));
  v_budget := floor(coalesce(p_expected_price, 0));

  IF v_budget < 1 THEN
    RAISE EXCEPTION 'Work budget required';
  END IF;

  SELECT token_balance
  INTO v_balance
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF coalesce(v_balance, 0) < v_bid THEN
    RAISE EXCEPTION 'Insufficient tokens';
  END IF;

  UPDATE public.profiles
  SET token_balance = token_balance - v_bid
  WHERE id = v_uid;

  v_category := public.mission_category_for_service(p_service_type);

  IF v_crowdfund THEN
    v_status := 'funding';
    v_expires := now() + interval '14 days';
  END IF;

  INSERT INTO public.missions (
    creator_id,
    status,
    category,
    amount_target,
    expected_price,
    current_funding,
    service_type,
    pin_fee_usd,
    location_lat,
    location_lng,
    description,
    photo_urls,
    building_id,
    building_height_m,
    crowdfunding_mode,
    crowdfunding_expires_at
  )
  VALUES (
    v_uid,
    v_status,
    v_category,
    v_bid,
    v_budget,
    0,
    p_service_type,
    NULL,
    p_location_lat,
    p_location_lng,
    NULLIF(trim(coalesce(p_description, '')), ''),
    coalesce(p_photo_urls, array[]::text[]),
    NULLIF(trim(coalesce(p_building_id, '')), ''),
    p_building_height_m,
    v_crowdfund,
    v_expires
  )
  RETURNING id INTO v_mid;

  RETURN v_mid;
END;
$$;

-- Drop legacy 9-arg overload if present (avoids ambiguous call resolution).
DROP FUNCTION IF EXISTS public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision, integer, integer
);

REVOKE ALL ON FUNCTION public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision, integer, integer, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision, integer, integer, boolean
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision, integer, integer, boolean
) TO service_role;

-- Contribution vs direct bid: records pledge (USD) and opens bidding when target is met.
CREATE OR REPLACE FUNCTION public.contribute_to_mission(
  p_mission_id uuid,
  p_amount_usd integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mission record;
  v_amount integer;
  v_new_funding integer;
  v_target integer;
  v_opened boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_amount := floor(coalesce(p_amount_usd, 0));
  IF v_amount < 1 THEN
    RAISE EXCEPTION 'Contribution must be at least 1 USD';
  END IF;

  SELECT *
  INTO v_mission
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  IF NOT coalesce(v_mission.crowdfunding_mode, false) THEN
    RAISE EXCEPTION 'This mission is direct-payment only — use bidding instead';
  END IF;

  IF NOT public.is_garbage_removal_service(v_mission.service_type) THEN
    RAISE EXCEPTION 'Crowdfunding contributions are only for Garbage Removal';
  END IF;

  IF lower(coalesce(v_mission.status::text, '')) <> 'funding' THEN
    RAISE EXCEPTION 'Mission is not accepting contributions';
  END IF;

  IF v_mission.crowdfunding_expires_at IS NOT NULL
     AND v_mission.crowdfunding_expires_at < now() THEN
    RAISE EXCEPTION 'Crowdfunding window has expired';
  END IF;

  INSERT INTO public.contributions (mission_id, contributor_id, amount_usd)
  VALUES (p_mission_id, v_uid, v_amount);

  v_new_funding := coalesce(v_mission.current_funding, 0) + v_amount;
  v_target := coalesce(v_mission.expected_price, 0);

  IF v_target > 0 AND v_new_funding >= v_target THEN
    UPDATE public.missions
    SET
      current_funding = v_new_funding,
      status = 'available'
    WHERE id = p_mission_id;
    v_opened := true;
  ELSE
    UPDATE public.missions
    SET current_funding = v_new_funding
    WHERE id = p_mission_id;
  END IF;

  RETURN jsonb_build_object(
    'mission_id', p_mission_id,
    'amount_usd', v_amount,
    'current_funding', v_new_funding,
    'target_budget', v_target,
    'opened_for_bidding', v_opened
  );
END;
$$;

REVOKE ALL ON FUNCTION public.contribute_to_mission(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contribute_to_mission(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contribute_to_mission(uuid, integer) TO service_role;

-- Expire underfunded crowdfunding missions and queue city PDF notifications.
CREATE OR REPLACE FUNCTION public.process_expired_crowdfunding_missions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT m.*
    FROM public.missions m
    WHERE coalesce(m.crowdfunding_mode, false) = true
      AND lower(coalesce(m.status::text, '')) = 'funding'
      AND m.crowdfunding_expires_at IS NOT NULL
      AND m.crowdfunding_expires_at < now()
      AND coalesce(m.current_funding, 0) < coalesce(m.expected_price, 0)
  LOOP
    UPDATE public.missions
    SET status = 'expired'
    WHERE id = v_row.id;

    INSERT INTO public.city_notification_events (mission_id, event_type, payload, pdf_status)
    VALUES (
      v_row.id,
      'crowdfunding_expired',
      jsonb_build_object(
        'service_type', v_row.service_type,
        'location_lat', v_row.location_lat,
        'location_lng', v_row.location_lng,
        'target_budget', v_row.expected_price,
        'raised', coalesce(v_row.current_funding, 0),
        'description', v_row.description,
        'expired_at', now()
      ),
      'pending'
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.process_expired_crowdfunding_missions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_expired_crowdfunding_missions() TO service_role;
