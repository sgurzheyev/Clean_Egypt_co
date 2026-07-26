-- =============================================================================
-- Contractor Stores SaaS expansion:
--   • store_supplies (professional inventory showcase)
--   • service_bundles JSONB on contractor_stores
--   • recurrence_type on missions + contractor_stores (+ multi availability)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Recurrence helpers
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'mission_recurrence_type'
  ) THEN
    CREATE TYPE public.mission_recurrence_type AS ENUM (
      'one_time',
      'weekly',
      'bi_weekly',
      'monthly'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- contractor_stores: bundles + recurrence
-- ---------------------------------------------------------------------------
ALTER TABLE public.contractor_stores
  ADD COLUMN IF NOT EXISTS service_bundles jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.contractor_stores
  ADD COLUMN IF NOT EXISTS recurrence_type text NOT NULL DEFAULT 'one_time';

ALTER TABLE public.contractor_stores
  ADD COLUMN IF NOT EXISTS supported_recurrence_types text[] NOT NULL DEFAULT ARRAY['one_time']::text[];

ALTER TABLE public.contractor_stores
  DROP CONSTRAINT IF EXISTS contractor_stores_recurrence_type_check;

ALTER TABLE public.contractor_stores
  ADD CONSTRAINT contractor_stores_recurrence_type_check
  CHECK (recurrence_type IN ('one_time', 'weekly', 'bi_weekly', 'monthly'));

COMMENT ON COLUMN public.contractor_stores.service_bundles IS
  'Packaged service deals: [{id,title,description,service_ids,starting_price}]';
COMMENT ON COLUMN public.contractor_stores.recurrence_type IS
  'Primary Subscribe & Save cadence advertised on the storefront.';
COMMENT ON COLUMN public.contractor_stores.supported_recurrence_types IS
  'Cadences this contractor accepts (one_time / weekly / bi_weekly / monthly).';

-- ---------------------------------------------------------------------------
-- missions: customer recurring request flag
-- ---------------------------------------------------------------------------
ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS recurrence_type text NOT NULL DEFAULT 'one_time';

ALTER TABLE public.missions
  DROP CONSTRAINT IF EXISTS missions_recurrence_type_check;

ALTER TABLE public.missions
  ADD CONSTRAINT missions_recurrence_type_check
  CHECK (recurrence_type IN ('one_time', 'weekly', 'bi_weekly', 'monthly'));

COMMENT ON COLUMN public.missions.recurrence_type IS
  'Customer request cadence: one_time | weekly | bi_weekly | monthly.';

CREATE INDEX IF NOT EXISTS missions_recurrence_type_idx
  ON public.missions (recurrence_type)
  WHERE recurrence_type IS DISTINCT FROM 'one_time';

-- ---------------------------------------------------------------------------
-- store_supplies — detailed professional inventory
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.store_supplies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.contractor_stores(id) ON DELETE CASCADE,
  name text NOT NULL,
  brand text,
  category text NOT NULL DEFAULT 'Hygiene Supply'
    CHECK (category IN ('Eco-Chemical', 'Heavy Equipment', 'Hygiene Supply')),
  image_url text,
  is_included_in_service boolean NOT NULL DEFAULT true,
  extra_price numeric(12, 2),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_supplies_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT store_supplies_extra_price_nonneg CHECK (
    extra_price IS NULL OR extra_price >= 0
  )
);

CREATE INDEX IF NOT EXISTS store_supplies_store_id_idx
  ON public.store_supplies (store_id, sort_order, created_at);

ALTER TABLE public.store_supplies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_supplies_select_published_or_owner" ON public.store_supplies;
CREATE POLICY "store_supplies_select_published_or_owner"
  ON public.store_supplies
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.contractor_stores s
      WHERE s.id = store_supplies.store_id
        AND (s.is_published = true OR s.owner_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "store_supplies_insert_owner" ON public.store_supplies;
CREATE POLICY "store_supplies_insert_owner"
  ON public.store_supplies
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.contractor_stores s
      WHERE s.id = store_supplies.store_id
        AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_supplies_update_owner" ON public.store_supplies;
CREATE POLICY "store_supplies_update_owner"
  ON public.store_supplies
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.contractor_stores s
      WHERE s.id = store_supplies.store_id
        AND s.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.contractor_stores s
      WHERE s.id = store_supplies.store_id
        AND s.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_supplies_delete_owner" ON public.store_supplies;
CREATE POLICY "store_supplies_delete_owner"
  ON public.store_supplies
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.contractor_stores s
      WHERE s.id = store_supplies.store_id
        AND s.owner_id = auth.uid()
    )
  );

