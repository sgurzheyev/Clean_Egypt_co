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
supabase db query --linked -f supabase/migrations/20260927140000_free_pin_expiry.sql
```

Safe to re-run. Re-runs do **not** reset a tuned `garba_vortex_config` row and do **not** clear an active storm flag. Stage 5 is the second file. Neither file has been applied to prod.

## What you see

| Zoom | Map |
| --- | --- |
| 0–11 | Heatmap plus every paid / bounty pin. Only free report pins fade into the mass. A cluster that contains any paid pin stays visible. Dense cities stay a crimson/purple mass. A lone pin in an empty region is a bright spike. |
| 11–12 | Heatmap opacity falls to 0. Free report pins fade in. Paid pins were already visible. |
| 12–20 | All pins, same as before. Closed squares are an outline only (fill stops at zoom 12) so the pin stays readable. |

Palette on `heatmap-density`: transparent, grey, neon green `#39ff14`, orange `#ff9f1a`, plasma `#1a0033`, crimson `#ff0055`.

If the heatmap or sector RPC is missing, the client detects `PGRST202` / `42883` only (not every "does not exist" message) and stops calling that function for the rest of the session. Pin opacity stays at 1 so the live map does not go blank. Viewport fetches wait 400 ms. Heatmap and storm status are requested together on the RPC fallback. The admin storm card polls every 15 s only while the admin panel's Analytics pillar is mounted, and it stops if that RPC is missing.

## Data

No parallel pin table. Columns on `public.missions`:

- `severity_score` integer 1–100 (default 1). A bump adds 1, capped at 100. The owner's `photo_urls` and `video_proof_url` stay untouched.
- `is_isolated` boolean, **default false**. An insert or an update of location / lat / lng / `hidden_at` / status runs `garba_vortex_isolation_trigger`, which sets true only when visible neighbours inside `isolation_radius_m` are at or below `isolation_neighbor_max`. A new paid pin is not a black-hole spike before that recompute.
- `sector_id` uuid, set on free pins dissolved into a closed square.

Bump photos and the optional video live in `garba_vortex_contributions` (`reporter_id`, `mission_id`, `sector_id`, `photo_urls`, `created_at`). No client role can read that table.

Hidden rows (`hidden_at`) are excluded from the heatmap and from sector counts. `get_garba_vortex_heatmap` and `get_garba_vortex_public_status` are `STABLE` and do not write. Storm is evaluated on `place_free_vortex_pin` / `garba_vortex_record_write` and when an admin saves. The snapshot refreshes from `record_write` only while storm is already on, and from `admin_set_garba_vortex_storm`. A quiet period does not clear storm until the next free-pin write (or an admin force-off). Aggregates are grid cells (max 2000), not raw pins. During storm mode the cells come from `garba_vortex_heatmap_snapshot`, with `isolated` and `black_hole` forced off. Anon heatmap reads never write.

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

Paid pins (`create_lead_mission_with_token`, including the photo pin) are unchanged. On the map they stay individual points at street zoom (above 14). Zooming out clusters nearby pins into one larger cyan dot with a count; tapping the dot expands it back into points. The existing pin click still opens the mission once the points are split.

## Free pin lifetime

A $0 free report lives until `crowdfunding_expires_at` (stamped at create as now()+7 days). After that, heatmap, sector, and bump reads treat it as gone, and the map / market list do the same even if the row is still `reported`. `expire_stale_free_garbage_pins()` sets `status=hidden`. The migration looks for `pg_cron` in `pg_extension` and schedules an hourly job when the extension can be created. If it cannot, the function stays callable by `service_role` or a platform admin.

A Stripe contribution does not use this file. `apply_stripe_contribution` already sets the clock to at least now()+30 days on every successful payment, so each later donation extends it again. Crowdfunding amounts are USD (`current_funding`), not the bid token. The first paid dollar still wakes the report into a funding campaign, which is an explicit contribution, not an automatic mission from a sector threshold.

## Cleanup sectors

Free reports (`is_report`) snap to a 200 m × 200 m grid (`sector_grid_m`, 0.04 km²). At `sector_pin_threshold` (default 5, the centre + 4 pattern) the cell becomes `cleanup_sectors.status = 'cleanup'`:

