---
tags: [map, heatmap, vortex, sql]
aliases: [Garba-Vortex, Garba Vortex Heatmap]
---

# Garba-Vortex heatmap

> ← [[🗺️ GARBAGIN Master Index]] · [[04_Roadmap_Tasks/00_Dashboard]] · [[02_Frontend/Frontend_Components]] · [[03_Backend_SQL/SQL_Migrations_Index]] · [[01_Architecture/Architecture_Overview]]

Macro waste heatmap on the existing Mapbox globe, with server-side free-pin anti-spam, 200 m cleanup squares, and storm mode. Migrations: [[20260927120000_garba_vortex.sql]] then [[20260927130000_garba_vortex_storm.sql]]. Client: [[src/lib/garbaVortex.ts]] · [[src/hooks/useGarbaVortexOverlay.ts]] · [[components/MapPicker.tsx]] · [[api/garba-vortex-heatmap.ts]]. Admin indicator: [[src/components/AdminVortexStormCard.tsx]] on the Analytics pillar.

Apply on prod by hand (do not `db push`), base file first:

```bash
supabase db query --linked -f supabase/migrations/20260927120000_garba_vortex.sql
supabase db query --linked -f supabase/migrations/20260927130000_garba_vortex_storm.sql
```

Safe to re-run. Re-runs do **not** reset a tuned `garba_vortex_config` row and do **not** clear an active storm flag. The first file's header still says storm was left out; stage 5 is the second file.

## What you see

| Zoom | Map |
| --- | --- |
| 0–11 | Heatmap only. Dense cities stay a crimson/purple mass. A lone pin in an empty region is a bright spike. |
| 11–12 | Heatmap opacity falls to 0 while mission pins (and the existing cluster circles) fade in. |
| 12–20 | Pins only, same as before. Closed squares stay as a purple/crimson fill under the pins. |

Palette on `heatmap-density`: transparent, grey, neon green `#39ff14`, orange `#ff9f1a`, plasma `#1a0033`, crimson `#ff0055`.

If `get_garba_vortex_sectors` is missing (migration not applied yet), the client leaves pin opacity alone so the live map does not go blank at country zoom.

## Data

No parallel pin table. Columns on `public.missions`:

- `severity_score` integer 1–100 (default 1). Duplicate reports add 1, capped at 100.
- `is_isolated` boolean. True when visible neighbours inside `isolation_radius_m` are at or below `isolation_neighbor_max`.
- `sector_id` uuid, set on free pins dissolved into a closed square.

Hidden rows (`hidden_at`) are excluded from the heatmap and from sector counts. `get_garba_vortex_heatmap` is `SECURITY DEFINER` so it can refresh the storm snapshot, with the same explicit `hidden_at` filter the invoker version used (public mission reads are already "visible unless hidden"). Aggregates are grid cells (max 2000), not raw pins. During storm mode the cells come from `garba_vortex_heatmap_snapshot` instead, with `isolated` and `black_hole` forced off.

PostGIS was already installed (`20260720_proof_of_work_lifecycle_security.sql`, `missions.location`). This migration creates it only when it is absent (`extensions` schema on Supabase, otherwise the current schema). Proximity, isolation, and the square polygon use `ST_DWithin` / `ST_Covers` plus a partial GiST index. The heatmap itself is a zoom-sized lat/lng grid (`garba_vortex_cell_m`): about 400 km at zoom 0, floored at 250 m. Grid bins stay stable while panning; `ST_ClusterDBSCAN` was skipped because it is heavier and the cells move between requests.

Weight is capped at 12. An isolated singleton is at least ~8 so a desert report still reads as a mountain next to Cairo. A black-hole ring is a separate circle layer, only when that singleton's severity is at least `black_hole_min_severity`.

## Anti-spam

Enforced in `place_free_vortex_pin` (`SECURITY DEFINER`, `auth.uid()`). `create_garbage_zone_report` delegates to it, so old clients cannot skip the checks. Anon has no execute. Nothing here moves money for anon.

`p_commit=false` is a dry run the app calls before the R2 upload.

