-- ============================================================================
-- Fix cross-border city autofill in missions_fill_location_from_catalog()
-- ----------------------------------------------------------------------------
-- BUG (introduced in 20260726_global_location_catalog.sql)
--   When the client supplied a country but no city, the trigger filled `city`
--   from the globally nearest catalog city without checking that the city
--   actually belongs to the supplied country. A pin at Kortrijk, Belgium
--   (nearest seeded city: Lille, France, ~25 km) was stored as
--   country='Belgium', city='Lille'. Such a row is partially unfilterable:
--   Belgium + any Belgian city misses it, and so does France + Lille.
--
--   This is reachable in practice whenever reverse geocoding resolves a country
--   but no place/locality feature (common for rural pins).
--
-- FIX
--   1. When the country is already known, only consider cities in THAT country.
--      If none is within range the city stays NULL — an absent city facet is
--      preferable to a wrong one, and the country filter still works.
--   2. When the city is known but the country is not, trust the city name: take
--      the country from the catalog row with that city name, preferring the
--      geographically closest match (city names repeat across countries).
--
-- LIMITATION
--   Attribution is still a nearest-major-city heuristic, not a polygon lookup.
--   A pin whose city name is absent from the catalog can still be attributed to
--   a neighbouring country's city. Accurate values must come from the Mapbox
--   reverse geocode on the client.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.missions_fill_location_from_catalog()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Same radius as the original backfill: a city label should mean "near here".
  v_max_km constant double precision := 300;
  v_country text := nullif(btrim(coalesce(NEW.country, '')), '');
  v_city text := nullif(btrim(coalesce(NEW.city, '')), '');
  v_match_country text;
  v_match_city text;
BEGIN
  IF NEW.location_lat IS NULL OR NEW.location_lng IS NULL THEN
    RETURN NEW;
  END IF;

  -- Explicit values from the client (Mapbox reverse geocode) always win.
  IF v_country IS NOT NULL AND v_city IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- City known, country missing: the city name is the stronger signal.
  IF v_country IS NULL AND v_city IS NOT NULL THEN
    SELECT lc.country
    INTO v_match_country
    FROM public.location_catalog lc
    WHERE lc.city <> ''
      AND lower(btrim(lc.city)) = lower(v_city)
    ORDER BY public.haversine_km(NEW.location_lat, NEW.location_lng, lc.lat, lc.lng)
    LIMIT 1;

    IF v_match_country IS NOT NULL THEN
      NEW.country := v_match_country;
      RETURN NEW;
    END IF;
  END IF;

  -- Nearest catalog city. When the country is already known, never cross the
  -- border: restrict candidates to cities within that country.
  SELECT lc.country, lc.city
  INTO v_match_country, v_match_city
  FROM public.location_catalog lc
  WHERE lc.city <> ''
    AND (v_country IS NULL OR lower(btrim(lc.country)) = lower(v_country))
    AND public.haversine_km(NEW.location_lat, NEW.location_lng, lc.lat, lc.lng) <= v_max_km
  ORDER BY public.haversine_km(NEW.location_lat, NEW.location_lng, lc.lat, lc.lng)
  LIMIT 1;

  IF v_match_country IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_country IS NULL THEN
    NEW.country := v_match_country;
  END IF;
  IF v_city IS NULL THEN
    NEW.city := v_match_city;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.missions_fill_location_from_catalog() IS
  'Fills missions.country/city from location_catalog by nearest major city. Never assigns a city from a different country than the one supplied.';