- One square polygon (fill + line, not a fill-extrusion — extrusion fights the globe style on mid-range phones). Fill `maxzoom` is 12; the outline stays so the square does not cover its pin at street zoom. Vortex layers are inserted with `beforeId` at the lowest existing mission-pin or RUSH plane/ship layer, so they sit under those pins. Weather is a DOM canvas above the GL map.
- **No automatic mission.** The fifth report does not become the creator and the price is not invented. `mission_id` stays null. `garba_vortex_sector_order_open(NULL)` is true, so the unfunded square stays on the map and blocks new free pins. Any signed-in user opens it with `open_cleanup_sector_mission`: `auth.uid()` is the creator, and the RPC calls `create_lead_mission_with_token` ($2 floor, token bid, optional crowdfund). The caller's own photo array is stored; other reporters' photos are not copied.
- Member free-report pins stay in the database. The map hides only free reports inside the square. Paid and non-report missions inside the same square stay visible.
- The square stops accepting free pins while it is unfunded or its order is still open (`available` / `funding` / `in_progress` / `review` and the usual aliases). When a linked order is completed, hidden, or archived, the polygon drops off the map and the square accepts pins again.
- Tap the polygon (when no pin is under the finger). If `mission_id` is set and that job is loaded, it opens. Otherwise the Cleanup Sector sheet asks for a budget and optional crowdfund, then calls the RPC.

## Black hole (no Three.js)

Mapbox circle layers: purple halo, crimson ring, hot core. Pulse is one `requestAnimationFrame` loop that writes feature-state `pulse` about every 220 ms. The React paint expressions read `['feature-state', 'pulse']` and are not rewritten each frame. The loop pauses when the tab is hidden, the camera is moving, zoom is 12 or higher, or no black-hole cell is in view (capped at 48, nearest the camera). No GeoJSON rewrite per frame.

- `VITE_GARBA_VORTEX_BLACK_HOLE=0` or `localStorage.garba_vortex_black_hole=0` hides the rings. The heatmap spike remains.
- `prefers-reduced-motion`, Save-Data, `deviceMemory <= 2`, or `hardwareConcurrency <= 2` keeps a **static** ring and skips the animation loop. Mid-range Android (typically 8 cores / 4 GB+) keeps the pulse.

Demo without the database: open the app with `?vortexDemo=1` (Cairo mass + Western Desert hole). Street square: `?vortexDemo=1&vortexZoom=15.2&vortexLat=30.0365&vortexLng=31.2755`.

## Storm mode

Free-pin **creates and bumps** (committed only, not the dry-run) land in `garba_vortex_write_events`. Rows older than 15 minutes are deleted inside the recorder. Clients cannot read that table.

`garba_vortex_evaluate_storm` (owner only) runs inside `place_free_vortex_pin` before the insert (so the throttle matches the pre-write state) and again inside `garba_vortex_record_write` after the ledger row. It does **not** run from the public heatmap, the public status RPC, or the admin 15 s poll. `admin_set_garba_vortex_storm` still evaluates because that call is an admin write:

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
| `place_free_vortex_pin(...)` | authenticated, service_role | Writes. Bump updates `severity_score` only and inserts `garba_vortex_contributions`. Optional token debit when cost &gt; 0. |
| `create_garbage_zone_report(...)` | authenticated, service_role | Same rules; returns the mission uuid (existing or bumped). |
| `get_garba_vortex_heatmap(...)` | anon, authenticated | `STABLE`. Cells. Storm: averaged snapshot, no spikes. No writes. |
| `get_garba_vortex_public_status()` | anon, authenticated | `STABLE`. `{ storm, cache_seconds }` only. |
| `get_garba_vortex_sectors(...)` | anon, authenticated | `STABLE`. Closed squares, including unfunded ones (`mission_id` null). |
| `open_cleanup_sector_mission(...)` | authenticated, service_role | Explicit fund. Creator is `auth.uid()`. Anon cannot execute. |
| `admin_get_garba_vortex_storm()` / `admin_set_garba_vortex_storm(...)` | authenticated (admin check inside) | Get is `STABLE` and does not evaluate. Set evaluates and can refresh. Audited. |
| `garba_vortex_evaluate_storm` / `garba_vortex_record_write` / `refresh_garba_vortex_heatmap_snapshot` | owner only | Not granted to anon or authenticated. |
| `garba_vortex_refresh_isolation` / `garba_vortex_rollup_sector` / `garba_vortex_isolation_trigger` | owner only | Trigger runs on mission insert/update. Not granted to anon or authenticated. |
