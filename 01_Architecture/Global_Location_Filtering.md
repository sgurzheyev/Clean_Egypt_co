---
tags: [architecture, location, filtering, missions, moc]
aliases: [Global Location Filtering, Multi-Country Filter, Location Catalog, Location Facets]
---

# Global Location Filtering

> Worldwide country + city filtering for mission pins and feeds. Hub: [[🗺️ GARBAGIN Master Index]] · Related: [[01_Architecture/Architecture_Overview]], [[02_Frontend/Frontend_Components]], [[03_Backend_SQL/SQL_Migrations_Index]].

Egypt-only geofencing is gone — pins may be placed anywhere on Earth. This note documents how a mission acquires a country/city, how the filter catalog is assembled, and where the current sharp edges are.

## The problem this solves

A naive filter builds its country list from the missions the client has already loaded. Two failure modes follow:

1. Most legacy `missions` rows had `country`/`city` as **NULL**, so no country filter could ever match them.
2. Page limits (100–500 rows) meant a populated country could be missing from the dropdown entirely — or present but returning **0 results**.

The fix attacks both: backfill + trigger guarantee the columns are populated, and a dedicated facets RPC reports **DB-wide** counts rather than page-window counts.

---

## Database layer

### Columns

`missions.country text` and `missions.city text` (both nullable) — [[../supabase/migrations/20260725_mission_country_city.sql]]. The create RPCs accept `p_country` / `p_city` and normalize blanks to NULL via `nullif(btrim(...), '')`.

### `location_catalog` reference table

[[../supabase/migrations/20260726_global_location_catalog.sql]]

| Aspect | Detail |
| --- | --- |
| Rows | **54** country-centroid rows (`city = ''`) + **318** major-city rows |
| Countries | 54 |
| `is_quick_region` | Marks one-tap chip countries (118 rows across 10 countries) |
| Keys | `UNIQUE (country, city)`; lat/lng range checks |
| Indexes | `(country)`, plus a partial `(country, city) WHERE city <> ''` for nearest-city scans |
| RLS | `SELECT` for `anon` + `authenticated`; **no** write policies — service_role only |
| Seeding | Idempotent `ON CONFLICT` upsert, so re-running refreshes coordinates and flags |

City names deliberately match the humanized labels the client produces, so catalog values and mission-derived values de-duplicate cleanly.

### `haversine_km()`

Great-circle distance helper in SQL, mirroring `haversineKm()` in [[../src/lib/egyptMarketplace.ts]]. Used by the backfill, the trigger, and nearest-city lookups.

### Backfill

The migration assigned `country`/`city` to every pre-existing row whose country was NULL, using the nearest catalog city within **300 km**.

### Trigger — `trg_missions_fill_location`

```
BEFORE INSERT OR UPDATE OF location_lat, location_lng, country, city
ON public.missions FOR EACH ROW
EXECUTE FUNCTION public.missions_fill_location_from_catalog()
```

Resolution order (current behaviour after [[../supabase/migrations/20260726_fix_location_trigger_border.sql]]):

1. **Both values supplied** → returned untouched. Client (Mapbox) values always win.
2. **City known, country missing** → country taken from the catalog row with that city name, closest match winning when the name repeats across countries.
3. **Otherwise** → nearest catalog city within **300 km**. When the country is already known, candidates are **restricted to cities in that country** so the fill can never cross a border.
4. **Nothing in range** → both stay NULL rather than inventing a location.

> The border restriction in step 3 fixes a real bug: a pin at Kortrijk, Belgium previously resolved to `Belgium / Lille` (Lille is in France), leaving the row unfilterable under either country.

### `list_mission_location_facets()`

`STABLE`, `SECURITY DEFINER`, granted to `anon`/`authenticated`/`service_role`. Returns `country, city, mission_count, lat, lng` grouped by country+city, ordered by count descending.

Only **active** missions are counted: `pending`, `available`, `open`, `funding`, `in_progress`, `reported`. Rows need a non-empty country and non-null coordinates. The returned lat/lng is the **average** of member missions — the centroid used for camera flights.

---

## Frontend layer

### Modules

| Module | Responsibility |
| --- | --- |
| [[../src/lib/globalMarketplace.ts]] | Catalog assembly, region resolution, filtering, fly targets |
| [[../src/lib/locationCatalogSource.ts]] | Fetches + caches `location_catalog` and the facets RPC |
| [[../src/hooks/useLocationCatalog.ts]] | React hook combining DB sources with locally loaded missions |
| [[../components/MissionFilterPanel.tsx]] | Multi-country chips, quick regions, city dropdown |
| [[../src/lib/egyptMarketplace.ts]] | Legacy Egypt hub helpers, still used as an offline fallback |

### Catalog assembly

`buildLocationCatalog()` merges three sources, in ascending order of authority for *presence* and descending for *counts*:

1. **Reference rows** — every seeded country appears in the dropdown even with zero missions.
2. **Facets** — authoritative DB-wide `countryCounts` / `cityCounts` and centroids.
3. **Loaded missions** — keeps optimistic/local rows visible before the DB knows them.

