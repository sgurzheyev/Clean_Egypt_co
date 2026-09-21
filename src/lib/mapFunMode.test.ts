/**
 * Regression checks for fun-map solar/traffic helpers.
 * Run: npx tsx src/lib/mapFunMode.test.ts
 */
import { resolveMapboxLightPreset } from './mapboxStandardTheme.ts';
import {
  cycleRushCraftMode,
  isRushCraftMode,
  isRushLandOn,
  isUsableAisstreamApiKey,
  MAPBOX_STANDARD_FUN_LAND_COLORS,
  FUN_NEON_CYAN,
  FUN_NEON_VIOLET,
} from './mapFunMode.ts';
import {
  buildSolarAtmosphere,
  horizonPeak,
  mixHex,
  twilightWarmth,
} from './mapSolarAtmosphere.ts';
import {
  bboxRadiusNm,
  bboxToAisstreamBox,
  clampBbox,
  capTrafficEntities,
  createTrailTracker,
  entitiesToGeoJSON,
  FLIGHT_TRAIL_COLOR,
  formatAltitudeLabel,
  formatHeading,
  liveTrafficCap,
  padAndClampBbox,
  SHIP_TRAIL_COLOR,
  trafficTooltipLabel,
  TRAFFIC_BBOX_MIN_LAT_SPAN,
  type LiveTrafficEntity,
} from './mapLiveTraffic.ts';
import { parseOpenSkyStates, parseAdsbNearby } from './openskyFlights.ts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mergeAdsbAircraft,
  pickAdsbAircraftList,
} from '../../api/_lib/adsbNearbyFetch.ts';
import { queryAdsbNearby as queryAdsbNearbyHandler } from '../../api/adsb-nearby.ts';
import {
  AIS_POSITION_MESSAGE_TYPES,
  buildAisstreamSubscribeMessage,
  createAisShipTracker,
  parseAisstreamMessage,
} from './aisShips.ts';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function testFunPalette() {
  assert(FUN_NEON_CYAN === '#22d3ee', 'cyan palette');
  assert(FUN_NEON_VIOLET === '#67e8f9', 'rush motorways cyan-forward');
  assert(MAPBOX_STANDARD_FUN_LAND_COLORS.colorRoads === FUN_NEON_CYAN, 'fun roads cyan');
  assert(MAPBOX_STANDARD_FUN_LAND_COLORS.colorMotorways === FUN_NEON_VIOLET, 'fun motorways');
  assert(MAPBOX_STANDARD_FUN_LAND_COLORS.colorLand === '#0a1018', 'h2h dark land');
  assert(FLIGHT_TRAIL_COLOR === '#4ade80', 'plane trail lime');
  assert(SHIP_TRAIL_COLOR === '#f59e0b', 'ship trail amber');
}

function testRushCycle() {
  assert(cycleRushCraftMode('off') === 'ships', 'off → ships');
  assert(cycleRushCraftMode('ships') === 'planes', 'ships → planes');
  assert(cycleRushCraftMode('planes') === 'off', 'planes → off');
  assert(isRushLandOn('ships') && isRushLandOn('planes'), 'land on while craft active');
  assert(!isRushLandOn('off'), 'land off when RUSH off');
  assert(isRushCraftMode('planes') && !isRushCraftMode('both'), 'mode guard');
}

