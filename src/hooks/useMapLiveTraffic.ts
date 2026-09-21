/**
 * Live OpenSky / AISStream traffic for the Mapbox viewport.
 * Polls only while enabled + tab visible + map ready. Ships require an AISStream key.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  bboxFromMapBounds,
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
import {
  AISSTREAM_WS_URL,
  buildAisstreamSubscribeMessage,
  createAisShipTracker,
  parseAisstreamMessage,
} from '../lib/aisShips';
import { hasAisstreamApiKey, readAisstreamApiKey, type RushCraftMode } from '../lib/mapFunMode';

type MapLike = {
  getBounds?: () => {
    getSouth?: () => number;
    getWest?: () => number;
    getNorth?: () => number;
    getEast?: () => number;
  };
  getZoom?: () => number;
  isStyleLoaded?: () => boolean;
};

export type UseMapLiveTrafficOptions = {
  craft: RushCraftMode;
  map: MapLike | null;
  cameraBusy?: boolean;
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
  shipsEnabled: boolean;
  shipsHint: 'need-key' | 'live' | 'off';
};

export function useMapLiveTraffic(opts: UseMapLiveTrafficOptions): UseMapLiveTrafficResult {
  const { craft, map, cameraBusy = false, bboxNonce = 0 } = opts;
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
  const [flightMeta, setFlightMeta] = useState<FlightFetchMeta>({
    source: 'none',
    error: null,
  });
  const shipsEnabled = hasAisstreamApiKey();

  const abortRef = useRef<AbortController | null>(null);
  const bboxRef = useRef<GeoBbox | null>(null);
  const zoomRef = useRef(10);
  const trackerRef = useRef(createAisShipTracker());
  const flightTrailsRef = useRef(createTrailTracker());
  const shipTrailsRef = useRef(createTrailTracker());
  const wsRef = useRef<WebSocket | null>(null);
  const wsRetryRef = useRef(0);
  const shipsPaintRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const readViewport = useCallback((): { bbox: GeoBbox; zoom: number } | null => {
    if (!map?.getBounds) return null;
    const bbox = bboxFromMapBounds(map.getBounds());
    if (!bbox) return null;
    const zoom = Number(map.getZoom?.() ?? 10);
    zoomRef.current = Number.isFinite(zoom) ? zoom : 10;
    bboxRef.current = bbox;
    return { bbox, zoom: zoomRef.current };
  }, [map]);

  const paintShips = useCallback(() => {
    const list = trackerRef.current.list(zoomRef.current);
    setShipsGeoJSON(entitiesToGeoJSON(list));
    setShipsCount(list.length);
    setShipsTrailsGeoJSON(shipTrailsRef.current.sync(list, 'ship'));
  }, []);

  const scheduleShipsPaint = useCallback(() => {
    if (shipsPaintRef.current) return;
    shipsPaintRef.current = setTimeout(() => {
      shipsPaintRef.current = null;
      paintShips();
    }, 400);
  }, [paintShips]);

  useEffect(() => {
    if (!shipsOn || !shipsEnabled || typeof window === 'undefined') {
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
      trackerRef.current.clear();
      shipTrailsRef.current.clear();
      setShipsGeoJSON(emptyTrafficGeoJSON());
      setShipsTrailsGeoJSON(emptyTrailGeoJSON());
      setShipsCount(0);
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (cancelled || document.visibilityState === 'hidden') return;
      const apiKey = readAisstreamApiKey();
      if (!apiKey) return;
      const vp = readViewport();
      if (!vp) {
        retryTimer = setTimeout(connect, 1500);
        return;
      }

      let ws: WebSocket;
      try {
        ws = new WebSocket(AISSTREAM_WS_URL);
      } catch (e) {
        console.warn('[aisstream] websocket unavailable', e);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        wsRetryRef.current = 0;
        try {
          ws.send(buildAisstreamSubscribeMessage(apiKey, vp.bbox));
        } catch {
          /* ignore */
        }
      };

      ws.onmessage = (ev) => {
        try {
          const parsed = parseAisstreamMessage(JSON.parse(String(ev.data)));
          if (!parsed) return;
          trackerRef.current.upsert(parsed);
          scheduleShipsPaint();
        } catch {
          /* malformed frame */
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(5, wsRetryRef.current));
        wsRetryRef.current += 1;
        retryTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
    };

    connect();

    const pruneTimer = window.setInterval(() => {
      trackerRef.current.prune();
      paintShips();
    }, 20_000);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      window.clearInterval(pruneTimer);
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
      trackerRef.current.clear();
      shipTrailsRef.current.clear();
    };
  }, [shipsOn, shipsEnabled, readViewport, paintShips, scheduleShipsPaint]);

  useEffect(() => {
    if (!shipsOn || !shipsEnabled) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const vp = readViewport();
    if (!vp) return;
    try {
      ws.send(buildAisstreamSubscribeMessage(readAisstreamApiKey(), vp.bbox));
    } catch {
      /* ignore */
    }
  }, [bboxNonce, shipsOn, shipsEnabled, readViewport]);

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
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        timer = setTimeout(tick, OPENSKY_POLL_MS);
        return;
      }
      if (cameraBusy) {
        timer = setTimeout(tick, 2500);
        return;
      }
      const vp = readViewport();
      if (!vp) {
        timer = setTimeout(tick, 2000);
        return;
      }
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const { entities, meta } = await fetchViewportFlights(vp.bbox, vp.zoom, ac.signal);
        if (cancelled) return;
        setFlightsGeoJSON(entitiesToGeoJSON(entities));
        setFlightsCount(entities.length);
        setFlightsTrailsGeoJSON(flightTrailsRef.current.sync(entities, 'flight'));
        setFlightMeta(meta);
        setFlightsLoading(false);
      } catch (err) {
        if (cancelled || ac.signal.aborted) {
          /* next tick */
        } else {
          setFlightMeta({
            source: 'none',
            error: err instanceof Error ? err.message : 'flights unavailable',
          });
          setFlightsLoading(false);
        }
      }
      if (!cancelled) timer = setTimeout(tick, OPENSKY_POLL_MS);
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
  }, [flightsOn, cameraBusy, bboxNonce, readViewport]);

  useEffect(() => {
    return () => {
      if (shipsPaintRef.current) clearTimeout(shipsPaintRef.current);
    };
  }, []);

  return {
    flightsGeoJSON,
    shipsGeoJSON,
    flightsTrailsGeoJSON,
    shipsTrailsGeoJSON,
    flightMeta,
    flightsCount,
    shipsCount,
    flightsLoading,
    shipsEnabled,
    shipsHint: !shipsOn ? 'off' : shipsEnabled ? 'live' : 'need-key',
  };
}
