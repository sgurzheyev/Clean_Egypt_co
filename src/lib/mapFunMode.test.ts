/**
 * Regression checks for fun-map solar/traffic helpers.
 * Run: npx tsx src/lib/mapFunMode.test.ts
 */
import { resolveMapboxLightPreset } from './mapboxStandardTheme.ts';
import {
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
  entitiesToGeoJSON,
  liveTrafficCap,
  padAndClampBbox,
  trafficTooltipLabel,
  type LiveTrafficEntity,
} from './mapLiveTraffic.ts';
import { parseOpenSkyStates, parseAdsbNearby } from './openskyFlights.ts';
import {
  buildAisstreamSubscribeMessage,
  createAisShipTracker,
  parseAisstreamMessage,
} from './aisShips.ts';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function testFunPalette() {
  assert(FUN_NEON_CYAN === '#22d3ee', 'cyan palette');
  assert(FUN_NEON_VIOLET === '#8b5cf6', 'violet palette');
  assert(MAPBOX_STANDARD_FUN_LAND_COLORS.colorRoads === FUN_NEON_CYAN, 'fun roads cyan');
  assert(MAPBOX_STANDARD_FUN_LAND_COLORS.colorMotorways === FUN_NEON_VIOLET, 'fun motorways violet');
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

  const sub = JSON.parse(
    buildAisstreamSubscribeMessage('k', { lamin: 27, lomin: 33, lamax: 28, lomax: 34 })
  );
  assert(sub.APIKey === 'k', 'subscribe key');
  assert(sub.FilterMessageTypes[0] === 'PositionReport', 'position only');
  assert(sub.BoundingBoxes[0][0][0] === 27, 'lat first in AIS bbox');

  const tracker = createAisShipTracker();
  tracker.upsert(msg!, 1_000);
  assert(tracker.size() === 1, 'upsert');
  tracker.prune(1_000 + 100_000);
  assert(tracker.size() === 0, 'stale prune');
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
  assert(
    trafficTooltipLabel(capped[0]).includes('ft') || trafficTooltipLabel(capped[0]).includes('ground'),
    'tooltip has alt'
  );
  assert(!JSON.stringify(gj).includes('€'), 'no price glyphs');
  assert(!JSON.stringify(gj).toLowerCase().includes('/mo'), 'no rent HUD');
}

testFunPalette();
testTwilightCurve();
testBboxCaps();
testOpenSkyParse();
testAisParseAndTracker();
testGeoJsonAndCaps();
console.log('mapFunMode tests ok');
