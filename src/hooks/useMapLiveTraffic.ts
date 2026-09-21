/**
 * Live OpenSky / AISStream traffic for the Mapbox viewport.
 * Polls same-origin `/api/*` while enabled + tab visible. AISStream is
 * server-proxied (`/api/ais-nearby`) because browsers cannot open that WS.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  bboxFromCamera,
  createTrailTracker,
  emptyTrafficGeoJSON,
  emptyTrailGeoJSON,
  entitiesToGeoJSON,
  OPENSKY_POLL_MS,
  type GeoBbox,
  type TrafficGeoJSON,
  type TrafficTrailGeoJSON,
} from '../lib/mapLiveTraffic';
import { fetchViewportFlights, type FlightFetchMeta } from '../lib/openskyFlights';
import { AIS_POLL_MS, fetchViewportShips, type ShipFetchMeta } from '../lib/aisShips';
import { type RushCraftMode } from '../lib/mapFunMode';

type MapLike = {
  getBounds?: () => {
    getSouth?: () => number;
    getWest?: () => number;
    getNorth?: () => number;
    getEast?: () => number;
  };
  getCenter?: () => { lat?: number; lng?: number };
  getZoom?: () => number;
  isStyleLoaded?: () => boolean;
};

export type LiveTrafficFallbackView = {
  lat: number;
  lng: number;
  zoom: number;
};

export type UseMapLiveTrafficOptions = {
  craft: RushCraftMode;
  getMap?: () => MapLike | null | undefined;
  cameraBusyRef?: { current: boolean };
  fallbackView?: LiveTrafficFallbackView | null;
  /** Ignored for fetch; viewport is re-read each poll tick. Kept so callers can pass it. */
  bboxNonce?: number;
};

export type UseMapLiveTrafficResult = {
  flightsGeoJSON: TrafficGeoJSON;
  shipsGeoJSON: TrafficGeoJSON;
  flightsTrailsGeoJSON: TrafficTrailGeoJSON;
  shipsTrailsGeoJSON: TrafficTrailGeoJSON;
  flightMeta: FlightFetchMeta;
  flightsCount: number;
  shipsCount: number;
  flightsLoading: boolean;
  shipsLoading: boolean;
  shipsEnabled: boolean;
  shipsHint: 'need-key' | 'live' | 'off' | 'ws';
  shipMeta: ShipFetchMeta;
};

