-- ============================================================================
-- seed_smart_cities.sql — multi-city smart seeding for token-boost ranking tests.
-- ----------------------------------------------------------------------------
-- ECONOMIC MODEL: contributions are non-refundable, payouts are gone. Ranking /
-- monetization is driven by TOKEN BOOST ("продвижение за токены"), stored in
-- missions.amount_target (higher = ranks higher).
--
-- WHAT IT DOES
--   1) Safely wipes missions, all FK children (bids, contributions, notifications,
--      reviews, city events), and financial logs (transactions).
--   2) Seeds one representative mission per core marketplace city (mirrors
--      EGYPT_MARKETPLACE_CITIES in src/lib/egyptMarketplace.ts) with realistic
--      lat/lng jitter around each city center.
--   3) Assigns a distinct, staggered token boost (amount_target = 1,2,3,…) and a
--      staggered USD budget (expected_price = $5, $10, … $65) plus staggered
--      created_at, so DESC-by-boost sorting is unambiguous to verify.
--
-- SAFETY: DESTRUCTIVE — dev/staging only. Requires ≥1 row in public.profiles.
--   Run in Supabase SQL editor, or: psql "$DATABASE_URL" -f this_file.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Wipe missions + every FK child, then financial logs.
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

  -- Financial logs / bids / city events that may not cascade from missions.
  IF to_regclass('public.transactions') IS NOT NULL THEN
    DELETE FROM public.transactions;
  END IF;
  IF to_regclass('public.mission_bids') IS NOT NULL THEN
    DELETE FROM public.mission_bids;
  END IF;
  IF to_regclass('public.city_notification_events') IS NOT NULL THEN
    DELETE FROM public.city_notification_events;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Guard: we need a creator (any existing profile).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles) THEN
    RAISE EXCEPTION
      'seed_smart_cities: no rows in public.profiles — create at least one user/profile first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) One staggered mission per core city.
-- ---------------------------------------------------------------------------
WITH creator AS (
  SELECT id FROM public.profiles ORDER BY random() LIMIT 1
),
svc(sidx, service_type, tagline) AS (
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
-- Mirrors EGYPT_MARKETPLACE_CITIES (src/lib/egyptMarketplace.ts). cidx drives the
-- staggered boost/budget/date so every city has a unique, testable rank.
cities(cidx, name, lat, lng) AS (
  VALUES
    (1,  'Cairo',           30.0444::double precision, 31.2357::double precision),
    (2,  'Giza',            30.0131, 31.2089),
    (3,  'Alexandria',      31.2001, 29.9182),
    (4,  'Hurghada',        27.2579, 33.8116),
    (5,  'Sharm El Sheikh', 27.9158, 34.3300),
    (6,  'Luxor',           25.6872, 32.6396),
    (7,  'Aswan',           24.0889, 32.8998),
    (8,  'Ismailia',        30.5965, 32.2715),
    (9,  'Port Said',       31.2653, 32.3019),
    (10, 'Suez',            29.9668, 32.5498),
    (11, 'Mansoura',        31.0409, 31.3785),
    (12, 'Tanta',           30.7865, 31.0004),
    (13, 'Asyut',           27.1783, 31.1859)
),
gen AS (
  SELECT
    c.cidx,
    c.name,
    c.lat + (random() - 0.5) * 0.03            AS lat,
    c.lng + (random() - 0.5) * 0.03            AS lng,
    c.cidx                                       AS boost,        -- token boost: 1,2,3,…
    (5 * c.cidx)                                 AS budget_usd,    -- $5, $10, … $65
    (((c.cidx - 1) % 16) + 1)                    AS svc_idx        -- cycle service types
  FROM cities c
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
  g.boost,                                       -- token promotion / boost (ranking)
  g.budget_usd,
  0,
  s.service_type,
  NULL,
  g.lat,
  g.lng,
  format(
    E'\U0001F4CD %s\n\nBoosted test mission — %s in %s. Token boost +%s · budget $%s. %s',
    g.name,
    replace(s.service_type, '_', ' '),
    g.name,
    g.boost,
    g.budget_usd,
    s.tagline
  ),
  ARRAY[]::text[],
  false,
  now() - (g.cidx * interval '6 hour')           -- staggered submission dates
FROM gen g
JOIN svc s ON s.sidx = g.svc_idx;

COMMIT;

-- Verify staggered ranking (boost DESC = default order):
--   SELECT amount_target AS boost, expected_price AS budget_usd, service_type,
--          created_at, location_lat, location_lng
--   FROM public.missions ORDER BY amount_target DESC, created_at DESC;
