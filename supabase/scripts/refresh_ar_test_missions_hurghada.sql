-- ============================================================================
-- Refresh AR test missions — Hurghada, Egypt
-- ----------------------------------------------------------------------------
-- Run in the Supabase SQL editor (runs as postgres, bypasses RLS).
--
-- LIVE SCHEMA (verified / maintained for AR seed scripts):
--   Financial fields:
--     amount_target      — token bid / listing rank (integer)
--     expected_price     — work budget in USD (integer)
--     current_funding    — crowdfunding raised in USD (integer)
--   Note: apply supabase/migrations/20260619_usd_only_currency.sql so
--   pin_fee_egp is renamed to pin_fee_usd. This seed does not write pin fees.
--   Other columns used below: creator_id, status, category, service_type,
--   location_lat, location_lng, description, photo_urls, crowdfunding_mode,
--   crowdfunding_expires_at
--
-- SAFETY MODEL:
--   * Deletes ONLY missions whose description starts with '[AR-TEST]'.
--     Real user missions are never touched.
--   * Related contributions / city_notification_events rows are removed
--     automatically via ON DELETE CASCADE.
--   * Everything runs in one transaction: if any insert fails, the delete
--     is rolled back too.
--
-- Coordinates are within ~500 m of El Dahar, central Hurghada
-- (27.2579 N, 33.8116 E). Adjust the lat/lng values if you are testing
-- from another part of the city.
-- ============================================================================

BEGIN;

-- 1) Remove previous AR test missions (tagged rows only)
DELETE FROM public.missions
WHERE description LIKE '[AR-TEST]%';

-- 2) Insert 4 fresh test missions owned by an existing profile.
--    By default the first profile in the table is used; to pin ownership to
--    your own account, replace the sub-select with your auth user id, e.g.:
--      SELECT '11111111-2222-3333-4444-555555555555'::uuid
WITH me AS (
  SELECT id FROM public.profiles LIMIT 1
)
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
  crowdfunding_mode,
  crowdfunding_expires_at
)
SELECT
  me.id,
  t.status,
  COALESCE(
    public.mission_category_for_service(t.service_type),
    'public'
  ),
  t.amount_target,
  t.expected_price,
  t.current_funding,
  t.service_type,
  t.lat,
  t.lng,
  t.description,
  ARRAY[]::text[],
  t.crowdfunding_mode,
  CASE WHEN t.crowdfunding_mode THEN now() + interval '14 days' END
FROM me,
(VALUES
  -- status,      tokens, budget USD, funded USD, service_type,           lat,     lng,     crowdfunding, description
  ('available',   1,      35,         0,          'junk_removal',         27.2579, 33.8116, false,
    '[AR-TEST] Standard cyan marker — El Dahar square, junk pile by the kiosk'),
  ('available',   2,      60,         0,          'beach_street_cleanup', 27.2605, 33.8140, false,
    '[AR-TEST] Standard cyan marker — street litter, 350 m NE of the square'),
  ('funding',     2,      120,        45,         'beach_street_cleanup', 27.2551, 33.8090, true,
    '[AR-TEST] Amber crowdfunding marker at 37% — beach cleanup SW of center'),
  ('funding',     3,      200,        190,        'junk_removal',         27.2588, 33.8175, true,
    '[AR-TEST] Amber crowdfunding marker at 95% — nearly funded, east side')
) AS t(
  status,
  amount_target,
  expected_price,
  current_funding,
  service_type,
  lat,
  lng,
  crowdfunding_mode,
  description
);

-- 3) Verify what the AR overlay will fetch
--    (AROverlay queries: status IN ('available','funding') with non-null coords)
SELECT
  id,
  status,
  service_type,
  amount_target,
  expected_price,
  current_funding,
  round((current_funding::numeric / NULLIF(expected_price, 0)) * 100) AS funded_pct,
  location_lat,
  location_lng,
  crowdfunding_mode,
  crowdfunding_expires_at,
  description
FROM public.missions
WHERE description LIKE '[AR-TEST]%'
ORDER BY status, description;

COMMIT;
