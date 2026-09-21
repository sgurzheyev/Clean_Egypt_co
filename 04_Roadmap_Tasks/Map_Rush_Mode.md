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

Palette FAB on [[components/MapPicker.tsx]] is **RUSH**. One press opens the lift card + cinematic night land + live craft. Press again and the card retracts; land tokens restore.

## Copy

Short only: **RUSH** / `plane or ship only!` / `press · look · closed` (RU: `только самолёт или корабль!` · `нажал · смотри · закрыл`). No OpenSky/AIS key paragraphs on the card.

## Craft

- **Planes:** lime markers + lime trails. Label = callsign · altitude m · km/h.
- **Ships:** amber markers + amber trails, rotated to heading/COG. Label = name · course ° · kn.
- Viewport bbox is expanded to a **minimum** span so street zoom at Marina Hurghada still queries HRG + Red Sea.
- Flights poll same-origin [[api/opensky-states.ts]] and [[api/adsb-nearby.ts]] **in parallel**. ADSB tries `adsb.lol` then `opendata.adsb.fi` (normalizes `{ aircraft }` → `{ ac }`) because Vercel datacenter IPs often get Cloudflare HTML 403 from adsb.lol, and OpenSky often `fetch failed` from iad1.
- Ships: AISStream WebSocket when `VITE_AISSTREAM_API_KEY` is baked at build time. Class A + Class B position reports. No key → `ships off`. Never fake vessels.

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