export function useMapLiveTraffic(opts: UseMapLiveTrafficOptions): UseMapLiveTrafficResult {
  const { craft, getMap, cameraBusyRef, fallbackView = null } = opts;
  const flightsOn = craft === 'planes';
  const shipsOn = craft === 'ships';
  const [flightsGeoJSON, setFlightsGeoJSON] = useState<TrafficGeoJSON>(emptyTrafficGeoJSON);
  const [shipsGeoJSON, setShipsGeoJSON] = useState<TrafficGeoJSON>(emptyTrafficGeoJSON);
  const [flightsTrailsGeoJSON, setFlightsTrailsGeoJSON] =
    useState<TrafficTrailGeoJSON>(emptyTrailGeoJSON);
  const [shipsTrailsGeoJSON, setShipsTrailsGeoJSON] =
    useState<TrafficTrailGeoJSON>(emptyTrailGeoJSON);
  const [flightsCount, setFlightsCount] = useState(0);
  const [shipsCount, setShipsCount] = useState(0);
  const [flightsLoading, setFlightsLoading] = useState(false);
  const [shipsLoading, setShipsLoading] = useState(false);
  const [flightMeta, setFlightMeta] = useState<FlightFetchMeta>({
    source: 'none',
    error: null,
  });
  const [shipMeta, setShipMeta] = useState<ShipFetchMeta>({
    source: 'none',
    error: null,
  });

  const abortRef = useRef<AbortController | null>(null);
  const shipsAbortRef = useRef<AbortController | null>(null);
  const zoomRef = useRef(10);
  const flightTrailsRef = useRef(createTrailTracker());
  const shipTrailsRef = useRef(createTrailTracker());
  const getMapRef = useRef(getMap);
  getMapRef.current = getMap;
  const fallbackViewRef = useRef(fallbackView);
  fallbackViewRef.current = fallbackView;
  const cameraBusyNow = useRef(cameraBusyRef);
  cameraBusyNow.current = cameraBusyRef;

  const readViewport = useCallback((): { bbox: GeoBbox; zoom: number } | null => {
    const fb = fallbackViewRef.current;
    let lat = fb?.lat;
    let lng = fb?.lng;
    let zoom = fb?.zoom ?? 10;
    let bounds: ReturnType<NonNullable<MapLike['getBounds']>> | undefined;
    try {
      const map = getMapRef.current?.() ?? null;
      const center = map?.getCenter?.();
      const cLat = Number(center?.lat);
      const cLng = Number(center?.lng);
      if (Number.isFinite(cLat) && Number.isFinite(cLng)) {
        lat = cLat;
        lng = cLng;
      }
      const z = Number(map?.getZoom?.());
      if (Number.isFinite(z)) zoom = z;
      try {
        bounds = map?.getBounds?.();
      } catch {
        bounds = undefined;
      }
    } catch {
      /* map may be mid-rebuild */
    }
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }
    const bbox = bboxFromCamera({ lat, lng, zoom, bounds });
    if (!bbox) return null;
    zoomRef.current = Number.isFinite(zoom) ? zoom : 10;
    return { bbox, zoom: zoomRef.current };
  }, []);

  useEffect(() => {
    if (!shipsOn) {
      shipsAbortRef.current?.abort();
      shipTrailsRef.current.clear();
      setShipsGeoJSON(emptyTrafficGeoJSON());
      setShipsTrailsGeoJSON(emptyTrailGeoJSON());
      setShipsCount(0);
      setShipsLoading(false);
      setShipMeta({ source: 'none', error: null });
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setShipsLoading(true);

    const tick = async () => {
      if (cancelled) return;
      let delay = AIS_POLL_MS;
      try {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          delay = AIS_POLL_MS;
        } else if (cameraBusyNow.current?.current) {
          delay = 1500;
        } else {
          const vp = readViewport();
          if (!vp) {
            delay = 1500;
          } else {
            shipsAbortRef.current?.abort();
            const ac = new AbortController();
            shipsAbortRef.current = ac;
            try {
              const { entities, meta } = await fetchViewportShips(vp.bbox, vp.zoom, ac.signal);
              if (!cancelled && !ac.signal.aborted) {
                setShipsGeoJSON(entitiesToGeoJSON(entities));
                setShipsCount(entities.length);
                setShipsTrailsGeoJSON(shipTrailsRef.current.sync(entities, 'ship'));
                setShipMeta(meta);
                setShipsLoading(false);
              }
            } catch (err) {
              if (!cancelled && !ac.signal.aborted) {
                setShipMeta({
                  source: 'none',
                  error: err instanceof Error ? err.message : 'ws',
                });
                setShipsLoading(false);
              }
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setShipMeta({
            source: 'none',
            error: err instanceof Error ? err.message : 'ws',
          });
          setShipsLoading(false);
        }
        delay = 1500;
      }
      if (!cancelled) timer = setTimeout(tick, delay);
    };

    void tick();
    const onVis = () => {
      if (document.visibilityState === 'visible') void tick();
      else shipsAbortRef.current?.abort();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      shipsAbortRef.current?.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [shipsOn, readViewport]);

  useEffect(() => {
    if (!flightsOn) {
      abortRef.current?.abort();
      flightTrailsRef.current.clear();
      setFlightsGeoJSON(emptyTrafficGeoJSON());
      setFlightsTrailsGeoJSON(emptyTrailGeoJSON());
      setFlightsCount(0);
      setFlightsLoading(false);
      setFlightMeta({ source: 'none', error: null });
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setFlightsLoading(true);

    const tick = async () => {
      if (cancelled) return;
      let delay = OPENSKY_POLL_MS;
      try {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          delay = OPENSKY_POLL_MS;
        } else if (cameraBusyNow.current?.current) {
          delay = 1500;
        } else {
          const vp = readViewport();
          if (!vp) {
            delay = 1500;
          } else {
            abortRef.current?.abort();
            const ac = new AbortController();
            abortRef.current = ac;
            try {
              const { entities, meta } = await fetchViewportFlights(vp.bbox, vp.zoom, ac.signal);
              if (!cancelled && !ac.signal.aborted) {
                setFlightsGeoJSON(entitiesToGeoJSON(entities));
                setFlightsCount(entities.length);
                setFlightsTrailsGeoJSON(flightTrailsRef.current.sync(entities, 'flight'));
                setFlightMeta(meta);
                setFlightsLoading(false);
              }
            } catch (err) {
              if (!cancelled && !ac.signal.aborted) {
                setFlightMeta({
                  source: 'none',
                  error: err instanceof Error ? err.message : 'flights unavailable',
                });
                setFlightsLoading(false);
              }
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setFlightMeta({
            source: 'none',
            error: err instanceof Error ? err.message : 'flights unavailable',
          });
          setFlightsLoading(false);
        }
        delay = 1500;
      }
      if (!cancelled) timer = setTimeout(tick, delay);
    };

    void tick();
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        void tick();
      } else {
        abortRef.current?.abort();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      abortRef.current?.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [flightsOn, readViewport]);

  const shipsHint: UseMapLiveTrafficResult['shipsHint'] = !shipsOn
    ? 'off'
    : shipMeta.error && /need-key|no key|missing/i.test(shipMeta.error)
      ? 'need-key'
      : shipMeta.error && shipMeta.error !== 'empty' && /ws|socket|401/i.test(shipMeta.error)
        ? 'ws'
        : 'live';

  return {
    flightsGeoJSON,
    shipsGeoJSON,
    flightsTrailsGeoJSON,
    shipsTrailsGeoJSON,
    flightMeta,
    shipMeta,
    flightsCount,
    shipsCount,
    flightsLoading,
    shipsLoading,
    shipsEnabled: shipsOn,
    shipsHint,
  };
}
