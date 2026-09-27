/**
 * Seeded overlay for `?vortexDemo=1` — Cairo mass, a desert black hole,
 * and one Manshiyat Naser cleanup square. No network.
 */
import {
  squareRing,
  type VortexHeatCell,
  type VortexSector,
} from './garbaVortex';

export const VORTEX_DEMO_SECTOR_MISSION_ID = '00000000-0000-4000-8000-0000000000e1';

export function demoVortexCells(): VortexHeatCell[] {
  const cairo: Array<[number, number, number, number]> = [
    [31.2357, 30.0444, 11.2, 40],
    [31.242, 30.05, 9.4, 22],
    [31.228, 30.038, 10.1, 18],
    [31.25, 30.056, 8.2, 14],
    [31.22, 30.03, 7.4, 9],
    [31.26, 30.062, 6.5, 7],
  ];
  const cells: VortexHeatCell[] = cairo.map(([lng, lat, weight, severity], i) => ({
    lng,
    lat,
    weight,
    pointCount: 12 + i * 3,
    maxSeverity: severity,
    isolated: false,
    blackHole: false,
  }));
  cells.push({
    lng: 26.4,
    lat: 27.6,
    weight: 10.5,
    pointCount: 1,
    maxSeverity: 46,
    isolated: true,
    blackHole: true,
  });
  return cells;
}

export function demoVortexSectors(): VortexSector[] {
  const lng = 31.2755;
  const lat = 30.0365;
  return [
    {
      id: 'demo-manshiyat',
      status: 'cleanup',
      pinCount: 6,
      severitySum: 18,
      missionId: VORTEX_DEMO_SECTOR_MISSION_ID,
      centerLng: lng,
      centerLat: lat,
      ring: squareRing(lng, lat, 100),
    },
  ];
}