The resulting `LocationCatalog` carries `countries`, `citiesByCountry`, `countryCentroids`, `cityCentroids`, `quickCountries`, `countryCounts`, `cityCounts`, `referenceCities`, and a `revision` counter used to invalidate the per-mission region cache.

### Region resolution

`resolveMissionRegion(mission, catalog)` decides which country/city a mission belongs to:

1. Stored `country` **and** `city` when both are non-empty.
2. Nearest catalog reference city within **300 km** (same radius as SQL, so client and server agree).
3. Legacy Egypt hub fallback (`closestMarketplaceCity`, 450 km).
4. Empty strings — the mission matches only *All World*.

Results are memoized in a `WeakMap` keyed by mission object, guarded by the catalog `revision`.

### Caching

- Reference catalog: fetched **once per page load** (static data), with in-flight de-duplication.
- Facets: **60 s TTL** (`FACETS_TTL_MS`), also de-duplicated.
- Any failure (table/RPC missing, offline) degrades to empty arrays and a `console.warn`, so the filter silently falls back to mission-derived values.

### Filter semantics

`filterMissionsByCountriesCity(missions, countryIds, cityId, catalog)`:

- `countryIds` is an **array**. Empty (or containing `all_world` / legacy `all_egypt`) means **All World**.
- `cityId` of `''` (`MARKETPLACE_ALL_CITIES_ID`) means all cities across the union of selected countries.
- Country matching is case-insensitive; city matching is applied on top of the country constraint.

`citiesForCountrySelection()` returns the city list for the union of selected countries. When countries change, a city no longer in the union is reset to *All Cities*.

### Camera sync

`resolveFilterFlyTarget(catalog, countryIds, cityId)` prefers the city centroid, then the country centroid, then a hardcoded fallback centroid, and feeds the cinematic `flyTo`. A skip-ref suppresses the flight on first mount so the map doesn't jump on load.

### Consumers

| Surface | Notes |
| --- | --- |
| [[../components/MapPicker.tsx]] | Pins + filter; keeps the catalog in a ref for the once-bound native click handler |
| [[../components/LiveMarketFeed.tsx]] | Market feed; passes `open` as the hook's `enabled` flag |
| [[../components/Profile.tsx]] | Marketplace tab inside the profile sidebar |

i18n keys: `marketplaceWorldAll`, `marketplaceAllCities`, `marketplaceAddCountry`, `marketplaceCountriesSelected` — [[../src/i18n.ts]].

---

## Query contract — always select `country, city`

[[../services/supabase.ts]] creates an **untyped** client (no generated `Database` types), so an omitted column is `undefined` at runtime with **no compile error**. Any select feeding a filter, card, or location badge must list `country` and `city` explicitly.

Selects currently carrying both: map pin fetch and deep-link/refresh in [[../components/MapPicker.tsx]], [[../components/LiveMarketFeed.tsx]], all four mission queries in [[../components/Profile.tsx]], [[../src/components/AROverlay.tsx]], [[../components/SupervisorDashboard.tsx]], [[../src/components/AdminDashboard.tsx]], and the PDF fetch in [[../supabase/functions/city-notification-pipeline/index.ts]].

Deliberately excluded (no location UI): admin pending-approvals and overview counts, the hall-of-fame cleaner join, Stripe checkout validation, and [[../api/analyze-mission.ts]].

## Display fallback

`missionLocationLine()` in [[../components/MissionBriefing.tsx]] and [[../components/LiveMarketFeed.tsx]] renders, in order: a `📍` first line already embedded in the description → `City, Country` from the columns → nearest Egypt hub → raw coordinates.

---

## Known gaps

Worth reading before extending this system.

1. **Mapbox reverse geocoding returns 403.** Geocoding v5 *and* v6 are rejected by the current `VITE_MAPBOX_TOKEN` while the styles endpoint returns 200, so the token appears to lack geocoding scope. Consequence: the DB trigger is the **de facto** source of country/city, i.e. a nearest-major-city estimate rather than a real lookup. [[../src/lib/mapboxReverseGeocode.ts]] now sets a `geocodeFailed` flag and [[../components/MapPicker.tsx]] surfaces a one-shot toast (`pinLocationDetectUnavailable`).
2. **Heuristic, not polygons.** A pin whose city name is absent from the catalog can still be attributed to a neighbouring country's city.
3. **`QUICK_REGION_COUNTRIES` is a manual mirror** of the `is_quick_region` rows and can drift from the DB.
4. **`invalidateLocationFacets()` is exported but never called** — a new mission's country may take up to 60 s to appear in the filter.
5. **`cityCounts` is computed but unused** — the city dropdown shows no counts, so a user can still pick a city and hit an unexplained zero.
6. **Coordinate updates don't re-resolve.** The trigger returns early when both columns are set, so moving a pin would leave stale values. No in-app path currently changes coordinates.

---

## Hub

[[🗺️ GARBAGIN Master Index]] · [[01_Architecture/Architecture_Overview]] · [[02_Frontend/Frontend_Components]] · [[03_Backend_SQL/SQL_Migrations_Index]] · [[04_Roadmap_Tasks/00_Dashboard]]
