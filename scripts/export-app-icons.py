#!/usr/bin/env python3
"""Export GarbaGin PWA / install icons from the 1024×1024 brand master.

Source of truth: public/brand/garbagin-app-icon-1024.png
Palette (from index.css / MapPicker / MapBootSplash — not Paranoic cyan):
  navy glass   #020617  #0A0A12  #05060a
  violet CTA   #8b5cf6  #a855f7
  magenta      #c026d3  #c026ff
  cyan accent  #22d3ee
  emerald tag  #10b981  #34d399

Usage (from repo root):
  python3 scripts/export-app-icons.py
"""

from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "public" / "brand" / "garbagin-app-icon-1024.png"
PUBLIC = ROOT / "public"

# Android maskable safe zone is the centered 80% circle. Scale the full-bleed
# master down so the 3D G survives circular / squircle launcher crops.
MASKABLE_SCALE = 0.72
# Fallback if the master cannot be sampled (matches --uv-bg / html background).
NAVY_FALLBACK = (0x02, 0x06, 0x17)


def _resample(im: Image.Image, size: int) -> Image.Image:
    return im.resize((size, size), Image.Resampling.LANCZOS)


def _save(im: Image.Image, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    rgb = im.convert("RGB")
    rgb.save(dest, format="PNG", optimize=True)
    print(f"  {dest.relative_to(ROOT)}  {rgb.size[0]}×{rgb.size[1]}")


def _navy(master: Image.Image) -> tuple[int, int, int]:
    """Use the master's corner so the padded maskable plate does not ring."""
    w, h = master.size
    samples = [
        master.getpixel((0, 0)),
        master.getpixel((w - 1, 0)),
        master.getpixel((0, h - 1)),
        master.getpixel((w - 1, h - 1)),
    ]
    r = sum(p[0] for p in samples) // 4
    g = sum(p[1] for p in samples) // 4
    b = sum(p[2] for p in samples) // 4
    return (r, g, b) if any((r, g, b)) else NAVY_FALLBACK


def make_maskable(master: Image.Image, size: int, navy: tuple[int, int, int]) -> Image.Image:
    canvas = Image.new("RGB", (size, size), navy)
    mark_size = max(1, int(round(size * MASKABLE_SCALE)))
    mark = _resample(master, mark_size)
    xy = ((size - mark_size) // 2, (size - mark_size) // 2)
    canvas.paste(mark, xy)
    return canvas


def main() -> None:
    if not MASTER.is_file():
        raise SystemExit(f"Missing master icon: {MASTER}")

    master = Image.open(MASTER).convert("RGB")
    if master.size != (1024, 1024):
        print(f"Note: master is {master.size}, normalizing to 1024×1024")
        master = _resample(master, 1024)
        _save(master, MASTER)

    print("Exporting GarbaGin install icons")
    # Keep the master encoding for the 1024 install copy (avoid re-inflate).
    shutil.copy2(MASTER, PUBLIC / "icon-1024.png")
    print(f"  public/icon-1024.png  1024×1024 (copied)")
    _save(_resample(master, 512), PUBLIC / "icon-512.png")
    _save(_resample(master, 192), PUBLIC / "icon-192.png")
    _save(_resample(master, 180), PUBLIC / "apple-touch-icon.png")
    navy = _navy(master)
    _save(make_maskable(master, 512, navy), PUBLIC / "icon-512-maskable.png")
    _save(make_maskable(master, 192, navy), PUBLIC / "icon-192-maskable.png")


if __name__ == "__main__":
    main()