| Check | Default | Behaviour |
| --- | --- | --- |
| Free pins / user / day | 5 | New row rejected with `free_pin_daily_limit`. A bump does not count. Storm tightens this; see below. |
| Same pile, any reporter | 35 m | Recent free pin this close is bumped (`severity_score + 1`) instead of inserted. |
| Own recent pin | 200 m | The caller's own free pin inside `bump_radius_m` is bumped. Other people can still place pins in that square (centre + 4). |
| Scope `any` | off | Set `bump_scope` to `any` and the 200 m bump applies to every reporter. Sectors then fill only after `bump_recency_days`. |
| Recent window | 14 days | Older pins do not bump. |
| Closed square | — | New free pin inside the polygon raises `cleanup_sector_closed`. |
| High-risk tokens | **0** | When `high_risk_token_cost` > 0 and the cell already has `high_risk_min_pins` free pins, that many tokens are deducted inside the same RPC. Default 0 leaves the token balance alone. |

Paid pins (`create_lead_mission_with_token`, including the photo pin) are unchanged.

## Cleanup sectors

Free reports (`is_report`) snap to a 200 m × 200 m grid (`sector_grid_m`, 0.04 km²). At `sector_pin_threshold` (default 5, the centre + 4 pattern) the cell becomes `cleanup_sectors.status = 'cleanup'`:

- One square polygon (fill + line, not a fill-extrusion — extrusion fights the globe style on mid-range phones).
- One **available** bounty mission at the cell centre (`beach_street_cleanup`, `expected_price` between $2 and $40, `amount_target` 1). It uses the existing bid flow and does not start a 7-day crowdfund clock, so the order does not quietly expire. Member report pins stay in the database; the map hides them inside the square. The sector mission pin stays.
- The square stops accepting free pins while that order is still open (`available` / `funding` / `in_progress` / `review` and the usual aliases). When the order is completed, hidden, or archived, the polygon drops off the map and the square accepts pins again.
- Tap the polygon (when no pin is under the finger) to open that mission if it is in the loaded set.

## Black hole (no Three.js)

Mapbox circle layers: purple halo, crimson ring, hot core. The ring radius/opacity pulse at ~8 fps via `setPaintProperty` only while zoom &lt; 12, the camera is idle, and there is at least one black-hole cell (capped at 48, nearest the camera). No GeoJSON rewrite per frame.

- `VITE_GARBA_VORTEX_BLACK_HOLE=0` or `localStorage.garba_vortex_black_hole=0` hides the rings. The heatmap spike remains.
- `prefers-reduced-motion`, Save-Data, `deviceMemory <= 2`, or `hardwareConcurrency <= 2` keeps a **static** ring and skips the animation loop. Mid-range Android (typically 8 cores / 4 GB+) keeps the pulse.

Demo without the database: open the app with `?vortexDemo=1` (Cairo mass + Western Desert hole). Street square: `?vortexDemo=1&vortexZoom=15.2&vortexLat=30.0365&vortexLng=31.2755`.

## Storm mode

Free-pin **creates and bumps** (committed only, not the dry-run) land in `garba_vortex_write_events`. Rows older than 15 minutes are deleted inside the recorder. Clients cannot read that table.

`garba_vortex_evaluate_storm` (owner only) runs on each commit and at most every 5 seconds from the heatmap read:

| `storm_mode` | Behaviour |
| --- | --- |
| `auto` (default) | Turns **on** when global writes in the last minute ≥ `storm_global_writes_per_minute` (60) **or** any `storm_region_km` bucket (25 km) ≥ `storm_region_writes_per_minute` (12). Stays on until **both** rates drop below `storm_release_ratio` (0.60) times their thresholds **and** `storm_cooldown_seconds` (120) have passed since `active_since`. Reason is `global`, `region`, `cooldown`, or `clear`. |
| `on` | Forced. Reason `forced_on`. Ignores the counters. |
| `off` | Forced calm. Reason `forced_off`. |

While it is on:

