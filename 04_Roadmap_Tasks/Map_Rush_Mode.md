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
- Ships: AISStream WebSocket when `VITE_AISSTREAM_API_KEY` is baked at build time. Class A + Class B position reports. Placeholder values (`SUPABASE_SERVICE_ROLE_KEY`, empty, ALL_CAPS env names) are treated as **no key** → chip **ships off**. Never fake vessels.

## Land (RUSH on)

H2H Move night: dark navy land `#0a1018`, muted greenspace, cyan road glow. Off → existing Standard dark slate. No property-price HUD.

## Env

See [[.env.example]] `VITE_AISSTREAM_API_KEY`. Do not commit keys.

## Related files

- [[components/MapFunModeControls.tsx]]
- [[src/lib/mapFunMode.ts]]
- [[src/lib/mapLiveTraffic.ts]]
- [[src/hooks/useMapLiveTraffic.ts]]
- [[src/lib/openskyFlights.ts]]
- [[src/lib/aisShips.ts]]
