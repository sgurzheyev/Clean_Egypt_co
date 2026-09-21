/**
 * Live OpenSky / AISStream traffic for the Mapbox viewport.
 * Polls only while enabled + tab visible + map ready. Ships require an AISStream key.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  bboxFromMapBounds,
  emptyTrafficGeoJSON,
  entitiesToGeoJSON,
  OPENSKY_POLL_MS,
  type GeoBbox,
  type TrafficGeoJSON,
} from '../lib/mapLiveTraffic';
import { fetchViewportFlights, type FlightFetchMeta } from '../lib/openskyFlights';
import {
  AISSTREAM_WS_URL,
  buildAisstreamSubscribeMessage,
  createAisShipTracker,
  parseAisstreamMessage,
} from '../lib/aisShips';
import { hasAisstreamApiKey, readAisstreamApiKey } from '../lib/mapFunMode';

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
  enabled: boolean;
  map: MapLike | null;
  cameraBusy?: boolean;
  bboxNonce?: number;
};

export type UseMapLiveTrafficResult = {
  flightsGeoJSON: TrafficGeoJSON;
  shipsGeoJSON: TrafficGeoJSON;
  flightMeta: FlightFetchMeta;
  shipsEnabled: boolean;
  shipsHint: 'need-key' | 'live' | 'off';
};

export function useMapLiveTraffic(opts: UseMapLiveTrafficOptions): UseMapLiveTrafficResult {
  const { enabled, map, cameraBusy = false, bboxNonce = 0 } = opts;
  const [flightsGeoJSON, setFlightsGeoJSON] = useState<TrafficGeoJSON>(emptyTrafficGeoJSON);
  const [shipsGeoJSON, setShipsGeoJSON] = useState<TrafficGeoJSON>(emptyTrafficGeoJSON);
  const [flightMeta, setFlightMeta] = useState<FlightFetchMeta>({
    source: 'none',
    error: null,
  });
  const shipsEnabled = hasAisstreamApiKey();

  const abortRef = useRef<AbortController | null>(null);
  const bboxRef = useRef<GeoBbox | null>(null);
  const zoomRef = useRef(10);
  const trackerRef = useRef(createAisShipTracker());
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
    setShipsGeoJSON(entitiesToGeoJSON(trackerRef.current.list(zoomRef.current)));
  }, []);

  const scheduleShipsPaint = useCallback(() => {
    if (shipsPaintRef.current) return;
    shipsPaintRef.current = setTimeout(() => {
      shipsPaintRef.current = null;
      paintShips();
    }, 400);
  }, [paintShips]);

  useEffect(() => {
    if (!enabled || !shipsEnabled || typeof window === 'undefined') {
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
      trackerRef.current.clear();
      setShipsGeoJSON(emptyTrafficGeoJSON());
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
    };
  }, [enabled, shipsEnabled, readViewport, paintShips, scheduleShipsPaint]);

  useEffect(() => {
    if (!enabled || !shipsEnabled) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const vp = readViewport();
    if (!vp) return;
    try {
      ws.send(buildAisstreamSubscribeMessage(readAisstreamApiKey(), vp.bbox));
    } catch {
      /* ignore */
    }
  }, [bboxNonce, enabled, shipsEnabled, readViewport]);

  useEffect(() => {
    if (!enabled) {
      abortRef.current?.abort();
      setFlightsGeoJSON(emptyTrafficGeoJSON());
      setFlightMeta({ source: 'none', error: null });
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

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
        setFlightMeta(meta);
      } catch (err) {
        if (cancelled || ac.signal.aborted) {
          /* next tick */
        } else {
          setFlightMeta({
            source: 'none',
            error: err instanceof Error ? err.message : 'flights unavailable',
          });
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
  }, [enabled, cameraBusy, bboxNonce, readViewport]);

  useEffect(() => {
    return () => {
      if (shipsPaintRef.current) clearTimeout(shipsPaintRef.current);
    };
  }, []);

  return {
    flightsGeoJSON,
    shipsGeoJSON,
    flightMeta,
    shipsEnabled,
    shipsHint: !enabled ? 'off' : shipsEnabled ? 'live' : 'need-key',
  };
}
