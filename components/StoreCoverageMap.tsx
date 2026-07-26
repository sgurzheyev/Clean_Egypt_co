/**
 * Lightweight Mapbox coverage editor — office pin + click-to-draw polygon.
 * Read-only mode renders lilac zone and tap-to-fitBounds the whole coverage.
 * No @mapbox/mapbox-gl-draw dependency: vertices are added by map click.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapGL, {
  Layer,
  Marker,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MapPin, Pentagon, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  polygonFromRing,
  polygonLngLatBounds,
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
  const mapRef = useRef<MapRef | null>(null);
  const hasOffice =
    typeof officeLat === 'number' &&
    typeof officeLng === 'number' &&
    Number.isFinite(officeLat) &&
    Number.isFinite(officeLng);

  // Start in pin mode when the office is still empty so the first tap places it.
  const [mode, setMode] = useState<Mode>(() =>
    interactive && !hasOffice ? 'office' : 'idle'
  );
  const [draftRing, setDraftRing] = useState<GeoJsonPosition[]>([]);

  const initialView = useMemo(() => {
    if (hasOffice) {
      return { latitude: officeLat!, longitude: officeLng!, zoom: 12 };
    }
    if (polygon?.coordinates?.[0]?.[0]) {
      const [lng, lat] = polygon.coordinates[0][0];
      return { latitude: lat, longitude: lng, zoom: 11 };
    }
    return { latitude: 30.0444, longitude: 31.2357, zoom: 10 };
  }, [hasOffice, officeLat, officeLng, polygon]);

  const [viewState, setViewState] = useState(initialView);

  const fitToCoverage = useCallback(
    (opts?: { animate?: boolean; cinematic?: boolean }) => {
      const map = mapRef.current?.getMap?.();
      if (!map) return false;
      const bounds = polygonLngLatBounds(polygon);

      if (opts?.cinematic) {
        // Cinematic 3D flight: tilt into the lilac zone instead of a flat snap.
        if (bounds) {
          const camera = map.cameraForBounds(bounds, {
            padding: 50,
            bearing: -12,
            maxZoom: 15.5,
          });
          if (camera) {
            map.flyTo({
              center: camera.center,
              zoom: camera.zoom,
              bearing: -12,
              pitch: 48,
              duration: 1400,
              essential: true,
            });
            return true;
          }
        }
        if (hasOffice) {
          map.flyTo({
            center: [officeLng!, officeLat!],
            zoom: 14,
            bearing: -12,
            pitch: 48,
            duration: 1400,
            essential: true,
          });
          return true;
        }
        return false;
      }

      if (bounds) {
        map.fitBounds(bounds, {
          padding: 36,
          maxZoom: 14,
          duration: opts?.animate === false ? 0 : 650,
        });
        return true;
      }
      if (hasOffice) {
        map.easeTo({
          center: [officeLng!, officeLat!],
          zoom: Math.max(map.getZoom(), 12),
          duration: opts?.animate === false ? 0 : 450,
        });
        return true;
      }
      return false;
    },
    [polygon, hasOffice, officeLat, officeLng]
  );

  // Keep the camera on the office when it is placed/moved from outside (editor).
  useEffect(() => {
    if (!interactive || !hasOffice) return;
    setViewState((prev) => ({
      ...prev,
      latitude: officeLat!,
      longitude: officeLng!,
      zoom: Math.max(prev.zoom ?? 12, 12),
    }));
  }, [interactive, hasOffice, officeLat, officeLng]);

  // Read-only / whenever polygon data arrives: frame the lilac zone.
  useEffect(() => {
    if (interactive) return;
    const id = window.setTimeout(() => {
      fitToCoverage({ animate: false });
    }, 80);
    return () => window.clearTimeout(id);
  }, [interactive, polygon, hasOffice, officeLat, officeLng, fitToCoverage]);

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
      if (!interactive) {
        // Single tap on the profile map → cinematic 3D flight over the zone.
        e.originalEvent?.preventDefault?.();
        fitToCoverage({ cinematic: true });
        return;
      }
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
    [interactive, mode, onOfficeChange, fitToCoverage]
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

      {!interactive && polygon && (
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-violet-300/80">
          {t('storeTapMapToFitZone', {
            defaultValue: 'Tap map for a 3D flyover of the service zone',
          })}
        </p>
      )}

      <div
        className={`relative overflow-hidden rounded-xl border border-violet-400/30 ${heightClassName}`}
      >
        <MapGL
          ref={mapRef}
          {...viewState}
          onMove={(evt) => setViewState(evt.viewState)}
          onClick={handleClick}
          onLoad={() => {
            if (!interactive) fitToCoverage({ animate: false });
          }}
          mapboxAccessToken={MAPBOX_TOKEN}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          style={{ width: '100%', height: '100%' }}
          attributionControl={false}
          reuseMaps={false}
          cursor={!interactive ? 'pointer' : mode === 'idle' ? 'grab' : 'crosshair'}
          dragPan
          scrollZoom
          doubleClickZoom
          touchZoomRotate
          dragRotate
          touchPitch
          maxPitch={70}
        >
          <Source
            id="store-coverage-preview"
            type="geojson"
            data={previewGeoJson}
            key={polygon ? JSON.stringify(polygon.coordinates?.[0]?.[0]) : 'empty'}
          >
            <Layer
              id="store-coverage-fill"
              type="fill"
              filter={['==', '$type', 'Polygon']}
              paint={{
                'fill-color': '#a855f7',
                'fill-opacity': 0.25,
              }}
            />
            <Layer
              id="store-coverage-line"
              type="line"
              paint={{
                'line-color': '#c084fc',
                'line-width': 2.25,
                'line-opacity': 0.95,
              }}
            />
          </Source>

          {hasOffice && (
            <Marker
              longitude={officeLng!}
              latitude={officeLat!}
              anchor="bottom"
              draggable={interactive}
              onDragEnd={(e) => {
                if (!interactive) return;
                onOfficeChange(e.lngLat.lat, e.lngLat.lng);
              }}
            >
              <div className="flex flex-col items-center">
                <span className="rounded-full border border-violet-300/70 bg-violet-500/35 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-violet-50 backdrop-blur-sm">
                  {t('storeOfficeBadge', { defaultValue: 'Office' })}
                </span>
                <MapPin className="h-7 w-7 text-violet-300 drop-shadow-[0_0_8px_rgba(168,85,247,0.75)]" />
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
