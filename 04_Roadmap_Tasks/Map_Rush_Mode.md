---
title: Map RUSH Mode
type: architecture
status: shipped
updated: 2026-09-21
tags: [garbagin, map, rush, live-traffic, opensky, aisstream]
aliases: [RUSH, live traffic, fun map]
---

# Map RUSH mode (live planes + ships)

> Hub: [[🗺️ GARBAGIN Master Index]] · UI: [[02_Frontend/Frontend_Components]] · APIs: [[03_Backend_SQL/Backend_Edge_and_API]] · Field: [[04_Roadmap_Tasks/00_Dashboard]]

Palette FAB on [[components/MapPicker.tsx]] cycles **off → ships → planes → off**. Each craft press peeks a tiny **RUSH + SHIP/PLANE** chip, then the card **slides back** so the map stays visible. Third press turns RUSH off (steel land). Night land tint is on only while ships or planes mode is active.

## Copy

Card: **RUSH** + one-word chip **SHIP** or **PLANE**. No hint paragraphs, no «press · look · closed», no «нет самолётов». FAB itself shows a ship/plane icon plus the same chip while a mode is active.

## Craft

- **Planes** (2nd press): lime markers + lime trails only. Label = callsign · altitude m · km/h.
- **Ships** (1st press): amber markers + amber trails only, rotated to heading/COG. Label = name · course ° · kn.
- Viewport bbox is expanded to a **minimum** span so street zoom at Marina Hurghada still queries HRG + Red Sea.
- Flights poll same-origin [[api/opensky-states.ts]] and [[api/adsb-nearby.ts]] **in parallel**. ADSB merges `adsb.lol` + `opendata.adsb.fi` (normalizes `{ aircraft }` → `{ ac }`) because Vercel datacenter IPs often get Cloudflare HTML 403 from adsb.lol, and OpenSky often `fetch failed` from iad1. Empty lol `ac: []` does not skip fi. `/api/adsb-nearby` is a **self-contained** lambda (no `./_lib` import) and returns **200 `{ ac, error? }`** even when both hosts fail — never `FUNCTION_INVOCATION_FAILED`.
- Query bbox is **camera-centered**. Globe + high pitch makes `map.getBounds()` world-wide; clamping that recenters on (0,0) so planes never appear over Port Said / Istanbul. `getBounds` span is used only when it is a real viewport.
- Flight poll does **not** remount on `cameraBusy` / bbox nudges (those are refs inside tick). `moveLayer` is **not** applied to slotted RUSH craft layers (Standard slot `top`); yanking them out of the slot hides them under the globe.
- PLANE FAB/peek chip shows the live **count** or a short **error** from `flightMeta`.
- **Ships** poll same-origin [[api/ais-nearby.ts]] (AISStream WS is **server-side only** — browsers get 401/CORS). Collect ~3s of Class A + Class B position reports, return `{ ships }`. Chip: count / `0` / `…` / `ws` / `need-key`. Never fake vessels. Env: prefer `AISSTREAM_API_KEY` (not inlined); lambda also reads `VITE_AISSTREAM_API_KEY` as a transitional fallback.

## Land (RUSH on)

H2H Move night: dark navy land `#0a1018`, muted greenspace, cyan road glow. Off → existing Standard dark slate. No property-price HUD.

## Env

See [[.env.example]] `AISSTREAM_API_KEY` (preferred) / `VITE_AISSTREAM_API_KEY` (fallback). Do not commit keys.

## Related files

- [[components/MapFunModeControls.tsx]]
- [[src/lib/mapFunMode.ts]]
- [[src/lib/mapLiveTraffic.ts]]
- [[src/hooks/useMapLiveTraffic.ts]]
- [[src/lib/openskyFlights.ts]]
- [[src/lib/aisShips.ts]]
- [[api/ais-nearby.ts]]
