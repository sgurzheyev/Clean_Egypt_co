# GarbaGin app icon

1024×1024 master: `garbagin-app-icon-1024.png`

3D glass-metal **G** on navy glass (`#020617`), violet/magenta CTA metal (`#8b5cf6` → `#c026ff`), cyan rim (`#22d3ee`), emerald spark reserved as a minor refraction note. The letter fills ~94% of the square — OS applies rounded/circular masks. Maskable copies scale this master to 0.85 (`MASKABLE_SCALE` in the export script). See `02_Frontend/App_Icon_Fill.md`.

Regenerate PWA copies:

```bash
python3 scripts/export-app-icons.py
```

See `02_Frontend/Frontend_Components.md` → **App icon (PWA install)**.
