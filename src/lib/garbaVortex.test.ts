/**
 * Garba-Vortex pure helpers.
 * Run: npx tsx src/lib/garbaVortex.test.ts
 */
import assert from 'node:assert/strict';
import {
  bboxFromView,
  capBlackHoles,
  classifyVortexPinError,
  heatmapOpacityForZoom,
  isDissolvedMissionPin,
  pinFadeForZoom,
  pointInRing,
  readVortexDemoCamera,
  squareRing,
  VORTEX_ZOOM_HEATMAP_FULL,
  VORTEX_ZOOM_PINS_FULL,
} from './garbaVortex.ts';
import { demoVortexCells, demoVortexSectors } from './garbaVortexDemo.ts';

assert.equal(heatmapOpacityForZoom(0), 0.9);
assert.equal(heatmapOpacityForZoom(VORTEX_ZOOM_HEATMAP_FULL), 0.9);
assert.equal(heatmapOpacityForZoom(VORTEX_ZOOM_PINS_FULL), 0);
assert.ok(Math.abs(heatmapOpacityForZoom(11.5) - 0.45) < 1e-9);

assert.equal(pinFadeForZoom(4, false), 1);
assert.equal(pinFadeForZoom(4, true), 0);
assert.equal(pinFadeForZoom(12, true), 1);
assert.equal(pinFadeForZoom(16, true), 1);
assert.ok(Math.abs(pinFadeForZoom(11.5, true) - 0.5) < 1e-9);

const ring = squareRing(31.2755, 30.0365, 100);
assert.equal(pointInRing(31.2755, 30.0365, ring), true);
assert.equal(pointInRing(31.29, 30.05, ring), false);

const sector = demoVortexSectors()[0];
assert.equal(isDissolvedMissionPin('member-pin', sector.centerLng, sector.centerLat, [sector]), true);
assert.equal(
  isDissolvedMissionPin(sector.missionId || '', sector.centerLng, sector.centerLat, [sector]),
  false
);

const holes = capBlackHoles(
  [
    { lng: 0, lat: 0 },
    { lng: 10, lat: 10 },
    { lng: 1, lat: 0 },
  ],
  { lng: 0, lat: 0 },
  2
);
assert.equal(holes.length, 2);
assert.equal(holes[0].lng, 0);

assert.equal(classifyVortexPinError('free_pin_daily_limit'), 'daily_limit');
assert.equal(classifyVortexPinError('P0001: cleanup_sector_closed'), 'sector_closed');
assert.equal(classifyVortexPinError('insufficient_tokens'), 'insufficient_tokens');
assert.equal(classifyVortexPinError('Location required'), null);

const demoCam = readVortexDemoCamera('?vortexDemo=1&vortexZoom=15.2&vortexLat=30.03&vortexLng=31.27');
assert.equal(demoCam?.zoom, 15.2);
assert.equal(readVortexDemoCamera('?vortexDemo=0'), null);

const box = bboxFromView(30, 31, 4);
assert.ok(box.maxLat > box.minLat);
assert.ok(box.maxLng > box.minLng);

const cells = demoVortexCells();
assert.ok(cells.some((c) => c.blackHole && c.isolated));
assert.ok(cells.some((c) => !c.blackHole && c.weight >= 8));

console.log('garbaVortex.test.ts ok');
