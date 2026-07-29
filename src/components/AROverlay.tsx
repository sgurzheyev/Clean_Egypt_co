/**
 * [[Architecture_Overview.md]]
 * WebXR AR mission scanner — GPS → 3D markers for available/funding missions.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { XR, createXRStore } from '@react-three/xr';
import { Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../services/supabase';

/**
 * `XRSession.mode` is part of the WebXR spec but missing from the bundled DOM/
 * WebXR lib types. Augment it so mode-guarded logic stays type-safe.
 */
declare global {
  interface XRSession {
    readonly mode?: 'inline' | 'immersive-vr' | 'immersive-ar';
  }
}

/**
 * Standalone WebXR AR overlay: renders 'available' / 'funding' missions as
 * 3D markers positioned relative to the user's GPS location.
 *
 * Mounted as a sibling layer above MapPicker — the 2D map never unmounts.
 */

type ARMission = {
  id: string;
  status: string;
  location_lat: number;
  location_lng: number;
  country?: string | null;
  city?: string | null;
  current_funding: number | null;
  expected_price: number | null;
  description: string | null;
  crowdfunding_mode: boolean | null;
};

/**
 * XRSessionInit for immersive-ar.
 * hit-test + local are required; dom-overlay stays optional.
 * (local-floor — the library default — is never requested.)
 */
const AR_SESSION_INIT: XRSessionInit = {
  requiredFeatures: ['hit-test', 'local'],
  optionalFeatures: ['dom-overlay'],
};

/**
 * three.js WebXRManager may create XRWebGLBinding whenever the API exists.
 * That constructor is immersive-only — guard getBinding so we never attach
 * a binding outside an immersive-ar session.
 */
function patchManagerForImmersiveAR(manager: THREE.WebXRManager) {
  const originalGetBinding = manager.getBinding.bind(manager);
  manager.getBinding = () => {
    const session = manager.getSession();
    if (!session || session.mode !== 'immersive-ar') {
      console.log(
        '[AROverlay] XRWebGLBinding skipped — only initialized for immersive-ar (mode:',
        session?.mode ?? 'none',
        ')'
      );
      return null as unknown as ReturnType<THREE.WebXRManager['getBinding']>;
    }
    return originalGetBinding();
  };
}

/**
 * Fresh store per overlay mount — no module singleton, so a stale instance
 * created with old options can never leak into a new attempt.
 * customSessionInit short-circuits the library's buildXRSessionInit entirely
 * (its default injects requiredFeatures: ['local-floor']).
 */
function createAROnlyStore() {
  const store = createXRStore({
    // Handheld AR: no controllers / hands / gaze.
    controller: false,
    hand: false,
    gaze: false,
    // Kill every library default that adds session features.
    anchors: false,
    layers: false,
    meshDetection: false,
    planeDetection: false,
    handTracking: false,
    depthSensing: false,
    bodyTracking: false,
    // The emulator injection on localhost can also alter session behavior.
    emulate: false,
    // Verbatim override — bypasses buildXRSessionInit defaults completely.
    customSessionInit: AR_SESSION_INIT,
  });

  // @pmndrs/xr hardcodes referenceSpaceType 'local-floor' on the three.js
  // WebXRManager; without the local-floor feature the session would then fail
  // at requestReferenceSpace. Force plain 'local' (always granted in AR).
  const originalSetManager = store.setWebXRManager.bind(store);
  store.setWebXRManager = (manager: THREE.WebXRManager) => {
    originalSetManager(manager);
    patchManagerForImmersiveAR(manager);
    try {
      manager.setReferenceSpaceType('local');
      console.log('[AROverlay] three.js referenceSpaceType forced to "local"');
    } catch (e) {
      console.warn('[AROverlay] could not set referenceSpaceType:', e);
    }
  };

  return store;
}

const EARTH_METERS_PER_DEG_LAT = 111_320;

/**
 * Equirectangular GPS → local ENU meters (east = +X, north = -Z in three.js).
 * Good to <1% error at mission-viewing distances (< a few km).
 */
function gpsToLocal(
  lat: number,
  lng: number,
  originLat: number,
  originLng: number
): { east: number; north: number; distance: number } {
  const east =
    (lng - originLng) * EARTH_METERS_PER_DEG_LAT * Math.cos((originLat * Math.PI) / 180);
  const north = (lat - originLat) * EARTH_METERS_PER_DEG_LAT;
  return { east, north, distance: Math.hypot(east, north) };
}

/**
 * Compress real-world distance into a comfortable AR band (3m–28m) with log
 * falloff, preserving bearing. A mission 2km away still shows on its true
 * bearing but within arm's-reach visual range.
 */
