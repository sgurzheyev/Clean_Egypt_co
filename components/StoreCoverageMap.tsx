/**
 * Lightweight Mapbox coverage editor — office pin + click-to-draw polygon.
 * No @mapbox/mapbox-gl-draw dependency: vertices are added by map click.
 */
import React, { useCallback, useMemo, useState } from 'react';
import MapGL, { Layer, Marker, Source, type MapLayerMouseEvent } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MapPin, Pentagon, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  polygonFromRing,
  type GeoJsonPosition,
  type ServiceRadiusPolygon,
} from '../src/lib/contractorStore';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

type Mode = 'office' | 'draw' | 'idle';

export type StoreCoverageMapProps = {
  officeLat: number | null;
  officeLng: number | null;
  polygon: ServiceRadiusPolygon | null;
  onOfficeChange: (lat: number, lng: number) => void;
  onPolygonChange: (polygon: ServiceRadiusPolygon | null) => void;
  /** Compact height for profile accordion. */
  heightClassName?: string;
  interactive?: boolean;
};

const StoreCoverageMap: React.FC<StoreCoverageMapProps> = ({
  officeLat,
  officeLng,
  polygon,
  onOfficeChange,
  onPolygonChange,
  heightClassName = 'h-56',
  interactive = true,
}) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('idle');
  const [draftRing, setDraftRing] = useState<GeoJsonPosition[]>([]);

  const initialView = useMemo(() => {
    if (
      typeof officeLat === 'number' &&
      typeof officeLng === 'number' &&
      Number.isFinite(officeLat) &&
      Number.isFinite(officeLng)
    ) {
      return { latitude: officeLat, longitude: officeLng, zoom: 12 };
    }
    if (polygon?.coordinates?.[0]?.[0]) {
      const [lng, lat] = polygon.coordinates[0][0];
      return { latitude: lat, longitude: lng, zoom: 11 };
    }
    return { latitude: 30.0444, longitude: 31.2357, zoom: 10 };
  }, [officeLat, officeLng, polygon]);

  const [viewState, setViewState] = useState(initialView);

  const previewGeoJson = useMemo(() => {
    const ring = draftRing.length >= 2 ? draftRing : null;
    const poly =
      ring && ring.length >= 3
        ? polygonFromRing(ring)
        : polygon && draftRing.length === 0
          ? polygon
          : ring
            ? null
            : polygon;
    if (!poly) {
      // Line preview while drawing (< 3 points).
      if (draftRing.length >= 2) {
        return {
          type: 'FeatureCollection' as const,
          features: [
            {
              type: 'Feature' as const,
              properties: {},
              geometry: { type: 'LineString' as const, coordinates: draftRing },
            },
          ],
        };
      }
      return { type: 'FeatureCollection' as const, features: [] };
    }
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: {},
          geometry: poly,
        },
      ],
    };
  }, [draftRing, polygon]);

  const handleClick = useCallback(
    (e: MapLayerMouseEvent) => {
      if (!interactive) return;
      const { lng, lat } = e.lngLat;
      if (mode === 'office') {
        onOfficeChange(lat, lng);
        setMode('idle');
        return;
      }
      if (mode === 'draw') {
        setDraftRing((prev) => [...prev, [lng, lat]]);
      }
    },
    [interactive, mode, onOfficeChange]
  );

  const closePolygon = () => {
    const next = polygonFromRing(draftRing);
    if (next) {
      onPolygonChange(next);
      setDraftRing([]);
      setMode('idle');
    }
  };

  const clearPolygon = () => {
    setDraftRing([]);
    onPolygonChange(null);
    setMode('idle');
  };

  if (!MAPBOX_TOKEN) {
    return (
      <div
        className={`flex ${heightClassName} items-center justify-center rounded-xl border border-dashed border-white/15 bg-slate-900/60 px-4 text-center text-xs text-slate-400`}
      >
        {t('storeMapTokenMissing', {
          defaultValue: 'Mapbox token missing — cannot edit coverage map.',
        })}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {interactive && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setMode((m) => (m === 'office' ? 'idle' : 'office'));
              setDraftRing([]);
            }}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] transition-colors ${
              mode === 'office'
                ? 'border-cyan-400/60 bg-cyan-500/25 text-cyan-100'
                : 'border-white/15 bg-white/5 text-slate-300 hover:border-cyan-400/40'
            }`}
          >
            <MapPin className="h-3.5 w-3.5" />
            {t('storePinOffice', { defaultValue: 'Pin office' })}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode((m) => (m === 'draw' ? 'idle' : 'draw'));
              if (mode !== 'draw') setDraftRing([]);
            }}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] transition-colors ${
              mode === 'draw'
                ? 'border-emerald-400/60 bg-emerald-500/25 text-emerald-100'
                : 'border-white/15 bg-white/5 text-slate-300 hover:border-emerald-400/40'
            }`}
          >
            <Pentagon className="h-3.5 w-3.5" />
            {t('storeDrawZone', { defaultValue: 'Draw zone' })}
          </button>
          {draftRing.length >= 3 && (
            <button
              type="button"
              onClick={closePolygon}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/50 bg-emerald-500/20 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-100"
            >
              {t('storeClosePolygon', { defaultValue: 'Close polygon' })}
            </button>
          )}
          {(polygon || draftRing.length > 0) && (
            <button
              type="button"
              onClick={clearPolygon}
              className="inline-flex items-center gap-1.5 rounded-full border border-red-400/40 bg-red-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-red-200"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('storeClearZone', { defaultValue: 'Clear zone' })}
            </button>
          )}
        </div>
      )}

      {interactive && mode !== 'idle' && (
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">
          {mode === 'office'
            ? t('storePinOfficeHint', { defaultValue: 'Tap the map to place your office.' })
            : t('storeDrawZoneHint', {
                defaultValue: 'Tap to add vertices · Close polygon when ready (3+ points).',
              })}
        </p>
      )}

      <div
        className={`relative overflow-hidden rounded-xl border border-cyan-500/25 ${heightClassName}`}
      >
        <MapGL
          {...viewState}
          onMove={(evt) => setViewState(evt.viewState)}
          onClick={handleClick}
          mapboxAccessToken={MAPBOX_TOKEN}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          style={{ width: '100%', height: '100%' }}
          attributionControl={false}
          reuseMaps
          cursor={mode === 'idle' || !interactive ? 'grab' : 'crosshair'}
        >
          <Source id="store-coverage" type="geojson" data={previewGeoJson}>
            <Layer
              id="store-coverage-fill"
              type="fill"
              filter={['==', '$type', 'Polygon']}
              paint={{
                'fill-color': '#10b981',
                'fill-opacity': 0.22,
              }}
            />
            <Layer
              id="store-coverage-line"
              type="line"
              paint={{
                'line-color': '#34d399',
                'line-width': 2,
              }}
            />
          </Source>

          {typeof officeLat === 'number' &&
            typeof officeLng === 'number' &&
            Number.isFinite(officeLat) &&
            Number.isFinite(officeLng) && (
              <Marker longitude={officeLng} latitude={officeLat} anchor="bottom">
                <div className="flex flex-col items-center">
                  <span className="rounded-full border border-cyan-400/70 bg-cyan-500/30 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-cyan-100 backdrop-blur-sm">
                    {t('storeOfficeBadge', { defaultValue: 'Office' })}
                  </span>
                  <MapPin className="h-7 w-7 text-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.7)]" />
                </div>
              </Marker>
            )}

          {draftRing.map(([lng, lat], i) => (
            <Marker key={`v-${i}`} longitude={lng} latitude={lat} anchor="center">
              <span className="block h-2.5 w-2.5 rounded-full border border-emerald-200 bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
            </Marker>
          ))}
        </MapGL>
      </div>
    </div>
  );
};

export default StoreCoverageMap;