function testTwilightCurve() {
  assert(twilightWarmth(-20) === 0, 'deep night no warmth');
  assert(twilightWarmth(40) === 0, 'midday no warmth');
  assert(Math.abs(twilightWarmth(0) - 1) < 1e-9, 'horizon peak warmth');
  assert(horizonPeak(0) > horizonPeak(6), 'horizon bell peaks at 0');
  const dawn = buildSolarAtmosphere({
    sunAltDeg: 1.2,
    isMorning: true,
    moonFrac: 0.2,
    moonElevDeg: -10,
    camZoom: 12,
    camPitch: 55,
  });
  assert(dawn.lightPreset === 'dawn', 'low morning sun → dawn');
  assert(dawn.twilight, 'near-horizon is twilight');
  assert(String(dawn.fogPack['high-color']).startsWith('#'), 'warm high-color');
  assert((dawn.fogPack['horizon-blend'] as number) > 0.14, 'cinematic horizon blend');

  const duskFun = buildSolarAtmosphere({
    sunAltDeg: -1,
    isMorning: false,
    moonFrac: 0,
    moonElevDeg: -5,
    camZoom: 12,
    camPitch: 60,
    funMode: true,
  });
  const duskNorm = buildSolarAtmosphere({
    sunAltDeg: -1,
    isMorning: false,
    moonFrac: 0,
    moonElevDeg: -5,
    camZoom: 12,
    camPitch: 60,
    funMode: false,
  });
  assert(duskFun.lightPreset === 'dusk', 'evening civil twilight → dusk');
  assert(
    (duskFun.fogPack['horizon-blend'] as number) >= (duskNorm.fogPack['horizon-blend'] as number),
    'fun mode amplifies horizon bloom'
  );

  const night = buildSolarAtmosphere({
    sunAltDeg: -20,
    isMorning: true,
    moonFrac: 0.9,
    moonElevDeg: 40,
    camZoom: 8,
    camPitch: 50,
  });
  assert(night.isNight, 'deep night');
  assert(night.lightPreset === 'night', 'night preset');
  assert(resolveMapboxLightPreset({ sunAltDeg: 25, isMorning: true }) === 'day', 'midday day');
  assert(mixHex('#000000', '#ffffff', 0.5) === '#808080', 'mixHex midpoint');
}

function testBboxCaps() {
  const wide = clampBbox({ lamin: 20, lomin: 20, lamax: 40, lomax: 50 });
  assert(wide.lamax - wide.lamin <= 8.01, 'lat span capped');
  assert(wide.lomax - wide.lomin <= 10.01, 'lng span capped');
  const padded = padAndClampBbox({ lamin: 29.9, lomin: 31.1, lamax: 30.2, lomax: 31.4 });
  assert(padded.lamin < 29.9, 'pads south');
  const tight = clampBbox({ lamin: 27.19, lomin: 33.83, lamax: 27.22, lomax: 33.86 });
  assert(tight.lamax - tight.lamin >= TRAFFIC_BBOX_MIN_LAT_SPAN - 0.02, 'min lat span at street zoom');
  const box = bboxToAisstreamBox(padded);
  assert(box[0][0] === padded.lamin && box[0][1] === padded.lomin, 'AIS [lat,lon] SW');
  assert(bboxRadiusNm(padded) >= 15, 'adsb radius min');
  assert(liveTrafficCap(5, 'flight') < liveTrafficCap(14, 'flight'), 'zoom-out caps flights');
}

function testOpenSkyParse() {
  const parsed = parseOpenSkyStates({
    time: 1,
    states: [
      ['abc123', 'MSR123  ', 'Egypt', 1, 1, 31.24, 30.04, 10000, false, 200, 180, 0, null, 10100, null, false, 0],
      ['bad', 'X', 'Egypt', 1, 1, null, null, null, false, null, null, null, null, null, null, false, 0],
      'nope',
    ],
  });
  assert(parsed.length === 1, 'drop null coords');
  assert(parsed[0].callsign === 'MSR123', 'trim callsign');
  assert(parsed[0].kind === 'flight', 'kind flight');
  assert(parsed[0].heading === 180, 'track');

  const adsb = parseAdsbNearby({
    ac: [
      { hex: '503d71', flight: 'CFG002  ', lat: 30.1, lon: 31.2, alt_baro: 37000, track: 171, gs: 440 },
      { hex: 'x', lat: 30, lon: 31, alt_baro: 'ground', track: 0, gs: 12 },
    ],
  });
  assert(adsb.length === 2, 'adsb rows');
  assert(adsb[1].onGround === true, 'ground flag');
  assert(adsb[0].callsign === 'CFG002', 'adsb callsign trim');

  const fi = parseAdsbNearby({
    aircraft: [{ hex: '8963d2', flight: 'UAE5M  ', lat: 30.2, lon: 31.4, alt_geom: 34000, track: 10, gs: 480 }],
  });
  assert(fi.length === 1, 'adsb.fi aircraft key');
  assert(fi[0].callsign === 'UAE5M', 'fi callsign');
}

