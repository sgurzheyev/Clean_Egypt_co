---
title: App icon fill
type: ui
status: shipped
updated: 2026-09-23
tags: [garbagin, pwa, icon, brand]
aliases: [app icon, home screen icon, maskable icon]
---

# App icon fill (~94%)

> Hub: [[🗺️ GARBAGIN Master Index]] · UI: [[02_Frontend/Frontend_Components]] · Master: [[public/brand/garbagin-app-icon-1024.png]] · Export: [[scripts/export-app-icons.py]]

The home-screen **G** used to sit small on the navy plate, so the tile looked tiny next to other apps (Payoneer on the same screen). The brand master is the same 3D violet/magenta glass G with a cyan rim, cropped and scaled so the painted letter fills about **94%** of the 1024×1024 square (bounds ≈ 92% wide × 94% tall). iOS and Android still apply their own rounded / circular mask — the master stays a square with no pre-drawn squircle.

## Maskable scale

`MASKABLE_SCALE` in [[scripts/export-app-icons.py]] was **0.72**. That inset was chosen when the master itself was a small mark with padding. Applied again to a ~94% master it double-shrinks the G to ~68% of the maskable tile.

The W3C maskable safe zone is a centered circle with **diameter 80%** of the icon. **0.85 × ~94% ≈ 80%**, so the metal letter lands on that circle. The dim floor reflection is the only part that crosses it. **0.88** starts clipping the cyan rim, so it was not used.

Regenerate install copies from the repo root:

```bash
python3 scripts/export-app-icons.py
```

That rewrites `public/icon-1024.png`, `icon-512.png`, `icon-192.png`, `apple-touch-icon.png`, and the 512 / 192 maskable variants. Wired from [[public/manifest.json]] and `index.html`.