GRANT SELECT ON public.store_supplies TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.store_supplies TO authenticated;

CREATE OR REPLACE FUNCTION public.touch_store_supplies_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS store_supplies_touch_updated_at ON public.store_supplies;
CREATE TRIGGER store_supplies_touch_updated_at
  BEFORE UPDATE ON public.store_supplies
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_store_supplies_updated_at();

-- ---------------------------------------------------------------------------
-- get_contractor_store — include bundles + recurrence
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_contractor_store(uuid);

CREATE OR REPLACE FUNCTION public.get_contractor_store(p_owner_id uuid)
RETURNS TABLE (
  id uuid,
  owner_id uuid,
  office_lat double precision,
  office_lng double precision,
  office_address text,
  service_radius_polygon jsonb,
  offered_services text[],
  materials_and_chemicals text[],
  store_photos text[],
  store_name text,
  store_bio text,
  is_published boolean,
  service_bundles jsonb,
  recurrence_type text,
  supported_recurrence_types text[],
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.owner_id,
    s.office_lat,
    s.office_lng,
    s.office_address,
    s.service_radius_polygon,
    s.offered_services,
    s.materials_and_chemicals,
    s.store_photos,
    s.store_name,
    s.store_bio,
    s.is_published,
    s.service_bundles,
    s.recurrence_type,
    s.supported_recurrence_types,
    s.updated_at
  FROM public.contractor_stores s
  WHERE s.owner_id = p_owner_id
    AND (s.is_published = true OR s.owner_id = auth.uid())
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_contractor_store(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_contractor_store(uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_lead_mission_with_token — optional recurrence_type
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision, integer, integer, boolean, text, text
);

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
  p_crowdfunding_mode boolean DEFAULT false,
  p_country text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_recurrence_type text DEFAULT 'one_time'
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
  v_country text := nullif(btrim(coalesce(p_country, '')), '');
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_recurrence text := lower(nullif(btrim(coalesce(p_recurrence_type, 'one_time')), ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_service_type IS NULL OR length(trim(p_service_type)) = 0 THEN
    RAISE EXCEPTION 'Missing service_type';
  END IF;

  IF p_location_lat IS NULL OR p_location_lng IS NULL THEN
    RAISE EXCEPTION 'Location required';
  END IF;

  IF v_crowdfund AND NOT public.is_garbage_removal_service(p_service_type) THEN
    RAISE EXCEPTION 'Crowdfunding is only allowed for Garbage Removal services';
  END IF;

  IF v_recurrence IS NULL OR v_recurrence NOT IN ('one_time', 'weekly', 'bi_weekly', 'monthly') THEN
    v_recurrence := 'one_time';
  END IF;

  v_bid := greatest(1, floor(coalesce(p_token_bid, 1)));
  v_budget := floor(coalesce(p_expected_price, 0));

  IF v_budget < 5 THEN
    RAISE EXCEPTION 'Work budget must be at least 5 USD';
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
    v_expires := now() + interval '7 days';
  END IF;

  IF v_country IS NOT NULL AND char_length(v_country) > 120 THEN
    v_country := left(v_country, 120);
  END IF;
  IF v_city IS NOT NULL AND char_length(v_city) > 120 THEN
    v_city := left(v_city, 120);
  END IF;

  INSERT INTO public.missions (
    creator_id,
    status,
    category,
    amount_target,
    expected_price,
    current_funding,
    service_type,
    location_lat,
    location_lng,
    description,
    photo_urls,
    building_id,
    building_height_m,
    crowdfunding_mode,
    crowdfunding_expires_at,
    country,
    city,
    recurrence_type
  )
  VALUES (
    v_uid,
    v_status,
    v_category,
    v_bid,
    v_budget,
    0,
    p_service_type,
    p_location_lat,
    p_location_lng,
    NULLIF(trim(coalesce(p_description, '')), ''),
    coalesce(p_photo_urls, array[]::text[]),
    NULLIF(trim(coalesce(p_building_id, '')), ''),
    p_building_height_m,
    v_crowdfund,
    v_expires,
    v_country,
    v_city,
    v_recurrence
  )
  RETURNING id INTO v_mid;

  RETURN v_mid;
END;
$$;

REVOKE ALL ON FUNCTION public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision, integer, integer, boolean, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision, integer, integer, boolean, text, text, text
) TO authenticated, service_role;

COMMENT ON FUNCTION public.create_lead_mission_with_token(
  text, double precision, double precision, text, text[], text, double precision, integer, integer, boolean, text, text, text
) IS
  'Create lead mission with token debit; optional p_recurrence_type for Subscribe & Save requests.';
