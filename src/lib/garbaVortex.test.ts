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
  blackHolePulseOpacity,
  blackHolePulseRadius,
  isDissolvedMissionPin,
  isMissingRpcError,
  lowestOverlayAnchor,
  parseVortexHeatmapQuery,
  pinFadeForZoom,
  vortexPinPaintOpacity,
  pointInRing,
  readVortexDemoCamera,
  squareRing,
  stormCacheControl,
  suppressStormSpikes,
  VORTEX_ZOOM_HEATMAP_FULL,
  VORTEX_ZOOM_PINS_FULL,
} from './garbaVortex.ts';
import { demoVortexCells, demoVortexSectors } from './garbaVortexDemo.ts';
import {
  heatmapMemoryKey,
  parseVortexHeatmapQuery as parseRouteQuery,
  queryGarbaVortexHeatmap,
  readHeatmapMemory,
  stormCacheControl as routeStormCacheControl,
  writeHeatmapMemory,
} from '../../api/garba-vortex-heatmap.ts';

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
assert.equal(
  isDissolvedMissionPin('member-pin', sector.centerLng, sector.centerLat, [sector], true),
  true
);
assert.equal(
  isDissolvedMissionPin('paid-pin', sector.centerLng, sector.centerLat, [sector], false),
  false
);
assert.equal(
  isDissolvedMissionPin(sector.missionId || '', sector.centerLng, sector.centerLat, [sector], true),
  false
);

assert.equal(isMissingRpcError({ code: 'PGRST202', message: 'Could not find the function' }), true);
assert.equal(isMissingRpcError({ code: '42883', message: 'function does not exist' }), true);
assert.equal(isMissingRpcError({ message: 'column foo does not exist' }), false);
assert.equal(isMissingRpcError({ code: 'PGRST204', message: 'schema cache' }), false);
assert.equal(lowestOverlayAnchor(['basemap', 'mission-pins-glow', 'weather-rain'], ['mission-pins-glow', 'live-flights']), 'mission-pins-glow');
assert.equal(lowestOverlayAnchor(['basemap'], ['mission-pins-glow']), undefined);
assert.equal(JSON.stringify(vortexPinPaintOpacity(1, 0)).includes('is_report'), true);
assert.equal(JSON.stringify(blackHolePulseRadius()).includes('feature-state'), true);
assert.equal(JSON.stringify(blackHolePulseOpacity(0.5)).includes('feature-state'), true);

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

assert.equal(classifyVortexPinError('free_pin_storm_limit'), 'storm_limit');
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

assert.equal(stormCacheControl(false, 30), 'private, no-store');
assert.equal(
  stormCacheControl(true, 30),
  'public, max-age=30, s-maxage=30, stale-while-revalidate=60'
);
assert.equal(stormCacheControl(true, 1), routeStormCacheControl(true, 1));
assert.equal(stormCacheControl(true, 999), routeStormCacheControl(true, 999));
assert.equal(stormCacheControl(false, 30), routeStormCacheControl(false, 30));

const spiked = suppressStormSpikes(
  [{ lng: 1, lat: 2, weight: 9, pointCount: 1, maxSeverity: 40, isolated: true, blackHole: true }],
  true
);
assert.equal(spiked[0].blackHole, false);
assert.equal(spiked[0].isolated, false);
assert.equal(spiked[0].weight, 9);

const parsed = parseVortexHeatmapQuery(
  new URLSearchParams('minLng=10&minLat=20&maxLng=30&maxLat=40&zoom=4&includeReports=0')
);
assert.equal(parsed.ok, true);
if (parsed.ok) {
  assert.equal(parsed.query.includeReports, false);
  assert.equal(parsed.query.zoom, 4);
  const routeParsed = parseRouteQuery(
    new URLSearchParams('minLng=10&minLat=20&maxLng=30&maxLat=40&zoom=4&includeReports=0')
  );
  assert.deepEqual(routeParsed, parsed);
  const key = heatmapMemoryKey(parsed.query);
  writeHeatmapMemory(key, { storm: true, cache_seconds: 30, cells: [{ lng: 12 }] }, stormCacheControl(true, 30), 1_000);
  const hit = readHeatmapMemory(key, 2_000);
  assert.equal(Array.isArray(hit?.body.cells), true);
}
const bad = parseVortexHeatmapQuery(new URLSearchParams('minLng=nope'));
assert.equal(bad.ok, false);

const cached = await queryGarbaVortexHeatmap({
  searchParams: new URLSearchParams('minLng=10&minLat=20&maxLng=30&maxLat=40&zoom=4&includeReports=0'),
  now: 3_000,
});
assert.equal(cached.status, 200);
assert.match(cached.cacheControl, /^public, max-age=/);
assert.equal(cached.body.storm, true);

const missing = await queryGarbaVortexHeatmap({
  searchParams: new URLSearchParams('zoom=4'),
});
assert.equal(missing.status, 400);
assert.equal(missing.cacheControl, 'private, no-store');

console.log('garbaVortex.test.ts ok');
