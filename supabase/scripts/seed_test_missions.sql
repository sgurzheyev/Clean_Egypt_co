-- ============================================================================
-- seed_test_missions.sql — throwaway test data for the map filter/sort UI.
-- ----------------------------------------------------------------------------
-- WHAT IT DOES
--   1) Safely wipes ALL current missions (and any rows that FK-reference them)
--      so the map starts clean.
--   2) Inserts ~40 random missions: 20 around Hurghada + 20 around Cairo, with
--      varied service types (→ varied #tags), random USD budgets ($5–$150), and
--      random submission dates spread over the last 14 days.
--
-- SAFETY
--   * DESTRUCTIVE. Intended for dev / staging only. Do NOT run in production.
--   * Requires at least one row in public.profiles (used as the mission creator).
--   * Run in the Supabase SQL editor or:  psql "$DATABASE_URL" -f this_file.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Safely clear existing missions + every table that references them.
--    We delete FK children first so we never hit a constraint violation,
--    regardless of whether those FKs cascade.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT conrelid::regclass AS child
    FROM pg_constraint
    WHERE confrelid = 'public.missions'::regclass
      AND contype = 'f'
      AND conrelid <> 'public.missions'::regclass
  LOOP
    EXECUTE format('DELETE FROM %s', r.child);
  END LOOP;

  DELETE FROM public.missions;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Guard: we need a creator (any existing profile).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles) THEN
    RAISE EXCEPTION
      'seed_test_missions: no rows in public.profiles — create at least one user/profile first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Generate 40 missions (20 Hurghada + 20 Cairo).
-- ---------------------------------------------------------------------------
WITH creator AS (
  SELECT id FROM public.profiles ORDER BY random() LIMIT 1
),
svc(idx, service_type, tagline) AS (
  VALUES
    (1,  'home_office',          '#home #office #cleaning'),
    (2,  'ac_cleaning',          '#ac #hvac #cleaning'),
    (3,  'pool_maintenance',     '#pool #cleaning #maintenance'),
    (4,  'pest_control',         '#pest #control #home'),
    (5,  'windows_facades',      '#windows #facade #cleaning'),
    (6,  'terrace_garden',       '#garden #terrace #outdoor'),
    (7,  'car_detailing',        '#car #detailing #shine'),
    (8,  'yacht_boat_cleaning',  '#yacht #boat #marine'),
    (9,  'solar_panels',         '#solar #panels #roof'),
    (10, 'ultrasound_cleaning',  '#ultrasound #deep #cleaning'),
    (11, 'carpets_mattresses',   '#carpets #mattress #deep'),
    (12, 'kitchen_hoods_grease', '#kitchen #grease #hood'),
    (13, 'laundry_ironing',      '#laundry #ironing #home'),
    (14, 'water_tank_cleaning',  '#water #tank #cleaning'),
    (15, 'junk_removal',         '#junk #heavy #haul'),
    (16, 'beach_street_cleanup', '#beach #street #cleanup #eco')
),
cities(name, lat, lng) AS (
  VALUES
    ('Hurghada', 27.2579::double precision, 33.8116::double precision),
    ('Cairo',    30.0444::double precision, 31.2357::double precision)
),
gen AS (
  SELECT
    c.name                                        AS city,
    c.lat + (random() - 0.5) * 0.08               AS lat,
    c.lng + (random() - 0.5) * 0.08               AS lng,
    (1 + floor(random() * 16))::int               AS svc_idx,
    (5 + floor(random() * 146))::int              AS budget_usd,
    (1 + floor(random() * 5))::int                AS token_bid,
    (now()
      - (random() * 14) * interval '1 day'
      - (random() * 24) * interval '1 hour')      AS created
  FROM cities c
  CROSS JOIN generate_series(1, 20)
)
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
  crowdfunding_mode,
  created_at
)
SELECT
  (SELECT id FROM creator),
  'available',
  public.mission_category_for_service(s.service_type),
  g.token_bid,
  g.budget_usd,
  0,
  s.service_type,
  NULL,
  g.lat,
  g.lng,
  format(
    E'\U0001F4CD %s\n\nTest mission — %s cleanup near %s. %s',
    g.city,
    replace(s.service_type, '_', ' '),
    g.city,
    s.tagline
  ),
  ARRAY[]::text[],
  false,
  g.created
FROM gen g
JOIN svc s ON s.idx = g.svc_idx;

COMMIT;

-- Quick sanity check (optional):
--   SELECT status, service_type, expected_price, created_at
--   FROM public.missions ORDER BY created_at DESC;