function testAisParseAndTracker() {
  const msg = parseAisstreamMessage({
    MessageType: 'PositionReport',
    MetaData: { MMSI: 622123456, ShipName: 'RED SEA STAR', latitude: 27.2, longitude: 33.8 },
    Message: {
      PositionReport: {
        UserID: 622123456,
        Latitude: 27.2,
        Longitude: 33.8,
        Cog: 90,
        Sog: 12.4,
        TrueHeading: 88,
      },
    },
  });
  assert(msg?.kind === 'ship', 'ship kind');
  assert(msg?.callsign === 'RED SEA STAR', 'ship name');
  assert(msg?.speedKn === 12.4, 'sog kn');
  assert(parseAisstreamMessage({ MessageType: 'Other' }) === null, 'ignore non-position');

  const classB = parseAisstreamMessage({
    MessageType: 'StandardClassBPositionReport',
    MetaData: { MMSI: 622999001, ShipName: 'HURGHADA SKIFF', latitude: 27.19, longitude: 33.84 },
    Message: {
      StandardClassBPositionReport: {
        UserID: 622999001,
        Latitude: 27.19,
        Longitude: 33.84,
        Cog: 210,
        Sog: 6.2,
        TrueHeading: 511,
      },
    },
  });
  assert(classB?.kind === 'ship', 'class B ship');
  assert(classB?.heading === 210, 'class B heading falls back to COG');

  const sub = JSON.parse(
    buildAisstreamSubscribeMessage('k', { lamin: 27, lomin: 33, lamax: 28, lomax: 34 })
  );
  assert(sub.APIKey === 'k', 'subscribe key');
  assert(sub.FilterMessageTypes[0] === 'PositionReport', 'position only');
  assert(sub.FilterMessageTypes.includes('StandardClassBPositionReport'), 'class B subscribed');
  assert(AIS_POSITION_MESSAGE_TYPES.length >= 3, 'multiple AIS position types');
  assert(sub.BoundingBoxes[0][0][0] === 27, 'lat first in AIS bbox');

  const tracker = createAisShipTracker();
  tracker.upsert(msg!, 1_000);
  assert(tracker.size() === 1, 'upsert');
  tracker.prune(1_000 + 100_000);
  assert(tracker.size() === 0, 'stale prune');
}

function testAisPlaceholderKeys() {
  assert(!isUsableAisstreamApiKey(''), 'empty key is off');
  assert(!isUsableAisstreamApiKey('SUPABASE_SERVICE_ROLE_KEY'), 'env name is not an AIS key');
  assert(!isUsableAisstreamApiKey('VITE_AISSTREAM_API_KEY'), 'vite name is not an AIS key');
  assert(!isUsableAisstreamApiKey('undefined'), 'undefined string is off');
  assert(!isUsableAisstreamApiKey('short'), 'too short');
  assert(
    isUsableAisstreamApiKey('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
    'uuid-shaped token is usable'
  );
}

function jsonResponse(body: unknown, status = 200, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType },
  });
}

function testAdsbProxyHelpers() {
  assert(pickAdsbAircraftList({ ac: [{ hex: 'abc' }] }).length === 1, 'ac key');
  assert(pickAdsbAircraftList({ aircraft: [{ hex: 'def' }] }).length === 1, 'aircraft key');
  assert(pickAdsbAircraftList({ ac: 'nope' }).length === 0, 'non-array ac');
  const merged = mergeAdsbAircraft([
    [{ hex: 'AAA', flight: 'ONE' }, null as unknown as { hex: string }, { hex: 'bbb', flight: 'TWO' }],
    [{ hex: 'aaa', flight: 'DUP' }],
  ]);
  assert(merged.length === 2, 'hex-dedupe + skip null craft');
  assert(merged.some((c) => c.hex === 'aaa' && c.flight === 'DUP'), 'later host wins same hex');
}

