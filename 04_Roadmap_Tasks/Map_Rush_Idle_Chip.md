---
title: RUSH idle chip matches WX
type: ui
status: shipped
updated: 2026-09-23
tags: [garbagin, map, rush, wx]
aliases: [RUSH idle chip, RUSH WX chip]
---

# RUSH idle chip matches WX

> Hub: [[🗺️ GARBAGIN Master Index]] · Map: [[04_Roadmap_Tasks/Map_Rush_Mode]] · UI: [[02_Frontend/Frontend_Components]] · Field: [[04_Roadmap_Tasks/00_Dashboard]] · Control: [[components/MapFunModeControls.tsx]]

The bottom-left **RUSH** control on [[components/MapPicker.tsx]] had been a glass pill (`rounded-2xl`, padded shell, 11px type) sized like the open Weather Debug buttons. The collapsed weather control is a much smaller **WX** chip. Idle RUSH now uses that chip. **WX is not enlarged.**

## Behavior

- **Off:** same padding (`px-1.5 py-0.5`), font (`text-[9px]` black uppercase), radius (`rounded-md`), border, and `opacity-40` ink as **WX**. Label is RUSH. No ship/plane icon, no count, no glow.
- **On:** first press is ships (amber), second is planes (lime). The chip stays the same metrics, then shows the craft icon, the live count, and a small accent glow. Third press returns to the faint chip and drops the craft layers.
- The brief peek card (RUSH + count, then it slides away) and the ships → planes → off cycle are unchanged.
- Shared class: `MAP_DEBUG_CHIP_IDLE_CLASS` in [[components/MapFunModeControls.tsx]], also applied to the collapsed WX button so the two cannot drift.

## Verify

On the map, with the profile chrome visible and the weather panel collapsed: RUSH sits with WX and is just as small and faint. Tap once — amber ship chip and count. Tap again — lime plane chip. Tap again — faint RUSH, craft layers off.
