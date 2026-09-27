/**
 * Fun-map palette and solar atmosphere (sunrise/sunset lighting).
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

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function testFunPalette() {
  assert(FUN_NEON_CYAN === '#22d3ee', 'cyan palette');
  assert(FUN_NEON_VIOLET === '#67e8f9', 'fun motorways cyan-forward');
  assert(MAPBOX_STANDARD_FUN_LAND_COLORS.colorRoads === FUN_NEON_CYAN, 'fun roads cyan');
  assert(MAPBOX_STANDARD_FUN_LAND_COLORS.colorMotorways === FUN_NEON_VIOLET, 'fun motorways');
  assert(MAPBOX_STANDARD_FUN_LAND_COLORS.colorLand === '#0a1018', 'h2h dark land');
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

testFunPalette();
testTwilightCurve();
console.log('mapFunMode tests ok');
