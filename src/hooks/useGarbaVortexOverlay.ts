import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchVortexHeatmap, fetchVortexSectors, vortexFetchUnavailable } from '../lib/garbaVortexApi';
import { demoVortexCells, demoVortexSectors } from '../lib/garbaVortexDemo';
import {
  bboxFromView,
  blackHoleVisualMode,
  cellsToBlackHoles,
  cellsToHeatmap,
  emptyVortexCollection,
  heatmapOpacityForZoom,
  pinFadeForZoom,
  readVortexDemoCamera,
  sectorFillOpacityForZoom,
  sectorsToGeoJSON,
  type VortexFeatureCollection,
  type VortexSector,
} from '../lib/garbaVortex';

type OverlayState = {
  ready: boolean;
  sectors: VortexSector[];
  heatmap: VortexFeatureCollection;
  blackHoles: VortexFeatureCollection;
};

const IDLE: OverlayState = {
  ready: false,
  sectors: [],
  heatmap: emptyVortexCollection(),
  blackHoles: emptyVortexCollection(),
};

export function useGarbaVortexOverlay(input: {
  mapReady: boolean;
  cameraBusy: boolean;
  latitude: number;
  longitude: number;
  zoom: number;
  includeReports: boolean;
}) {
  const demo = useMemo(() => readVortexDemoCamera(), []);
  const viewRef = useRef(input);
  viewRef.current = input;

  const viewKey =
    Math.round(input.latitude * 20) * 1_000_000 +
    Math.round(input.longitude * 20) * 100 +
    Math.round(input.zoom * 4);

  const [state, setState] = useState<OverlayState>(() => {
    if (!demo) return IDLE;
    const cells = demoVortexCells();
    const sectors = demoVortexSectors();
    const center = { lng: demo.longitude, lat: demo.latitude };
    return {
      ready: true,
      sectors,
      heatmap: cellsToHeatmap(cells),
      blackHoles: cellsToBlackHoles(cells, center),
    };
  });

  useEffect(() => {
    if (demo || !input.mapReady || input.cameraBusy) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const view = viewRef.current;
      const bbox = bboxFromView(view.latitude, view.longitude, view.zoom);
      void (async () => {
        const [sectorsResult, heatResult] = await Promise.all([
          fetchVortexSectors(bbox),
          view.zoom <= 12.5
            ? fetchVortexHeatmap(bbox, view.zoom, view.includeReports)
            : Promise.resolve(null),
        ]);
        if (cancelled) return;
        const sectorsMissing = vortexFetchUnavailable(sectorsResult);
        const heatMissing = vortexFetchUnavailable(heatResult);
        if (sectorsMissing || heatMissing) {
          setState((prev) => ({ ...prev, ready: false }));
          return;
        }
        if (!sectorsResult.ok) return;
        const center = { lng: view.longitude, lat: view.latitude };
        setState((prev) => {
          const cells = heatResult && heatResult.ok ? heatResult.rows : null;
          return {
            ready: true,
            sectors: sectorsResult.rows,
            heatmap: cells ? cellsToHeatmap(cells) : prev.heatmap,
            blackHoles: cells ? cellsToBlackHoles(cells, center) : prev.blackHoles,
          };
        });
      })();
    }, 380);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [demo, input.mapReady, input.cameraBusy, input.includeReports, viewKey]);

  const zoom = input.zoom;
  const sectorGeoJSON = useMemo(() => sectorsToGeoJSON(state.sectors), [state.sectors]);
  return {
    ready: state.ready,
    sectors: state.sectors,
    heatmap: state.heatmap,
    blackHoles: state.blackHoles,
    pinFade: pinFadeForZoom(zoom, state.ready),
    heatmapOpacity: state.ready ? heatmapOpacityForZoom(zoom) : 0,
    sectorOpacity: state.ready ? sectorFillOpacityForZoom(zoom) : 0,
    sectorGeoJSON,
    blackHoleMode: blackHoleVisualMode(),
    demo: !!demo,
  };
}