- The heatmap RPC serves `garba_vortex_heatmap_snapshot` (coarse `storm_cell_m`, default 8 km, cap 4000 cells). Weights use the dense-city formula only — the isolated-singleton floor is not applied. Each cell is `0.7 × own + 0.3 × neighbour average`. A singleton with no neighbour is dimmed to 35% of that blend, so a desert spike does not paint a black hole. `isolated` and `black_hole` are false. The snapshot refreshes when older than `storm_snapshot_ttl_seconds` (60). A second caller in the same window keeps the previous snapshot (`pg_try_advisory_xact_lock`). If the snapshot is empty, the RPC falls back to a coarse live aggregate that still suppresses spikes.
- `GET /api/garba-vortex-heatmap` sets `Cache-Control: public, max-age=<storm_cache_seconds>, s-maxage=<storm_cache_seconds>, stale-while-revalidate=<2×>`. Calm responses are `private, no-store`. A warm lambda also keeps a short in-memory copy of storm responses. The route is public (no user JWT). Missing Supabase env returns 503 and the map client calls the RPC directly. Direct RPC calls skip the CDN; the app prefers the API route. Vite dev proxies the same handler.
- Free pins use `least(free_pins_per_day, storm_free_pins_per_day)` (default 1), `greatest` bump radii (`storm_bump_radius_m` 500, `storm_same_spot_radius_m` 200), and `bump_scope` forced to `any`. The dry-run uses the same limits so the preflight matches. If the storm cap is what rejects the row and it is tighter than the calm cap, the error is `free_pin_storm_limit` (RU/EN copy on the report sheet). Otherwise it stays `free_pin_daily_limit`. The write that crosses the threshold is still accepted; the **next** request is throttled. Token cost stays 0 unless `high_risk_token_cost` was raised.

The admin Analytics pillar shows a Calm/Storm pill, writes per minute against both thresholds, snapshot age, and Auto / Force on / Force off. Saving calls `admin_set_garba_vortex_storm` (platform admin or service role) and writes `admin_audit_log` when Admin P1's `private.write_admin_audit` is present. Null arguments leave a tune unchanged. "Save + refresh snapshot" passes `p_refresh=true`.

Public clients can read only `{ storm, cache_seconds }` from `get_garba_vortex_public_status`. Write counts stay on the admin RPC.

Demo without the database: `?vortexDemo=1&vortexStorm=1` draws the seeded heatmap with spikes and the black-hole ring removed.

## Where to tune

Zoom fade is client-only, in [[src/lib/garbaVortex.ts]]:

- `VORTEX_ZOOM_HEATMAP_FULL = 11`
- `VORTEX_ZOOM_PINS_FULL = 12`

Everything else is the singleton row `public.garba_vortex_config` (`id = 1`):

```sql
UPDATE public.garba_vortex_config
SET
  free_pins_per_day = 5,
  bump_radius_m = 200,
  same_spot_radius_m = 35,
  bump_scope = 'own_user', -- or 'any'
  bump_recency_days = 14,
  isolation_radius_m = 25000,
  isolation_neighbor_max = 1,
  sector_grid_m = 200,
  sector_pin_threshold = 5,
  high_risk_token_cost = 0,
  high_risk_min_pins = 3,
  black_hole_min_severity = 8,
  storm_mode = 'auto',          -- off | auto | on
  storm_global_writes_per_minute = 60,
  storm_region_writes_per_minute = 12,
  storm_region_km = 25,
  storm_snapshot_ttl_seconds = 60,
  storm_free_pins_per_day = 1,
  storm_bump_radius_m = 500,
  storm_same_spot_radius_m = 200,
  storm_cache_seconds = 30,
  storm_cooldown_seconds = 120,
  storm_release_ratio = 0.60,
  storm_cell_m = 8000,
  updated_at = now()
WHERE id = 1;
```

Prefer the admin card for `storm_mode`, the two write thresholds, the storm daily cap, and the storm bump radius. The SQL above is the full set. Do not delete the singleton row.

Heatmap cell size is `greatest(250 m, 400 km / 2^zoom)` in `garba_vortex_cell_m`. Change that function if city cells should be coarser.

## RPCs

| RPC | Who | Notes |
| --- | --- | --- |
| `place_free_vortex_pin(...)` | authenticated, service_role | Writes. Optional token debit when cost &gt; 0. |
| `create_garbage_zone_report(...)` | authenticated, service_role | Same rules; returns the mission uuid (existing or bumped). |
| `get_garba_vortex_heatmap(...)` | anon, authenticated | Cells. Storm: averaged snapshot, no spikes. |
| `get_garba_vortex_public_status()` | anon, authenticated | `{ storm, cache_seconds }` only. |
| `get_garba_vortex_sectors(...)` | anon, authenticated | Closed squares with an open order. |
| `admin_get_garba_vortex_storm()` / `admin_set_garba_vortex_storm(...)` | authenticated (admin check inside) | Counts, mode, thresholds. Audited. |
| `garba_vortex_evaluate_storm` / `garba_vortex_record_write` / `refresh_garba_vortex_heatmap_snapshot` | owner only | Not granted to anon or authenticated. |
| `garba_vortex_refresh_isolation` / `garba_vortex_rollup_sector` | owner only | Not granted to anon or authenticated. |
