-- ============================================================================
-- Global location catalog — worldwide country / city filter reference data
-- ----------------------------------------------------------------------------
-- WHY
--   Before this migration the country/city filter lists were derived only from
--   the missions currently loaded by the client (LIMIT 200/500) and merged with
--   a hardcoded three-country array in src/lib/globalMarketplace.ts. That caused
--   two classes of "0 results" bugs:
--     1. Legacy missions have country/city = NULL (20260725 added the columns
--        but never backfilled), so they were invisible to every country filter.
--     2. Countries whose missions fell outside the loaded page never appeared,
--        and selecting them returned 0 results even though the region was
--        populated in the database.
--
-- WHAT
--   1. public.haversine_km()                  — great-circle distance helper.
--   2. public.location_catalog                — seeded countries + major cities
--                                               with centroids (read-only ref).
--   3. Backfill of missions.country/city      — nearest catalog city.
--   4. BEFORE INSERT/UPDATE trigger           — keeps country/city populated so
--                                               the NULL bug cannot recur.
--   5. public.list_mission_location_facets()  — DB-wide country/city facets with
--                                               counts + centroids (not page
--                                               limited), used to build the
--                                               filter catalog on the client.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Great-circle distance (km) between two WGS84 points.
--    Mirrors haversineKm() in src/lib/egyptMarketplace.ts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.haversine_km(
  lat1 double precision,
  lng1 double precision,
  lat2 double precision,
  lng2 double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT 2 * 6371 * asin(
    sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) *
      power(sin(radians(lng2 - lng1) / 2), 2)
    )
  );
$$;

COMMENT ON FUNCTION public.haversine_km(
  double precision, double precision, double precision, double precision
) IS 'Great-circle distance in kilometres between two WGS84 coordinates.';

-- ---------------------------------------------------------------------------
-- 2) Reference catalog of countries + major cities.
--    city = '' marks the country-level centroid row (one per country).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.location_catalog (
  id bigserial PRIMARY KEY,
  country text NOT NULL,
  country_code text,
  city text NOT NULL DEFAULT '',
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  -- Surfaced as a one-tap quick filter chip in the UI.
  is_quick_region boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT location_catalog_country_city_key UNIQUE (country, city),
  CONSTRAINT location_catalog_lat_range CHECK (lat >= -90 AND lat <= 90),
  CONSTRAINT location_catalog_lng_range CHECK (lng >= -180 AND lng <= 180)
);

