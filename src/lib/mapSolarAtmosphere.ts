/**
 * Sun-driven Mapbox fog + sky + lightPreset for GarbaGin.
 * Civil twilight and golden hour use cinematic warm horizon (Egypt / Red Sea local sun).
 * Fun mode only amplifies bloom; the richer dawn/dusk curve is the default.
 */

import {
  resolveMapboxLightPreset,
  type MapboxLightPreset,
} from './mapboxStandardTheme';

export type SolarAtmosphereInput = {
  sunAltDeg: number;
  isMorning: boolean;
  moonFrac: number;
  moonElevDeg: number;
  camZoom: number;
  camPitch: number;
  funMode?: boolean;
};

export type SolarAtmospherePack = {
  isNight: boolean;
  golden: boolean;
  twilight: boolean;
  lightPreset: MapboxLightPreset;
  fogPack: Record<string, unknown>;
  skyAtmosphereColor: string;
  skyHaloColor: string;
  skySunIntensity: number;
  starIntensityExpr: unknown;
  starNightScalar: number;
  nightFogHigh: string;
  nightHorizonBlend: number;
  hillshadeHighlight: string;
  hillshadeAccent: string;
  /** Next atmosphere tick — faster around sunrise/sunset. */
  nextIntervalMs: number;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

/** Mix two #rrggbb colors. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const u = clamp(t, 0, 1);
  const to = (n: number) => n.toString(16).padStart(2, '0');
  return `#${to(Math.round(lerp(pa[0], pb[0], u)))}${to(Math.round(lerp(pa[1], pb[1], u)))}${to(
    Math.round(lerp(pa[2], pb[2], u))
  )}`;
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  if (h.length !== 6) return [0, 0, 0];
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

/** Bell curve peaked at the horizon (sunAlt ≈ 0°). */
export function horizonPeak(sunAltDeg: number): number {
  const x = sunAltDeg / 2.6;
  return Math.exp(-(x * x));
}

/**
 * Warmth envelope: civil twilight (−8°) through late golden hour (~14°).
 * 0 outside, 1 at the horizon.
 */
export function twilightWarmth(sunAltDeg: number): number {
  if (sunAltDeg <= -8 || sunAltDeg >= 16) return 0;
  if (sunAltDeg < 0) return (sunAltDeg + 8) / 8;
  return 1 - sunAltDeg / 16;
}

export function isTwilightSun(sunAltDeg: number): boolean {
  return sunAltDeg >= -8 && sunAltDeg <= 14;
}

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${clamp(a, 0, 1).toFixed(3)})`;
}

export function buildSolarAtmosphere(input: SolarAtmosphereInput): SolarAtmospherePack {
  const sunAltDeg = input.sunAltDeg;
  const isMorning = input.isMorning;
  const fun = input.funMode === true;
  const isNight = sunAltDeg < -6;
  const golden = sunAltDeg >= -6 && sunAltDeg <= 10;
  const twilight = isTwilightSun(sunAltDeg);
  const warmth = twilightWarmth(sunAltDeg);
  const peak = horizonPeak(sunAltDeg);
  const bloom = fun ? 1.28 : 1;

  const moonFrac = clamp(input.moonFrac, 0, 1);
  const moonElevDeg = input.moonElevDeg;
  const moonAboveHorizon = moonElevDeg > 0.5;
  const camZoom = input.camZoom;
  const camPitch = input.camPitch;

  const moonGlowMix = isNight
    ? clamp(moonFrac * clamp((moonElevDeg + 8) / 52, 0, 1), 0, 1)
    : 0;
  const nightFogHigh =
    moonGlowMix > 0.12 ? '#101c32' : moonGlowMix > 0.04 ? '#081018' : '#020617';
  const nightHorizonBlend = Math.min(0.028, 0.01 + moonGlowMix * 0.018);

  const moonElevWash = moonAboveHorizon ? Math.pow(Math.min(1, moonElevDeg / 56), 1.12) : 0;
  const moonWashStars = moonFrac * (0.12 + moonElevWash * 0.88);
  const phaseStarBoost = (1 - moonFrac) * 0.18;
  const pitchStarBoost = Math.min(0.14, Math.max(0, camPitch - 26) * 0.0022);
  const starNightScalar = clamp(
    0.98 - moonWashStars * 0.45 + phaseStarBoost + pitchStarBoost,
    0.6,
    1
  );

  const starIntensityExpr = [
    'interpolate',
    ['linear'],
    ['zoom'],
    2,
    Math.min(1, starNightScalar * 1.14),
    6,
    Math.min(1, starNightScalar * 1.08),
    10,
    starNightScalar,
    14,
    Math.max(0.6, starNightScalar * 0.96),
    18,
    Math.max(0.6, starNightScalar * 0.88),
  ];

  const moonSkyDiscIntensity = clamp(4.5 + moonFrac * 5.5, 4, 10);
  let nightSkyIntensity = moonAboveHorizon
    ? moonSkyDiscIntensity * (0.55 + 0.45 * Math.min(1, moonElevDeg / 60))
    : Math.max(2, moonFrac * 4);
  if (isNight && moonAboveHorizon && starNightScalar >= 0.88 && moonWashStars < 0.35) {
    nightSkyIntensity *= 0.9;
  }

  const lightPreset = resolveMapboxLightPreset({
    isNight,
    golden,
    isMorning,
    sunAltDeg,
  });

  let fogPack: Record<string, unknown>;
  let skyAtmosphereColor: string;
  let skyHaloColor: string;
  let skySunIntensity: number;
  let hillshadeHighlight: string;
  let hillshadeAccent: string;

  if (isNight) {
    fogPack = {
      range: [0.8, 8],
      color: '#020617',
      'high-color': nightFogHigh,
      'horizon-blend': nightHorizonBlend,
      'space-color': '#020617',
      'star-intensity': starIntensityExpr,
    };
    skyAtmosphereColor = '#020617';
    const haloA = clamp(0.16 + moonFrac * 0.44, 0.12, 0.58);
    skyHaloColor = rgba(224, 248, 255, haloA);
    skySunIntensity = nightSkyIntensity;
    const t = moonGlowMix;
    hillshadeHighlight =
      t > 0.03
        ? `rgb(${Math.round(30 + (220 - 30) * t)}, ${Math.round(41 + (245 - 41) * t)}, ${Math.round(59 + (255 - 59) * t)})`
        : '#1e293b';
    hillshadeAccent =
      t > 0.08
        ? `rgb(${Math.round(8 + 18 * t)}, ${Math.round(47 + 60 * t)}, ${Math.round(73 + 100 * t)})`
        : '#022c22';
  } else if (twilight || golden) {
    const morning = isMorning;
    const ground = morning ? '#161018' : '#141018';
    const spaceDeep = morning ? '#1a0a14' : '#120610';
    const spaceHot = morning ? '#3a1424' : '#2a0814';
    const highCool = morning ? '#6b2a4a' : '#5c2038';
    const highWarm = morning ? '#ff8a62' : '#ff6a3c';
    const highGold = morning ? '#ffd0a0' : '#ffb070';
    const high = mixHex(mixHex(highCool, highWarm, warmth), highGold, peak * 0.85);

    const horizonBlend = clamp(
      (0.14 + warmth * 0.1 + peak * 0.16) * bloom,
      0.12,
      fun ? 0.36 : 0.3
    );

    fogPack = {
      range: [0.7, fun ? 7.2 : 8],
      color: ground,
      'high-color': high,
      'horizon-blend': horizonBlend,
      'space-color': mixHex(spaceDeep, spaceHot, warmth * 0.7 + peak * 0.3),
      'star-intensity': sunAltDeg < 0 ? 0.38 : sunAltDeg < 4 ? 0.16 : 0.08,
    };

    skyAtmosphereColor = morning
      ? mixHex('#2a1420', '#4a2030', warmth)
      : mixHex('#2a1018', '#4a1818', warmth);

    const haloA = clamp((0.48 + peak * 0.38 + warmth * 0.12) * bloom, 0.4, 0.92);
    skyHaloColor = morning ? rgba(255, 186, 150, haloA) : rgba(255, 150, 78, haloA);

    skySunIntensity = clamp(
      (6 + Math.max(0, sunAltDeg) * 0.45 + peak * 4) * (fun ? 1.12 : 1),
      5,
      16
    );

    hillshadeHighlight = mixHex('#3a2824', '#8a5a40', warmth * 0.7 + peak * 0.3);
    hillshadeAccent = mixHex('#022c22', '#4a2018', warmth);
  } else {
    const afternoonLift = sunAltDeg < 28 ? clamp((28 - sunAltDeg) / 18, 0, 1) : 0;
    fogPack = {
      range: [0.8, 8],
      color: '#0b0e14',
      'high-color': mixHex('#1e3a5f', '#4a6a8a', afternoonLift * 0.45),
      'horizon-blend': 0.1 + afternoonLift * 0.04,
      'space-color': '#0f172a',
      'star-intensity': 0.08,
    };
    skyAtmosphereColor = mixHex('#152238', '#2a3a58', afternoonLift * 0.35);
    skyHaloColor = rgba(255, 220, 180, 0.4 + afternoonLift * 0.12);
    skySunIntensity = clamp(5 + (Math.max(0, sunAltDeg) / 45) * 9, 5, 14);
    hillshadeHighlight = '#334155';
    hillshadeAccent = '#022c22';
  }

  void camZoom;

  return {
    isNight,
    golden,
    twilight,
    lightPreset,
    fogPack,
    skyAtmosphereColor,
    skyHaloColor,
    skySunIntensity,
    starIntensityExpr,
    starNightScalar,
    nightFogHigh,
    nightHorizonBlend,
    hillshadeHighlight,
    hillshadeAccent,
    nextIntervalMs: twilight ? 20_000 : 60_000,
  };
}

/** Sample zoom curve when runtime rejects star-intensity expressions. */
export function starIntensitySampleAtZoom(z: number, s: number): number {
  const tLo = Math.min(1, s * 1.14);
  const tMid = s;
  const tHi = Math.max(0.6, s * 0.87);
  if (z <= 2) return tLo;
  if (z >= 17.5) return tHi;
  if (z <= 9.5) {
    const u = (z - 2) / (9.5 - 2);
    return tLo + u * (tMid - tLo);
  }
  const u = (z - 9.5) / (17.5 - 9.5);
  return tMid + u * (tHi - tMid);
}
