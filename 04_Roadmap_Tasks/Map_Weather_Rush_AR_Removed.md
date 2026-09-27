---
title: Weather, RUSH, and AR removed from GarbaGin
type: product
status: shipped
updated: 2026-09-27
tags: [garbagin, map, weather, rush, ar, paranoic]
aliases: [Weather RUSH AR removal, Paranoic map features]
---

# Weather, RUSH, and AR removed from GarbaGin

> Hub: [[🗺️ GARBAGIN Master Index]] · Architecture: [[01_Architecture/Architecture_Overview]] · UI: [[02_Frontend/Frontend_Components]] · API: [[03_Backend_SQL/Backend_Edge_and_API]] · Field: [[04_Roadmap_Tasks/00_Dashboard]] · Roadmap: [[04_Roadmap_Tasks/Roadmap_to_GooglePlay]]

These map features are not useful on a cleanup / services marketplace, and AR could not be field-tested. They moved to **Paranoic** (`github.com/sgurzheyev/paranoic`). GarbaGin no longer shows them.

## Removed from the client

- Weather: WX / Weather Debug control, weather panel, Open-Meteo fetch, fog overrides, rain / sandstorm overlay.
- RUSH live traffic: plane and ship markers, trails, the ship/plane cycle button, and its lift card. No client calls to OpenSky, ADSB, or AIS.
- AR: the profile chip next to Top Up / language, and the WebXR camera view (`three` / `@react-three/*` left the app bundle).

Fun / cartoon land (neon roads) stays as its own **FUN** chip. Sunrise/sunset lighting stays on SunCalc and does not depend on weather codes. Garba-Vortex heatmap, sectors, and storm mode stay.

## Proxies left on purpose

Do not delete these until Paranoic has its own proxy:

- [[api/opensky-states.ts]]
- [[api/adsb-nearby.ts]]
- [[api/_lib/adsbNearbyFetch.ts]]
- [[api/ais-nearby.ts]]

The GarbaGin client does not call them. `VITE_AISSTREAM_API_KEY` is no longer read in the browser; the AIS lambda may still fall back to that server env.

Prior notes (historical): [[04_Roadmap_Tasks/Map_Rush_Mode]] · [[04_Roadmap_Tasks/Map_Rush_Idle_Chip]].
