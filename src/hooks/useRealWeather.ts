/**
 * Debounced live weather from Open-Meteo for the map center (no API key).
 */
import { useEffect, useRef, useState } from 'react';
import type { MapWeatherMode } from '../lib/mapWeather';
import {
  fetchOpenMeteoCurrent,
  type OpenMeteoCurrentWeather,
} from '../lib/openMeteoWeather';

export type UseRealWeatherOptions = {
  /** When false, hook stays idle (manual debug override). */
  enabled: boolean;
  latitude: number | null;
  longitude: number | null;
  /** Debounce after center changes (map idle). Default 1000ms. */
  debounceMs?: number;
};

export type UseRealWeatherResult = {
  mode: MapWeatherMode;
  loading: boolean;
  error: string | null;
  current: OpenMeteoCurrentWeather | null;
  lastFetchedAt: number | null;
};

export function useRealWeather(opts: UseRealWeatherOptions): UseRealWeatherResult {
  const { enabled, latitude, longitude, debounceMs = 1000 } = opts;
  const [mode, setMode] = useState<MapWeatherMode>('clear');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<OpenMeteoCurrentWeather | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled) {
      abortRef.current?.abort();
      setLoading(false);
      return;
    }

    if (
      latitude == null ||
      longitude == null ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      setError(null);

      void (async () => {
        try {
          const result = await fetchOpenMeteoCurrent(latitude, longitude, ac.signal);
          if (ac.signal.aborted) return;
          setMode(result.mode);
          setCurrent(result.current);
          setLastFetchedAt(Date.now());
        } catch (e: any) {
          if (ac.signal.aborted || e?.name === 'AbortError') return;
          console.error('[useRealWeather]', e);
          setError(e?.message || 'Weather fetch failed');
        } finally {
          if (!ac.signal.aborted) setLoading(false);
        }
      })();
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [enabled, latitude, longitude, debounceMs]);

  return { mode, loading, error, current, lastFetchedAt };
}
