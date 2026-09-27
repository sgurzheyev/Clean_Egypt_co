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

## Proxies removed

Paranoic has its own proxies. These GarbaGin routes are gone:

- [[api/opensky-states.ts]]
- [[api/adsb-nearby.ts]]
- [[api/_lib/adsbNearbyFetch.ts]]
- [[api/ais-nearby.ts]]

`src/lib/liveCraftProxy.test.ts` went with them. `AISSTREAM_API_KEY` and `VITE_AISSTREAM_API_KEY` are no longer in [[.env.example]]. Garba-Vortex stays: [[api/garba-vortex-heatmap.ts]].

Prior notes (historical): [[04_Roadmap_Tasks/Map_Rush_Mode]] · [[04_Roadmap_Tasks/Map_Rush_Idle_Chip]].