async function testAdsbQuerySoftEmpty() {
  const boom = async () => {
    throw new Error('network down');
  };
  const empty = await queryAdsbNearbyHandler(30.04, 31.23, 150, boom as unknown as typeof fetch, 50);
  assert(empty.ac.length === 0, 'soft empty ac');
  assert(typeof empty.error === 'string' && empty.error.length > 0, 'error string on failure');
  assert(empty.source === 'none', 'no source when both hosts fail');
}

async function testAdsbQueryMergesFiAircraft() {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('adsb.lol')) {
      return new Response('<html>cloudflare</html>', {
        status: 403,
        headers: { 'content-type': 'text/html' },
      });
    }
    return jsonResponse({
      aircraft: [
        { hex: '8963d2', flight: 'UAE5M  ', lat: 30.2, lon: 31.4, alt_geom: 34000, track: 10, gs: 480 },
        null,
      ],
    });
  };
  const hit = await queryAdsbNearbyHandler(30.04, 31.23, 150, fetchImpl, 200);
  assert(hit.ac.length === 1, 'fi aircraft after lol 403');
  assert(hit.ac[0].hex === '8963d2', 'kept hex');
  assert(hit.source === 'adsb.fi', 'source fi');
  assert(!hit.error, 'no error when ac present');
}

function testAdsbHandlerHasNoRelativeImports() {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../../api/adsb-nearby.ts'), 'utf8');
  const relativeImports = src
    .split('\n')
    .filter((line) => /^\s*import\s/.test(line) && /from\s+['"]\.\//.test(line));
  assert(
    relativeImports.length === 0,
    'adsb-nearby must not import ./_lib (Vercel ESM boot crash)'
  );
  assert(!src.includes('AbortSignal.timeout'), 'avoid AbortSignal.timeout on the ADSB lambda');
  assert(!src.includes('ReturnType<'), 'no ReturnType assertions in the handler');
}

function testGeoJsonAndCaps() {
  const many: LiveTrafficEntity[] = Array.from({ length: 200 }, (_, i) => ({
    id: `flt-${i}`,
    kind: 'flight' as const,
    lat: 30 + i * 0.01,
    lng: 31,
    heading: 10,
    callsign: `A${i}`,
    altitudeM: 8000,
    speedKn: 400,
  }));
  const capped = capTrafficEntities(many, 5, 'flight');
  assert(capped.length === liveTrafficCap(5, 'flight'), 'cap count');
  const gj = entitiesToGeoJSON(capped.slice(0, 1));
  assert(gj.features[0].geometry.coordinates[0] === 31, 'geojson lng first');
  const tip = trafficTooltipLabel(capped[0]);
  assert(tip.includes('m') || tip.includes('GND'), 'tooltip has alt meters');
  assert(formatAltitudeLabel(10000) === '10,000m', 'altitude meters');
  assert(formatHeading(88) === '88°', 'heading degrees');
  assert(!JSON.stringify(gj).includes('€'), 'no price glyphs');
  assert(!JSON.stringify(gj).toLowerCase().includes('/mo'), 'no rent HUD');

  const trails = createTrailTracker({ maxPoints: 4, minStepDeg: 0.00001 });
  const a: LiveTrafficEntity = { ...capped[0], lng: 31, lat: 30 };
  const b: LiveTrafficEntity = { ...capped[0], lng: 31.01, lat: 30.01 };
  trails.sync([a], 'flight');
  const line = trails.sync([b], 'flight');
  assert(line.features.length === 1, 'trail after second point');
  assert(line.features[0].geometry.coordinates.length === 2, 'two trail verts');
}

testFunPalette();
testRushCycle();
testTwilightCurve();
testBboxCaps();
testOpenSkyParse();
testAisParseAndTracker();
testGeoJsonAndCaps();
testAisPlaceholderKeys();
testAdsbProxyHelpers();
testAdsbHandlerHasNoRelativeImports();
void (async () => {
  await testAdsbQuerySoftEmpty();
  await testAdsbQueryMergesFiAircraft();
  console.log('mapFunMode tests ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
