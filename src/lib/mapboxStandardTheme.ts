/**
 * Mapbox Standard (v3) — monochrome night basemap for cyberpunk / dark-steel UI.
 * Shared by MapPicker, StoreCoverageMap, and other embedded maps.
 */

export const MAPBOX_STANDARD_STYLE = 'mapbox://styles/mapbox/standard' as const;

/** Dark steel & silver noir overrides + 3D / cleanliness toggles. */
export const MAPBOX_STANDARD_BASEMAP_CONFIG = {
  theme: 'monochrome',
  lightPreset: 'night',
  colorLand: '#0a0a0a',
  colorWater: '#1a1f24',
  colorGreenspace: '#111416',
  colorBuildings: '#2a2e33',
  colorMotorways: '#c0c5cc',
  colorTrunks: '#a8aeb6',
  colorRoads: '#8a9099',
  colorPlaceLabels: '#e0e4e8',
  colorRoadLabels: '#b8bec6',
  show3dObjects: true,
  show3dBuildings: true,
  show3dTrees: true,
  show3dLandmarks: true,
  show3dFacades: true,
  showPointOfInterestLabels: false,
  showTransitLabels: false,
  showPedestrianRoads: true,
} as const;

export type MapboxConfigCapable = {
  setConfigProperty?: (importId: string, property: string, value: unknown) => void;
};

/** Apply steel-noir Standard basemap config (idempotent; safe to call on every load). */
export function applyMapboxStandardBasemapConfig(map: MapboxConfigCapable | null | undefined): void {
  if (!map?.setConfigProperty) return;
  for (const [key, value] of Object.entries(MAPBOX_STANDARD_BASEMAP_CONFIG)) {
    try {
      map.setConfigProperty('basemap', key, value);
    } catch {
      /* Older GL builds may not expose every config key yet. */
    }
  }
}

/**
 * Style object that imports Standard with config baked in — avoids a light-theme flash
 * before setConfigProperty runs. Custom overlay sources/layers can still be added on load.
 */
export const MAPBOX_STANDARD_STYLE_WITH_CONFIG = {
  version: 8 as const,
  imports: [
    {
      id: 'basemap',
      url: MAPBOX_STANDARD_STYLE,
      config: { ...MAPBOX_STANDARD_BASEMAP_CONFIG },
    },
  ],
  sources: {},
  layers: [],
};