COMMENT ON TABLE public.location_catalog IS
  'Read-only reference data for the global country/city mission filter. Rows with city = '''' are country centroids.';
COMMENT ON COLUMN public.location_catalog.city IS
  'Major city display name. Empty string marks the country centroid row.';
COMMENT ON COLUMN public.location_catalog.is_quick_region IS
  'True for countries shown as one-tap quick filter chips.';

CREATE INDEX IF NOT EXISTS idx_location_catalog_country
  ON public.location_catalog (country);

-- Nearest-city lookups scan city rows only.
CREATE INDEX IF NOT EXISTS idx_location_catalog_cities
  ON public.location_catalog (country, city)
  WHERE city <> '';

ALTER TABLE public.location_catalog ENABLE ROW LEVEL SECURITY;

-- Public reference data: readable by everyone, writable only via service_role
-- (which bypasses RLS). No INSERT/UPDATE/DELETE policies are defined.
DROP POLICY IF EXISTS location_catalog_select_all ON public.location_catalog;
CREATE POLICY location_catalog_select_all
  ON public.location_catalog
  FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON public.location_catalog TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2b) Seed data — major countries and their major cities.
--     Idempotent: re-running refreshes coordinates / quick-region flags.
--     City names match the humanized labels the client produces so that
--     mission-derived values and catalog values de-duplicate cleanly.
-- ---------------------------------------------------------------------------
WITH seed(country, country_code, city, lat, lng, is_quick_region) AS (
  VALUES
    -- ===================== Country centroids (city = '') =====================
    ('United States',        'US', '',  39.8283::double precision,  -98.5795::double precision, true),
    ('Canada',               'CA', '',  56.1304,  -106.3468, true),
    ('United Kingdom',       'GB', '',  55.3781,    -3.4360, true),
    ('Germany',              'DE', '',  51.1657,    10.4515, true),
    ('France',               'FR', '',  46.2276,     2.2137, true),
    ('Poland',               'PL', '',  52.0693,    19.4803, true),
    ('Egypt',                'EG', '',  26.8206,    30.8025, true),
    ('United Arab Emirates', 'AE', '',  23.4241,    53.8478, true),
    ('Saudi Arabia',         'SA', '',  23.8859,    45.0792, true),
    ('Australia',            'AU', '', -25.2744,   133.7751, true),
    ('Spain',                'ES', '',  40.4637,    -3.7492, false),
    ('Italy',                'IT', '',  41.8719,    12.5674, false),
    ('Netherlands',          'NL', '',  52.1326,     5.2913, false),
    ('Switzerland',          'CH', '',  46.8182,     8.2275, false),
    ('Austria',              'AT', '',  47.5162,    14.5501, false),
    ('Belgium',              'BE', '',  50.5039,     4.4699, false),
    ('Sweden',               'SE', '',  60.1282,    18.6435, false),
    ('Norway',               'NO', '',  60.4720,     8.4689, false),
    ('Denmark',              'DK', '',  56.2639,     9.5018, false),
    ('Ireland',              'IE', '',  53.4129,    -8.2439, false),
    ('Portugal',             'PT', '',  39.3999,    -8.2245, false),
    ('Czechia',              'CZ', '',  49.8175,    15.4730, false),
    ('Ukraine',              'UA', '',  48.3794,    31.1656, false),
    ('Turkey',               'TR', '',  38.9637,    35.2433, false),
    ('Greece',               'GR', '',  39.0742,    21.8243, false),
    ('Romania',              'RO', '',  45.9432,    24.9668, false),
    ('Qatar',                'QA', '',  25.3548,    51.1839, false),
    ('Kuwait',               'KW', '',  29.3117,    47.4818, false),
    ('Bahrain',              'BH', '',  26.0667,    50.5577, false),
    ('Oman',                 'OM', '',  21.4735,    55.9754, false),
    ('Jordan',               'JO', '',  30.5852,    36.2384, false),
    ('Israel',               'IL', '',  31.0461,    34.8516, false),
    ('Morocco',              'MA', '',  31.7917,    -7.0926, false),
    ('Tunisia',              'TN', '',  33.8869,     9.5375, false),
    ('Nigeria',              'NG', '',   9.0820,     8.6753, false),
    ('Kenya',                'KE', '',  -0.0236,    37.9062, false),
    ('South Africa',         'ZA', '', -30.5595,    22.9375, false),
    ('India',                'IN', '',  20.5937,    78.9629, false),
    ('Pakistan',             'PK', '',  30.3753,    69.3451, false),
    ('Singapore',            'SG', '',   1.3521,   103.8198, false),
    ('Malaysia',             'MY', '',   4.2105,   101.9758, false),
    ('Indonesia',            'ID', '',  -0.7893,   113.9213, false),
    ('Thailand',             'TH', '',  15.8700,   100.9925, false),
    ('Vietnam',              'VN', '',  14.0583,   108.2772, false),
    ('Philippines',          'PH', '',  12.8797,   121.7740, false),
    ('Japan',                'JP', '',  36.2048,   138.2529, false),
    ('South Korea',          'KR', '',  35.9078,   127.7669, false),
    ('China',                'CN', '',  35.8617,   104.1954, false),
    ('Brazil',               'BR', '', -14.2350,   -51.9253, false),
    ('Mexico',               'MX', '',  23.6345,  -102.5528, false),
    ('Argentina',            'AR', '', -38.4161,   -63.6167, false),
    ('Chile',                'CL', '', -35.6751,   -71.5430, false),
    ('Colombia',             'CO', '',   4.5709,   -74.2973, false),
    ('New Zealand',          'NZ', '', -40.9006,   174.8860, false),

    -- ============================ United States ============================
    ('United States', 'US', 'New York',       40.7128,  -74.0060, true),
    ('United States', 'US', 'Los Angeles',    34.0522, -118.2437, true),
    ('United States', 'US', 'Chicago',        41.8781,  -87.6298, true),
    ('United States', 'US', 'Houston',        29.7604,  -95.3698, true),
    ('United States', 'US', 'Phoenix',        33.4484, -112.0740, true),
    ('United States', 'US', 'Philadelphia',   39.9526,  -75.1652, true),
    ('United States', 'US', 'San Antonio',    29.4241,  -98.4936, true),
    ('United States', 'US', 'San Diego',      32.7157, -117.1611, true),
    ('United States', 'US', 'Dallas',         32.7767,  -96.7970, true),
    ('United States', 'US', 'San Francisco',  37.7749, -122.4194, true),
    ('United States', 'US', 'Seattle',        47.6062, -122.3321, true),
    ('United States', 'US', 'Denver',         39.7392, -104.9903, true),
    ('United States', 'US', 'Boston',         42.3601,  -71.0589, true),
    ('United States', 'US', 'Miami',          25.7617,  -80.1918, true),
    ('United States', 'US', 'Atlanta',        33.7490,  -84.3880, true),
    ('United States', 'US', 'Las Vegas',      36.1699, -115.1398, true),
    ('United States', 'US', 'Washington',     38.9072,  -77.0369, true),
    ('United States', 'US', 'Santa Barbara',  34.4208, -119.6982, true),

    -- ================================ Canada ================================
    ('Canada', 'CA', 'Toronto',      43.6532,  -79.3832, true),
    ('Canada', 'CA', 'Montreal',     45.5017,  -73.5673, true),
    ('Canada', 'CA', 'Vancouver',    49.2827, -123.1207, true),
    ('Canada', 'CA', 'Calgary',      51.0447, -114.0719, true),
    ('Canada', 'CA', 'Edmonton',     53.5461, -113.4938, true),
    ('Canada', 'CA', 'Ottawa',       45.4215,  -75.6972, true),
    ('Canada', 'CA', 'Quebec City',  46.8139,  -71.2080, true),
    ('Canada', 'CA', 'Winnipeg',     49.8951,  -97.1384, true),
    ('Canada', 'CA', 'Halifax',      44.6488,  -63.5752, true),

    -- ============================ United Kingdom ============================
    ('United Kingdom', 'GB', 'London',     51.5074, -0.1278, true),
    ('United Kingdom', 'GB', 'Manchester', 53.4808, -2.2426, true),
    ('United Kingdom', 'GB', 'Birmingham', 52.4862, -1.8904, true),
    ('United Kingdom', 'GB', 'Leeds',      53.8008, -1.5491, true),
    ('United Kingdom', 'GB', 'Glasgow',    55.8642, -4.2518, true),
    ('United Kingdom', 'GB', 'Liverpool',  53.4084, -2.9916, true),
    ('United Kingdom', 'GB', 'Edinburgh',  55.9533, -3.1883, true),
    ('United Kingdom', 'GB', 'Bristol',    51.4545, -2.5879, true),
    ('United Kingdom', 'GB', 'Cardiff',    51.4816, -3.1791, true),
    ('United Kingdom', 'GB', 'Belfast',    54.5973, -5.9301, true),
    ('United Kingdom', 'GB', 'Newcastle',  54.9783, -1.6178, true),

    -- ================================ Germany ===============================
    ('Germany', 'DE', 'Berlin',      52.5200, 13.4050, true),
    ('Germany', 'DE', 'Hamburg',     53.5511,  9.9937, true),
    ('Germany', 'DE', 'Munich',      48.1351, 11.5820, true),
    ('Germany', 'DE', 'Cologne',     50.9375,  6.9603, true),
    ('Germany', 'DE', 'Frankfurt',   50.1109,  8.6821, true),
    ('Germany', 'DE', 'Stuttgart',   48.7758,  9.1829, true),
    ('Germany', 'DE', 'Düsseldorf',  51.2277,  6.7735, true),
    ('Germany', 'DE', 'Leipzig',     51.3397, 12.3731, true),
    ('Germany', 'DE', 'Dresden',     51.0504, 13.7373, true),
    ('Germany', 'DE', 'Nuremberg',   49.4521, 11.0767, true),
    ('Germany', 'DE', 'Bremen',      53.0793,  8.8017, true),

    -- ================================= France ===============================
    ('France', 'FR', 'Paris',        48.8566,  2.3522, true),
    ('France', 'FR', 'Marseille',    43.2965,  5.3698, true),
    ('France', 'FR', 'Lyon',         45.7640,  4.8357, true),
    ('France', 'FR', 'Toulouse',     43.6047,  1.4442, true),
    ('France', 'FR', 'Nice',         43.7102,  7.2620, true),
    ('France', 'FR', 'Nantes',       47.2184, -1.5536, true),
    ('France', 'FR', 'Bordeaux',     44.8378, -0.5792, true),
    ('France', 'FR', 'Lille',        50.6292,  3.0573, true),
    ('France', 'FR', 'Strasbourg',   48.5734,  7.7521, true),
    ('France', 'FR', 'Montpellier',  43.6108,  3.8767, true),

    -- ================================= Poland ===============================
    ('Poland', 'PL', 'Warsaw',     52.2297, 21.0122, true),
    ('Poland', 'PL', 'Kraków',     50.0647, 19.9450, true),
    ('Poland', 'PL', 'Łódź',       51.7592, 19.4560, true),
    ('Poland', 'PL', 'Wrocław',    51.1079, 17.0385, true),
    ('Poland', 'PL', 'Poznań',     52.4064, 16.9252, true),
    ('Poland', 'PL', 'Gdańsk',     54.3520, 18.6466, true),
    ('Poland', 'PL', 'Szczecin',   53.4285, 14.5528, true),
    ('Poland', 'PL', 'Katowice',   50.2649, 19.0238, true),
    ('Poland', 'PL', 'Lublin',     51.2465, 22.5684, true),
    ('Poland', 'PL', 'Bydgoszcz',  53.1235, 18.0084, true),

    -- ================================== Egypt ===============================
    -- Names mirror the humanized EGYPT_MARKETPLACE_CITIES ids so catalog and
    -- mission-derived labels de-duplicate (e.g. sharm_el_sheikh -> Sharm El Sheikh).
    ('Egypt', 'EG', 'Cairo',            30.0444, 31.2357, true),
    ('Egypt', 'EG', 'Giza',             30.0131, 31.2089, true),
    ('Egypt', 'EG', 'Alexandria',       31.2001, 29.9182, true),
    ('Egypt', 'EG', 'Hurghada',         27.2579, 33.8116, true),
    ('Egypt', 'EG', 'Sharm El Sheikh',  27.9158, 34.3300, true),
    ('Egypt', 'EG', 'Luxor',            25.6872, 32.6396, true),
    ('Egypt', 'EG', 'Aswan',            24.0889, 32.8998, true),
    ('Egypt', 'EG', 'Ismailia',         30.5965, 32.2715, true),
    ('Egypt', 'EG', 'Port Said',        31.2653, 32.3019, true),
    ('Egypt', 'EG', 'Suez',             29.9668, 32.5498, true),
    ('Egypt', 'EG', 'Mansoura',         31.0409, 31.3785, true),
    ('Egypt', 'EG', 'Tanta',            30.7865, 31.0004, true),
    ('Egypt', 'EG', 'Asyut',            27.1783, 31.1859, true),

    -- ========================= United Arab Emirates =========================
    ('United Arab Emirates', 'AE', 'Dubai',            25.2048, 55.2708, true),
    ('United Arab Emirates', 'AE', 'Abu Dhabi',        24.4539, 54.3773, true),
    ('United Arab Emirates', 'AE', 'Sharjah',          25.3463, 55.4209, true),
    ('United Arab Emirates', 'AE', 'Ajman',            25.4052, 55.5136, true),
    ('United Arab Emirates', 'AE', 'Al Ain',           24.1302, 55.8023, true),
    ('United Arab Emirates', 'AE', 'Ras Al Khaimah',   25.7895, 55.9432, true),
    ('United Arab Emirates', 'AE', 'Fujairah',         25.1288, 56.3265, true),
    ('United Arab Emirates', 'AE', 'Umm Al Quwain',    25.5647, 55.5534, true),

    -- ============================= Saudi Arabia =============================
    ('Saudi Arabia', 'SA', 'Riyadh',     24.7136, 46.6753, true),
    ('Saudi Arabia', 'SA', 'Jeddah',     21.4858, 39.1925, true),
    ('Saudi Arabia', 'SA', 'Mecca',      21.3891, 39.8579, true),
    ('Saudi Arabia', 'SA', 'Medina',     24.5247, 39.5692, true),
    ('Saudi Arabia', 'SA', 'Dammam',     26.4207, 50.0888, true),
    ('Saudi Arabia', 'SA', 'Al Khobar',  26.2794, 50.2083, true),
    ('Saudi Arabia', 'SA', 'Taif',       21.2703, 40.4158, true),
    ('Saudi Arabia', 'SA', 'Tabuk',      28.3838, 36.5550, true),
    ('Saudi Arabia', 'SA', 'Abha',       18.2465, 42.5117, true),

    -- ================================ Australia =============================
    ('Australia', 'AU', 'Sydney',      -33.8688, 151.2093, true),
    ('Australia', 'AU', 'Melbourne',   -37.8136, 144.9631, true),
    ('Australia', 'AU', 'Brisbane',    -27.4698, 153.0251, true),
    ('Australia', 'AU', 'Perth',       -31.9505, 115.8605, true),
    ('Australia', 'AU', 'Adelaide',    -34.9285, 138.6007, true),
    ('Australia', 'AU', 'Gold Coast',  -28.0167, 153.4000, true),
    ('Australia', 'AU', 'Canberra',    -35.2809, 149.1300, true),
    ('Australia', 'AU', 'Hobart',      -42.8821, 147.3272, true),
    ('Australia', 'AU', 'Darwin',      -12.4634, 130.8456, true),

    -- ================================== Spain ===============================
    ('Spain', 'ES', 'Madrid',     40.4168, -3.7038, false),
    ('Spain', 'ES', 'Barcelona',  41.3874,  2.1686, false),
    ('Spain', 'ES', 'Valencia',   39.4699, -0.3763, false),
    ('Spain', 'ES', 'Seville',    37.3891, -5.9845, false),
    ('Spain', 'ES', 'Zaragoza',   41.6488, -0.8891, false),
    ('Spain', 'ES', 'Málaga',     36.7213, -4.4214, false),
    ('Spain', 'ES', 'Bilbao',     43.2630, -2.9350, false),
    ('Spain', 'ES', 'Palma',      39.5696,  2.6502, false),

    -- ================================== Italy ===============================
    ('Italy', 'IT', 'Rome',      41.9028, 12.4964, false),
    ('Italy', 'IT', 'Milan',     45.4642,  9.1900, false),
    ('Italy', 'IT', 'Naples',    40.8518, 14.2681, false),
    ('Italy', 'IT', 'Turin',     45.0703,  7.6869, false),
    ('Italy', 'IT', 'Palermo',   38.1157, 13.3615, false),
    ('Italy', 'IT', 'Florence',  43.7696, 11.2558, false),
    ('Italy', 'IT', 'Bologna',   44.4949, 11.3426, false),
    ('Italy', 'IT', 'Venice',    45.4408, 12.3155, false),
    ('Italy', 'IT', 'Catania',   37.5079, 15.0830, false),

    -- =============================== Netherlands ============================
    ('Netherlands', 'NL', 'Amsterdam',  52.3676, 4.9041, false),
    ('Netherlands', 'NL', 'Rotterdam',  51.9244, 4.4777, false),
    ('Netherlands', 'NL', 'The Hague',  52.0705, 4.3007, false),
    ('Netherlands', 'NL', 'Utrecht',    52.0907, 5.1214, false),
    ('Netherlands', 'NL', 'Eindhoven',  51.4416, 5.4697, false),
    ('Netherlands', 'NL', 'Groningen',  53.2194, 6.5665, false),

    -- =============================== Switzerland ============================
    ('Switzerland', 'CH', 'Zurich',    47.3769, 8.5417, false),
    ('Switzerland', 'CH', 'Geneva',    46.2044, 6.1432, false),
    ('Switzerland', 'CH', 'Basel',     47.5596, 7.5886, false),
    ('Switzerland', 'CH', 'Bern',      46.9480, 7.4474, false),
    ('Switzerland', 'CH', 'Lausanne',  46.5197, 6.6323, false),
    ('Switzerland', 'CH', 'Lucerne',   47.0502, 8.3093, false),

    -- ================================= Austria ==============================
    ('Austria', 'AT', 'Vienna',     48.2082, 16.3738, false),
    ('Austria', 'AT', 'Graz',       47.0707, 15.4395, false),
    ('Austria', 'AT', 'Linz',       48.3069, 14.2858, false),
    ('Austria', 'AT', 'Salzburg',   47.8095, 13.0550, false),
    ('Austria', 'AT', 'Innsbruck',  47.2692, 11.4041, false),

    -- ================================= Belgium ==============================
    ('Belgium', 'BE', 'Brussels',  50.8503, 4.3517, false),
    ('Belgium', 'BE', 'Antwerp',   51.2194, 4.4025, false),
    ('Belgium', 'BE', 'Ghent',     51.0543, 3.7174, false),
    ('Belgium', 'BE', 'Bruges',    51.2093, 3.2247, false),
    ('Belgium', 'BE', 'Liège',     50.6326, 5.5797, false),

    -- ================================== Sweden ==============================
    ('Sweden', 'SE', 'Stockholm',   59.3293, 18.0686, false),
    ('Sweden', 'SE', 'Gothenburg',  57.7089, 11.9746, false),
    ('Sweden', 'SE', 'Malmö',       55.6050, 13.0038, false),
    ('Sweden', 'SE', 'Uppsala',     59.8586, 17.6389, false),

    -- ================================== Norway ==============================
    ('Norway', 'NO', 'Oslo',        59.9139, 10.7522, false),
    ('Norway', 'NO', 'Bergen',      60.3913,  5.3221, false),
    ('Norway', 'NO', 'Trondheim',   63.4305, 10.3951, false),
    ('Norway', 'NO', 'Stavanger',   58.9700,  5.7331, false),

    -- ================================= Denmark ==============================
    ('Denmark', 'DK', 'Copenhagen',  55.6761, 12.5683, false),
    ('Denmark', 'DK', 'Aarhus',      56.1629, 10.2039, false),
    ('Denmark', 'DK', 'Odense',      55.4038, 10.4024, false),
    ('Denmark', 'DK', 'Aalborg',     57.0488,  9.9217, false),

    -- ================================= Ireland ==============================
    ('Ireland', 'IE', 'Dublin',    53.3498, -6.2603, false),
    ('Ireland', 'IE', 'Cork',      51.8985, -8.4756, false),
    ('Ireland', 'IE', 'Galway',    53.2707, -9.0568, false),
    ('Ireland', 'IE', 'Limerick',  52.6638, -8.6267, false),

    -- ================================= Portugal =============================
    ('Portugal', 'PT', 'Lisbon',   38.7223, -9.1393, false),
    ('Portugal', 'PT', 'Porto',    41.1579, -8.6291, false),
    ('Portugal', 'PT', 'Braga',    41.5454, -8.4265, false),
    ('Portugal', 'PT', 'Faro',     37.0194, -7.9304, false),
    ('Portugal', 'PT', 'Coimbra',  40.2033, -8.4103, false),

    -- ================================= Czechia ==============================
    ('Czechia', 'CZ', 'Prague',   50.0755, 14.4378, false),
    ('Czechia', 'CZ', 'Brno',     49.1951, 16.6068, false),
    ('Czechia', 'CZ', 'Ostrava',  49.8209, 18.2625, false),
    ('Czechia', 'CZ', 'Plzeň',    49.7384, 13.3736, false),

    -- ================================= Ukraine ==============================
    ('Ukraine', 'UA', 'Kyiv',     50.4501, 30.5234, false),
    ('Ukraine', 'UA', 'Kharkiv',  49.9935, 36.2304, false),
    ('Ukraine', 'UA', 'Odesa',    46.4825, 30.7233, false),
    ('Ukraine', 'UA', 'Dnipro',   48.4647, 35.0462, false),
    ('Ukraine', 'UA', 'Lviv',     49.8397, 24.0297, false),

    -- ================================== Turkey ==============================
    ('Turkey', 'TR', 'Istanbul',  41.0082, 28.9784, false),
    ('Turkey', 'TR', 'Ankara',    39.9334, 32.8597, false),
    ('Turkey', 'TR', 'Izmir',     38.4237, 27.1428, false),
    ('Turkey', 'TR', 'Antalya',   36.8969, 30.7133, false),
    ('Turkey', 'TR', 'Bursa',     40.1826, 29.0665, false),
    ('Turkey', 'TR', 'Adana',     37.0000, 35.3213, false),

    -- ================================== Greece ==============================
    ('Greece', 'GR', 'Athens',        37.9838, 23.7275, false),
    ('Greece', 'GR', 'Thessaloniki',  40.6401, 22.9444, false),
    ('Greece', 'GR', 'Patras',        38.2466, 21.7346, false),
    ('Greece', 'GR', 'Heraklion',     35.3387, 25.1442, false),

    -- ================================= Romania ==============================
    ('Romania', 'RO', 'Bucharest',     44.4268, 26.1025, false),
    ('Romania', 'RO', 'Cluj-Napoca',   46.7712, 23.6236, false),
    ('Romania', 'RO', 'Timișoara',     45.7489, 21.2087, false),
    ('Romania', 'RO', 'Iași',          47.1585, 27.6014, false),
    ('Romania', 'RO', 'Constanța',     44.1598, 28.6348, false),

    -- =================================== Gulf ===============================
    ('Qatar',   'QA', 'Doha',          25.2854, 51.5310, false),
    ('Qatar',   'QA', 'Al Rayyan',     25.2919, 51.4244, false),
    ('Qatar',   'QA', 'Al Wakrah',     25.1659, 51.6031, false),
    ('Kuwait',  'KW', 'Kuwait City',   29.3759, 47.9774, false),
    ('Kuwait',  'KW', 'Al Ahmadi',     29.0769, 48.0838, false),
    ('Kuwait',  'KW', 'Hawalli',       29.3328, 48.0286, false),
    ('Bahrain', 'BH', 'Manama',        26.2285, 50.5860, false),
    ('Bahrain', 'BH', 'Riffa',         26.1300, 50.5550, false),
    ('Bahrain', 'BH', 'Muharraq',      26.2572, 50.6119, false),
    ('Oman',    'OM', 'Muscat',        23.5880, 58.3829, false),
    ('Oman',    'OM', 'Salalah',       17.0151, 54.0924, false),
    ('Oman',    'OM', 'Sohar',         24.3477, 56.7089, false),
    ('Oman',    'OM', 'Nizwa',         22.9333, 57.5333, false),

    -- ============================== Levant / Israel =========================
    ('Jordan', 'JO', 'Amman',      31.9454, 35.9284, false),
    ('Jordan', 'JO', 'Zarqa',      32.0728, 36.0876, false),
    ('Jordan', 'JO', 'Irbid',      32.5556, 35.8500, false),
    ('Jordan', 'JO', 'Aqaba',      29.5321, 35.0063, false),
    ('Israel', 'IL', 'Tel Aviv',   32.0853, 34.7818, false),
    ('Israel', 'IL', 'Jerusalem',  31.7683, 35.2137, false),
    ('Israel', 'IL', 'Haifa',      32.7940, 34.9896, false),
    ('Israel', 'IL', 'Beersheba',  31.2530, 34.7915, false),

    -- ================================== Africa ==============================
    ('Morocco',      'MA', 'Casablanca',      33.5731, -7.5898, false),
    ('Morocco',      'MA', 'Rabat',           34.0209, -6.8416, false),
    ('Morocco',      'MA', 'Marrakesh',       31.6295, -7.9811, false),
    ('Morocco',      'MA', 'Fez',             34.0181, -5.0078, false),
    ('Morocco',      'MA', 'Tangier',         35.7595, -5.8340, false),
    ('Morocco',      'MA', 'Agadir',          30.4278, -9.5981, false),
    ('Tunisia',      'TN', 'Tunis',           36.8065, 10.1815, false),
    ('Tunisia',      'TN', 'Sfax',            34.7406, 10.7603, false),
    ('Tunisia',      'TN', 'Sousse',          35.8256, 10.6084, false),
    ('Nigeria',      'NG', 'Lagos',            6.5244,  3.3792, false),
    ('Nigeria',      'NG', 'Abuja',            9.0765,  7.3986, false),
    ('Nigeria',      'NG', 'Kano',            12.0022,  8.5920, false),
    ('Nigeria',      'NG', 'Ibadan',           7.3775,  3.9470, false),
    ('Nigeria',      'NG', 'Port Harcourt',    4.8156,  7.0498, false),
    ('Kenya',        'KE', 'Nairobi',         -1.2921, 36.8219, false),
    ('Kenya',        'KE', 'Mombasa',         -4.0435, 39.6682, false),
    ('Kenya',        'KE', 'Kisumu',          -0.0917, 34.7680, false),
    ('Kenya',        'KE', 'Nakuru',          -0.3031, 36.0800, false),
    ('South Africa', 'ZA', 'Johannesburg',   -26.2041, 28.0473, false),
    ('South Africa', 'ZA', 'Cape Town',      -33.9249, 18.4241, false),
    ('South Africa', 'ZA', 'Durban',         -29.8587, 31.0218, false),
    ('South Africa', 'ZA', 'Pretoria',       -25.7479, 28.2293, false),
    ('South Africa', 'ZA', 'Port Elizabeth', -33.9608, 25.6022, false),

    -- =============================== South Asia =============================
    ('India',    'IN', 'Mumbai',       19.0760, 72.8777, false),
    ('India',    'IN', 'Delhi',        28.7041, 77.1025, false),
    ('India',    'IN', 'Bengaluru',    12.9716, 77.5946, false),
    ('India',    'IN', 'Hyderabad',    17.3850, 78.4867, false),
    ('India',    'IN', 'Chennai',      13.0827, 80.2707, false),
    ('India',    'IN', 'Kolkata',      22.5726, 88.3639, false),
    ('India',    'IN', 'Pune',         18.5204, 73.8567, false),
    ('India',    'IN', 'Ahmedabad',    23.0225, 72.5714, false),
    ('India',    'IN', 'Jaipur',       26.9124, 75.7873, false),
    ('Pakistan', 'PK', 'Karachi',      24.8607, 67.0011, false),
    ('Pakistan', 'PK', 'Lahore',       31.5204, 74.3587, false),
    ('Pakistan', 'PK', 'Islamabad',    33.6844, 73.0479, false),
    ('Pakistan', 'PK', 'Faisalabad',   31.4504, 73.1350, false),
    ('Pakistan', 'PK', 'Rawalpindi',   33.5651, 73.0169, false),

    -- =============================== South East Asia ========================
    ('Singapore',   'SG', 'Singapore',           1.3521, 103.8198, false),
    ('Malaysia',    'MY', 'Kuala Lumpur',        3.1390, 101.6869, false),
    ('Malaysia',    'MY', 'George Town',         5.4141, 100.3288, false),
    ('Malaysia',    'MY', 'Johor Bahru',         1.4927, 103.7414, false),
    ('Malaysia',    'MY', 'Ipoh',                4.5975, 101.0901, false),
    ('Indonesia',   'ID', 'Jakarta',            -6.2088, 106.8456, false),
    ('Indonesia',   'ID', 'Surabaya',           -7.2575, 112.7521, false),
    ('Indonesia',   'ID', 'Bandung',            -6.9175, 107.6191, false),
    ('Indonesia',   'ID', 'Medan',               3.5952,  98.6722, false),
    ('Indonesia',   'ID', 'Denpasar',           -8.6500, 115.2167, false),
    ('Thailand',    'TH', 'Bangkok',            13.7563, 100.5018, false),
    ('Thailand',    'TH', 'Chiang Mai',         18.7883,  98.9853, false),
    ('Thailand',    'TH', 'Phuket',              7.8804,  98.3923, false),
    ('Thailand',    'TH', 'Pattaya',            12.9236, 100.8825, false),
    ('Vietnam',     'VN', 'Ho Chi Minh City',   10.8231, 106.6297, false),
    ('Vietnam',     'VN', 'Hanoi',              21.0285, 105.8542, false),
    ('Vietnam',     'VN', 'Da Nang',            16.0544, 108.2022, false),
    ('Vietnam',     'VN', 'Hai Phong',          20.8449, 106.6881, false),
    ('Philippines', 'PH', 'Manila',             14.5995, 120.9842, false),
    ('Philippines', 'PH', 'Quezon City',        14.6760, 121.0437, false),
    ('Philippines', 'PH', 'Cebu City',          10.3157, 123.8854, false),
    ('Philippines', 'PH', 'Davao',               7.1907, 125.4553, false),

    -- ================================ East Asia =============================
    ('Japan',       'JP', 'Tokyo',      35.6762, 139.6503, false),
    ('Japan',       'JP', 'Osaka',      34.6937, 135.5023, false),
    ('Japan',       'JP', 'Yokohama',   35.4437, 139.6380, false),
    ('Japan',       'JP', 'Nagoya',     35.1815, 136.9066, false),
    ('Japan',       'JP', 'Sapporo',    43.0618, 141.3545, false),
    ('Japan',       'JP', 'Fukuoka',    33.5904, 130.4017, false),
    ('Japan',       'JP', 'Kyoto',      35.0116, 135.7681, false),
    ('South Korea', 'KR', 'Seoul',      37.5665, 126.9780, false),
    ('South Korea', 'KR', 'Busan',      35.1796, 129.0756, false),
    ('South Korea', 'KR', 'Incheon',    37.4563, 126.7052, false),
    ('South Korea', 'KR', 'Daegu',      35.8714, 128.6014, false),
    ('China',       'CN', 'Shanghai',   31.2304, 121.4737, false),
    ('China',       'CN', 'Beijing',    39.9042, 116.4074, false),
    ('China',       'CN', 'Shenzhen',   22.5431, 114.0579, false),
    ('China',       'CN', 'Guangzhou',  23.1291, 113.2644, false),
    ('China',       'CN', 'Chengdu',    30.5728, 104.0668, false),
    ('China',       'CN', 'Hangzhou',   30.2741, 120.1551, false),

    -- ============================= Latin America ============================
    ('Brazil',    'BR', 'São Paulo',        -23.5505, -46.6333, false),
    ('Brazil',    'BR', 'Rio de Janeiro',   -22.9068, -43.1729, false),
    ('Brazil',    'BR', 'Brasília',         -15.8267, -47.9218, false),
    ('Brazil',    'BR', 'Salvador',         -12.9777, -38.5016, false),
    ('Brazil',    'BR', 'Fortaleza',         -3.7319, -38.5267, false),
    ('Brazil',    'BR', 'Belo Horizonte',   -19.9167, -43.9345, false),
    ('Brazil',    'BR', 'Curitiba',         -25.4284, -49.2733, false),
    ('Mexico',    'MX', 'Mexico City',       19.4326, -99.1332, false),
    ('Mexico',    'MX', 'Guadalajara',       20.6597,-103.3496, false),
    ('Mexico',    'MX', 'Monterrey',         25.6866,-100.3161, false),
    ('Mexico',    'MX', 'Puebla',            19.0414, -98.2063, false),
    ('Mexico',    'MX', 'Cancún',            21.1619, -86.8515, false),
    ('Mexico',    'MX', 'Tijuana',           32.5149,-117.0382, false),
    ('Argentina', 'AR', 'Buenos Aires',     -34.6037, -58.3816, false),
    ('Argentina', 'AR', 'Córdoba',          -31.4201, -64.1888, false),
    ('Argentina', 'AR', 'Rosario',          -32.9442, -60.6505, false),
    ('Argentina', 'AR', 'Mendoza',          -32.8895, -68.8458, false),
    ('Chile',     'CL', 'Santiago',         -33.4489, -70.6693, false),
    ('Chile',     'CL', 'Valparaíso',       -33.0472, -71.6127, false),
    ('Chile',     'CL', 'Concepción',       -36.8201, -73.0444, false),
    ('Colombia',  'CO', 'Bogotá',             4.7110, -74.0721, false),
    ('Colombia',  'CO', 'Medellín',           6.2442, -75.5812, false),
    ('Colombia',  'CO', 'Cali',               3.4516, -76.5320, false),
    ('Colombia',  'CO', 'Barranquilla',      10.9685, -74.7813, false),
    ('Colombia',  'CO', 'Cartagena',         10.3910, -75.4794, false),

    -- =============================== Oceania ================================
    ('New Zealand', 'NZ', 'Auckland',      -36.8485, 174.7633, false),
    ('New Zealand', 'NZ', 'Wellington',    -41.2865, 174.7762, false),
    ('New Zealand', 'NZ', 'Christchurch',  -43.5321, 172.6362, false),
    ('New Zealand', 'NZ', 'Hamilton',      -37.7870, 175.2793, false)
)
INSERT INTO public.location_catalog (country, country_code, city, lat, lng, is_quick_region)
SELECT country, country_code, city, lat, lng, is_quick_region
FROM seed
ON CONFLICT (country, city) DO UPDATE
SET country_code    = EXCLUDED.country_code,
    lat             = EXCLUDED.lat,
    lng             = EXCLUDED.lng,
    is_quick_region = EXCLUDED.is_quick_region;

-- ---------------------------------------------------------------------------
-- 3) Backfill missions that predate the country/city columns.
--    Assigns the nearest catalog city within MAX_KM. Rows farther than that
--    from any major city stay NULL; the client resolves those by coordinates.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  -- Generous enough to cover metro areas and surrounding regions without
  -- mislabelling pins on the far side of a border.
  v_max_km constant double precision := 300;
  v_updated integer;
BEGIN
  WITH nearest AS (
    SELECT DISTINCT ON (m.id)
      m.id,
      lc.country,
      lc.city
    FROM public.missions m
    JOIN public.location_catalog lc
      ON lc.city <> ''
     AND public.haversine_km(m.location_lat, m.location_lng, lc.lat, lc.lng) <= v_max_km
    WHERE m.location_lat IS NOT NULL
      AND m.location_lng IS NOT NULL
      AND nullif(btrim(coalesce(m.country, '')), '') IS NULL
    ORDER BY m.id,
             public.haversine_km(m.location_lat, m.location_lng, lc.lat, lc.lng)
  )
  UPDATE public.missions m
  SET country = n.country,
      city    = coalesce(nullif(btrim(coalesce(m.city, '')), ''), n.city)
  FROM nearest n
  WHERE m.id = n.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'location_catalog backfill: % mission row(s) updated', v_updated;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Keep country/city populated for any write path that omits them
--    (direct inserts, seed scripts, legacy clients). Prevents the NULL-country
--    rows that made populated regions return 0 results.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.missions_fill_location_from_catalog()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_country text;
  v_city text;
BEGIN
  IF NEW.location_lat IS NULL OR NEW.location_lng IS NULL THEN
    RETURN NEW;
  END IF;

  -- Explicit values from the client (Mapbox reverse geocode) always win.
  IF nullif(btrim(coalesce(NEW.country, '')), '') IS NOT NULL
     AND nullif(btrim(coalesce(NEW.city, '')), '') IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT lc.country, lc.city
  INTO v_country, v_city
  FROM public.location_catalog lc
  WHERE lc.city <> ''
    AND public.haversine_km(NEW.location_lat, NEW.location_lng, lc.lat, lc.lng) <= 300
  ORDER BY public.haversine_km(NEW.location_lat, NEW.location_lng, lc.lat, lc.lng)
  LIMIT 1;

  IF v_country IS NULL THEN
    RETURN NEW;
  END IF;

  IF nullif(btrim(coalesce(NEW.country, '')), '') IS NULL THEN
    NEW.country := v_country;
  END IF;
  IF nullif(btrim(coalesce(NEW.city, '')), '') IS NULL THEN
    NEW.city := v_city;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_missions_fill_location ON public.missions;
CREATE TRIGGER trg_missions_fill_location
  BEFORE INSERT OR UPDATE OF location_lat, location_lng, country, city
  ON public.missions
  FOR EACH ROW
  EXECUTE FUNCTION public.missions_fill_location_from_catalog();

-- ---------------------------------------------------------------------------
-- 5) DB-wide location facets for the filter UI.
--    Aggregates across ALL active missions (not the client's page window), so
--    every populated country/city is selectable and never yields 0 results.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_mission_location_facets();

CREATE OR REPLACE FUNCTION public.list_mission_location_facets()
RETURNS TABLE (
  country text,
  city text,
  mission_count bigint,
  lat double precision,
  lng double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    btrim(m.country)                        AS country,
    coalesce(nullif(btrim(m.city), ''), '') AS city,
    count(*)                                AS mission_count,
    avg(m.location_lat)                     AS lat,
    avg(m.location_lng)                     AS lng
  FROM public.missions m
  WHERE nullif(btrim(coalesce(m.country, '')), '') IS NOT NULL
    AND m.location_lat IS NOT NULL
    AND m.location_lng IS NOT NULL
    -- Mirrors ACTIVE_MARKET_STATUSES in components/LiveMarketFeed.tsx.
    AND lower(coalesce(m.status, '')) IN (
      'pending', 'available', 'open', 'funding', 'in_progress', 'reported'
    )
  GROUP BY btrim(m.country), coalesce(nullif(btrim(m.city), ''), '')
  ORDER BY count(*) DESC, btrim(m.country);
$$;

COMMENT ON FUNCTION public.list_mission_location_facets() IS
  'Country/city facets with mission counts and centroids across all active missions (not page limited).';

REVOKE ALL ON FUNCTION public.list_mission_location_facets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_mission_location_facets() TO anon, authenticated, service_role;