function compressDistance(meters: number): number {
  const MIN = 3;
  const MAX = 28;
  if (meters <= MIN) return Math.max(1.5, meters);
  return Math.min(MAX, MIN + Math.log10(1 + meters / MIN) * 9);
}

function fundingPct(m: ARMission): number {
  const target = Math.max(0, Number(m.expected_price ?? 0));
  const raised = Math.max(0, Number(m.current_funding ?? 0));
  if (target <= 0) return 0;
  return Math.min(100, Math.round((raised / target) * 100));
}

/** Neon palette matching the app's cyber theme. */
const NEON_CYAN = '#22d3ee';
const NEON_AMBER = '#fbbf24';
const NEON_EMERALD = '#34d399';

function MissionMarker3D({
  mission,
  position,
  distanceMeters,
}: {
  mission: ARMission;
  position: [number, number, number];
  distanceMeters: number;
}) {
  const isFunding = String(mission.status).toLowerCase() === 'funding';
  const pct = fundingPct(mission);
  const color = isFunding ? NEON_AMBER : NEON_CYAN;
  const pinRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (pinRef.current) {
      pinRef.current.position.y = 1.6 + Math.sin(t * 2 + position[0]) * 0.12;
      pinRef.current.rotation.y = t * 0.8;
    }
    if (ringRef.current) {
      const s = 1 + 0.15 * Math.sin(t * 3);
      ringRef.current.scale.setScalar(s);
    }
  });

  const distanceLabel =
    distanceMeters >= 1000
      ? `${(distanceMeters / 1000).toFixed(1)} km`
      : `${Math.round(distanceMeters)} m`;

  const BAR_W = 1.4;

  return (
    <group position={position}>
      {/* Ground pulse ring */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.5, 0.62, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.55} side={THREE.DoubleSide} />
      </mesh>

      {/* Floating pin: octahedron on a thin column */}
      <mesh position={[0, 0.8, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 1.6, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} />
      </mesh>
      <group ref={pinRef} position={[0, 1.6, 0]}>
        <mesh>
          <octahedronGeometry args={[0.32]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={isFunding ? 1.4 : 0.8}
            transparent
            opacity={0.92}
          />
        </mesh>
        {/* Funding halo */}
        {isFunding && (
          <mesh>
            <sphereGeometry args={[0.46, 24, 24]} />
            <meshBasicMaterial color={NEON_AMBER} transparent opacity={0.14} />
          </mesh>
        )}
      </group>

      {/* Billboard label + progress bar, always facing the camera */}
      <Billboard position={[0, 2.5, 0]}>
        {/* Glass card backdrop */}
        <mesh position={[0, 0, -0.01]}>
          <planeGeometry args={[1.8, isFunding ? 0.9 : 0.6]} />
          <meshBasicMaterial color="#020617" transparent opacity={0.65} />
        </mesh>

        <Text
          position={[0, isFunding ? 0.26 : 0.1, 0]}
          fontSize={0.14}
          color={color}
          anchorX="center"
          anchorY="middle"
          maxWidth={1.7}
        >
          {isFunding ? 'CROWDFUNDING' : 'GARBAGE MISSION'}
        </Text>
        <Text
          position={[0, isFunding ? 0.06 : -0.12, 0]}
          fontSize={0.1}
          color="#94a3b8"
          anchorX="center"
          anchorY="middle"
        >
          {distanceLabel}
          {isFunding
            ? ` · $${Math.floor(Number(mission.current_funding ?? 0))} / $${Math.floor(Number(mission.expected_price ?? 0))}`
            : ''}
        </Text>

        {isFunding && (
          <group position={[0, -0.18, 0]}>
            {/* Track */}
            <mesh>
              <planeGeometry args={[BAR_W, 0.09]} />
              <meshBasicMaterial color="#1e293b" transparent opacity={0.9} />
            </mesh>
            {/* Fill (left-anchored) */}
            <mesh position={[(-BAR_W / 2) + (BAR_W * pct) / 200, 0, 0.005]}>
              <planeGeometry args={[Math.max(0.02, (BAR_W * pct) / 100), 0.09]} />
              <meshBasicMaterial color={pct >= 100 ? NEON_EMERALD : NEON_AMBER} />
            </mesh>
            <Text position={[0, -0.16, 0]} fontSize={0.09} color={NEON_AMBER} anchorX="center">
              {`${pct}% FUNDED`}
            </Text>
          </group>
        )}
      </Billboard>
    </group>
  );
}

function ARScene({
  missions,
  origin,
}: {
  missions: ARMission[];
  origin: { lat: number; lng: number };
}) {
  const placed = useMemo(() => {
    return missions
      .map((m) => {
        const { east, north, distance } = gpsToLocal(
          m.location_lat,
          m.location_lng,
          origin.lat,
          origin.lng
        );
        if (distance < 0.5) return null; // standing on it — skip to avoid clipping
        const r = compressDistance(distance);
        const scale = r / Math.max(distance, 0.001);
        // three.js: +X east, -Z north; y=0 is floor at session start.
        return {
          mission: m,
          position: [east * scale, 0, -north * scale] as [number, number, number],
          distance,
        };
      })
      .filter(Boolean) as { mission: ARMission; position: [number, number, number]; distance: number }[];
  }, [missions, origin.lat, origin.lng]);

  return (
    <>
      <ambientLight intensity={1.2} />
      <directionalLight position={[2, 6, 3]} intensity={1.5} />
      {placed.map((p) => (
        <MissionMarker3D
          key={p.mission.id}
          mission={p.mission}
          position={p.position}
          distanceMeters={p.distance}
        />
      ))}
    </>
  );
}

const GLASS_PANEL =
  'backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl';

export default function AROverlay({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  // Fresh store per mount — never reuses a singleton with stale session config.
  const store = useMemo(() => createAROnlyStore(), []);
  const [missions, setMissions] = useState<ARMission[]>([]);
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorTone, setErrorTone] = useState<'soft' | 'hard'>('hard');
  const [xrSupported, setXrSupported] = useState<boolean | null>(null);
  const [inSession, setInSession] = useState(false);
  const closedRef = useRef(false);

  const unsupportedMsg = t('arUnsupportedDevice', {
    defaultValue:
      'Your device does not support augmented reality technologies (WebXR).',
  });

  // 1) Capability check — immersive-ar only
  useEffect(() => {
    let cancelled = false;
    const xr = (navigator as any).xr;
    if (!xr?.isSessionSupported) {
      setXrSupported(false);
      setErrorTone('soft');
      setError(unsupportedMsg);
      return;
    }
    xr.isSessionSupported('immersive-ar')
      .then((ok: boolean) => {
        if (cancelled) return;
        console.log('[AROverlay] isSessionSupported(immersive-ar):', ok);
        setXrSupported(ok);
        if (!ok) {
          setErrorTone('soft');
          setError(unsupportedMsg);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setXrSupported(false);
          setErrorTone('soft');
          setError(unsupportedMsg);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [unsupportedMsg]);

  // 2) Geolocation (origin for GPS→AR mapping).
  // High-accuracy GPS can tick every second; each new origin object re-renders
  // the whole overlay + Canvas tree. Only commit fixes that moved > ~3 m —
  // marker positions are compressed to a 3–28 m band, so sub-3 m drift is
  // visually irrelevant.
  useEffect(() => {
    if (!navigator.geolocation) {
      setErrorTone('soft');
      setError(
        t('arGpsUnavailable', {
          defaultValue: 'Geolocation is not available on this device.',
        })
      );
      return;
    }
    let last: { lat: number; lng: number } | null = null;
    const MIN_MOVE_METERS = 3;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (last) {
          const { distance } = gpsToLocal(next.lat, next.lng, last.lat, last.lng);
          if (distance < MIN_MOVE_METERS) return;
        }
        last = next;
        setOrigin(next);
      },
      (err) => {
        setErrorTone('soft');
        setError(err.message || t('arGpsUnavailable', {
          defaultValue: 'Geolocation is not available on this device.',
        }));
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [t]);

  // 3) Missions from Supabase (existing client, no map coupling)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('missions')
        .select(
          'id, status, location_lat, location_lng, country, city, current_funding, expected_price, description, crowdfunding_mode'
        )
        .in('status', ['available', 'funding'])
        .not('location_lat', 'is', null)
        .not('location_lng', 'is', null)
        .limit(100);
      if (cancelled) return;
      if (err) {
        setError(err.message);
        return;
      }
      setMissions((data || []) as ARMission[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 4) Track session state; auto-close overlay when user exits AR from the OS UI
  useEffect(() => {
    const unsub = store.subscribe((state) => {
      const active = !!state.session;
      setInSession(active);
      if (!active && closedRef.current) onClose();
    });
    return unsub;
  }, [store, onClose]);

  // 5) Cleanup: end the XR session and destroy this mount's store on unmount
  useEffect(() => {
    return () => {
      const session = store.getState().session;
      if (session) session.end().catch(() => {});
      store.destroy();
    };
  }, [store]);

  const handleEnterAR = useCallback(async () => {
    const xr = (navigator as any).xr as XRSystem | undefined;
    setError(null);

    console.log('[AROverlay] Enter AR clicked');
    console.log('[AROverlay] XRSessionInit →', JSON.stringify(AR_SESSION_INIT, null, 2));
    console.log('[AROverlay] navigator.xr present:', !!xr);
    try {
      const arOk = await xr?.isSessionSupported('immersive-ar');
      console.log('[AROverlay] isSessionSupported(immersive-ar):', arOk);
    } catch (e) {
      console.warn('[AROverlay] isSessionSupported(immersive-ar) threw:', e);
    }

    closedRef.current = true; // once a session ends after this, close the overlay

    try {
      const session = await store.enterAR();
      console.log('[AROverlay] immersive-ar session started:', {
        mode: (session as XRSession | undefined)?.mode,
        environmentBlendMode: (session as XRSession | undefined)?.environmentBlendMode,
        visibilityState: (session as XRSession | undefined)?.visibilityState,
        enabledFeatures: (session as XRSession | undefined)?.enabledFeatures,
      });
    } catch (e: unknown) {
      closedRef.current = false;
      const err = e as { name?: string; message?: string };
      console.error('[AROverlay] immersive-ar failed:', err?.name, err?.message, e);
      try {
        await store.getState().session?.end();
      } catch {
        /* ignore */
      }
      const msg = String(err?.message || '').toLowerCase();
      const unsupported =
        msg.includes('not supported') ||
        msg.includes('unsupported') ||
        err?.name === 'NotSupportedError' ||
        err?.name === 'SecurityError';
      setErrorTone('soft');
      setError(
        unsupported
          ? unsupportedMsg
          : t('arUnsupportedDevice', {
              defaultValue:
                'Your device does not support augmented reality technologies (WebXR).',
            })
      );
      setXrSupported(false);
    }
  }, [store, t, unsupportedMsg]);

  const handleExit = useCallback(() => {
    closedRef.current = false;
    const session = store.getState().session;
    if (session) {
      session.end().catch(() => {});
    }
    onClose();
  }, [store, onClose]);

  const fundingCount = missions.filter((m) => m.status === 'funding').length;

  return (
    <div className="fixed inset-0 z-[150] h-dvh bg-slate-950/90 backdrop-blur-sm">
      {/* XR canvas — transparent; camera feed shows through in AR */}
      {origin && (
        <Canvas
          className="!absolute inset-0"
          gl={{ alpha: true, antialias: true }}
          camera={{ position: [0, 1.6, 0], fov: 70 }}
        >
          <XR store={store}>
            <ARScene missions={missions} origin={origin} />
          </XR>
        </Canvas>
      )}

      {/* HUD — hidden while immersed (browser renders passthrough + WebGL only) */}
      {!inSession && (
        <div className="absolute inset-0 flex items-center justify-center p-4 pointer-events-none">
          <div className={`${GLASS_PANEL} pointer-events-auto w-full max-w-sm p-6 text-center shadow-[0_0_40px_rgba(34,211,238,0.15)]`}>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-300">
              AR Mission Scanner
            </p>
            <p className="mt-3 text-sm text-slate-300">
              {missions.length} missions in range
              {fundingCount > 0 && (
                <span className="text-amber-300"> · {fundingCount} crowdfunding</span>
              )}
            </p>

            {error && (
              <p
                className={`mt-3 text-xs leading-relaxed ${
                  errorTone === 'soft' ? 'text-amber-200/95' : 'text-red-400'
                }`}
              >
                {error}
              </p>
            )}
            {!origin && !error && (
              <p className="mt-3 text-xs text-slate-500 animate-pulse">Acquiring GPS…</p>
            )}
            {xrSupported === false && !error && (
              <p className="mt-3 text-xs leading-relaxed text-amber-200/95">
                {unsupportedMsg}
              </p>
            )}

            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                disabled={!origin || xrSupported === false}
                onClick={handleEnterAR}
                className="w-full rounded-full border border-cyan-400/50 bg-cyan-500/10 px-6 py-3 text-xs font-black uppercase tracking-[0.2em] text-cyan-300 transition-all hover:bg-cyan-500/20 hover:shadow-[0_0_20px_rgba(34,211,238,0.35)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Enter AR
              </button>
              <button
                type="button"
                onClick={handleExit}
                className="w-full rounded-full border border-white/10 bg-white/5 px-6 py-3 text-xs font-black uppercase tracking-[0.2em] text-slate-400 transition-all hover:bg-white/10 active:scale-95"
              >
                Back to Map
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-session exit chip (DOM overlay on supporting browsers) */}
      {inSession && (
        <button
          type="button"
          onClick={handleExit}
          className={`${GLASS_PANEL} absolute right-4 top-4 z-10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-red-300 border-red-500/40`}
        >
          Exit AR
        </button>
      )}
    </div>
  );
}
