/**
 * [[Architecture_Overview.md]]
 * WebXR AR mission scanner — GPS → 3D markers for available/funding missions.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { XR, createXRStore } from '@react-three/xr';
import { Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import { supabase } from '../../services/supabase';

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
  current_funding: number | null;
  expected_price: number | null;
  description: string | null;
  crowdfunding_mode: boolean | null;
};

/**
 * XRSessionInit for the primary immersive-ar attempt.
 * hit-test + local are required per product spec; dom-overlay stays optional.
 * (local-floor — the library default — is never requested.)
 */
const AR_SESSION_INIT: XRSessionInit = {
  requiredFeatures: ['hit-test', 'local'],
  optionalFeatures: ['dom-overlay'],
};

/**
 * XRSessionInit for the inline fallback. Inline sessions only guarantee the
 * 'viewer' reference space, so nothing is required — 'local' and 'hit-test'
 * are requested optionally and used if the browser grants them.
 */
const INLINE_SESSION_INIT: XRSessionInit = {
  requiredFeatures: [],
  optionalFeatures: ['local', 'hit-test'],
};

type ARStoreController = {
  store: ReturnType<typeof createXRStore>;
  /** Point the store at the immersive-ar config ('local' reference space). */
  useARConfig: () => void;
  /** Point the store at the inline config ('viewer' reference space). */
  useInlineConfig: () => void;
};

/**
 * Fresh store per overlay mount — no module singleton, so a stale instance
 * created with old options can never leak into a new attempt.
 * customSessionInit short-circuits the library's buildXRSessionInit entirely
 * (its default injects requiredFeatures: ['local-floor']). The options object
 * is kept mutable so the inline fallback can swap the sessionInit before
 * store.enterXR('inline') — the library closes over this same object.
 */
function createAROnlyStore(): ARStoreController {
  const options: Parameters<typeof createXRStore>[0] = {
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
  };
  const store = createXRStore(options);

  // @pmndrs/xr hardcodes referenceSpaceType 'local-floor' on the three.js
  // WebXRManager; keep a handle so each config can set the right space.
  let manager: THREE.WebXRManager | null = null;
  let referenceSpaceType: XRReferenceSpaceType = 'local';
  const applyReferenceSpace = () => {
    try {
      manager?.setReferenceSpaceType(referenceSpaceType);
      console.log(`[AROverlay] three.js referenceSpaceType set to "${referenceSpaceType}"`);
    } catch (e) {
      console.warn('[AROverlay] could not set referenceSpaceType:', e);
    }
  };

  const originalSetManager = store.setWebXRManager.bind(store);
  store.setWebXRManager = (m: THREE.WebXRManager) => {
    originalSetManager(m);
    manager = m;
    applyReferenceSpace();
  };

  return {
    store,
    useARConfig() {
      options.customSessionInit = AR_SESSION_INIT;
      referenceSpaceType = 'local';
      applyReferenceSpace();
    },
    useInlineConfig() {
      options.customSessionInit = INLINE_SESSION_INIT;
      // 'viewer' is the only space inline sessions must support.
      referenceSpaceType = 'viewer';
      applyReferenceSpace();
    },
  };
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
  // Fresh store per mount — never reuses a singleton with stale session config.
  const controller = useMemo(() => createAROnlyStore(), []);
  const store = controller.store;
  const [missions, setMissions] = useState<ARMission[]>([]);
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [xrSupported, setXrSupported] = useState<boolean | null>(null);
  const [inSession, setInSession] = useState(false);
  const [sessionMode, setSessionMode] = useState<'immersive-ar' | 'inline' | null>(null);
  const closedRef = useRef(false);

  // 1) Capability check — inline counts as supported (fallback path)
  useEffect(() => {
    const xr = (navigator as any).xr;
    if (!xr?.isSessionSupported) {
      setXrSupported(false);
      return;
    }
    Promise.all([
      xr.isSessionSupported('immersive-ar').catch(() => false),
      xr.isSessionSupported('inline').catch(() => false),
    ]).then(([ar, inline]: boolean[]) => {
      console.log('[AROverlay] supported — immersive-ar:', ar, '| inline:', inline);
      setXrSupported(ar || inline);
    });
  }, []);

  // 2) Geolocation (origin for GPS→AR mapping)
  useEffect(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not available on this device.');
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => setError(err.message || 'Location permission denied.'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // 3) Missions from Supabase (existing client, no map coupling)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('missions')
        .select(
          'id, status, location_lat, location_lng, current_funding, expected_price, description, crowdfunding_mode'
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
      if (!active) setSessionMode(null);
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
    setNotice(null);

    // ---- Diagnostics: log exactly what will be sent to requestSession ----
    console.log('[AROverlay] Enter AR clicked');
    console.log('[AROverlay] immersive-ar XRSessionInit →', JSON.stringify(AR_SESSION_INIT, null, 2));
    console.log('[AROverlay] navigator.xr present:', !!xr);
    try {
      const arOk = await xr?.isSessionSupported('immersive-ar');
      console.log('[AROverlay] isSessionSupported(immersive-ar):', arOk);
    } catch (e) {
      console.warn('[AROverlay] isSessionSupported(immersive-ar) threw:', e);
    }

    closedRef.current = true; // once a session ends after this, close the overlay

    // ---- Attempt 1: immersive-ar with required hit-test + local ----
    try {
      controller.useARConfig();
      const session = await store.enterAR();
      setSessionMode('immersive-ar');
      console.log('[AROverlay] immersive-ar session started:', {
        environmentBlendMode: (session as XRSession | undefined)?.environmentBlendMode,
        visibilityState: (session as XRSession | undefined)?.visibilityState,
      });
      return;
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      console.error('[AROverlay] immersive-ar failed:', err?.name, err?.message, e);
    }

    // ---- Attempt 2: inline fallback, bound to the same renderer/store ----
    console.log('[AROverlay] falling back to inline. XRSessionInit →',
      JSON.stringify(INLINE_SESSION_INIT, null, 2));
    try {
      controller.useInlineConfig();
      const inlineSession = await store.enterXR('inline');
      setSessionMode('inline');
      console.log('[AROverlay] inline session started:', {
        environmentBlendMode: (inlineSession as XRSession | undefined)?.environmentBlendMode,
        visibilityState: (inlineSession as XRSession | undefined)?.visibilityState,
      });
      setNotice(
        'Running in inline mode (no camera passthrough). Ensure your browser has camera ' +
          'permissions enabled and try starting the session again.'
      );
    } catch (inlineErr: unknown) {
      closedRef.current = false;
      controller.useARConfig(); // restore for the next attempt
      const ierr = inlineErr as { name?: string; message?: string };
      console.error('[AROverlay] inline session ALSO failed:', ierr?.name, ierr?.message, inlineErr);
      setError(
        `Both immersive-ar and inline sessions failed (${ierr?.name ?? 'Error'}: ` +
          `${ierr?.message ?? 'unknown'}). See console for the exact XRSessionInit objects sent.`
      );
    }
  }, [controller, store]);

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
    <div className="fixed inset-0 z-[150] bg-slate-950/90 backdrop-blur-sm">
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

            {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
            {notice && <p className="mt-3 text-xs text-amber-300/90">{notice}</p>}
            {!origin && !error && (
              <p className="mt-3 text-xs text-slate-500 animate-pulse">Acquiring GPS…</p>
            )}
            {xrSupported === false && (
              <p className="mt-3 text-xs text-amber-300/90">
                WebXR AR is not supported in this browser. Use Chrome on Android or a
                WebXR-enabled viewer on iOS.
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

      {/* Inline mode: no camera passthrough — explain and hint at the fix */}
      {inSession && sessionMode === 'inline' && (
        <div
          className={`${GLASS_PANEL} absolute inset-x-4 bottom-6 z-10 px-4 py-3 text-center`}
        >
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-300">
            Inline preview mode
          </p>
          <p className="mt-1 text-xs text-slate-300">
            Ensure your browser has camera permissions enabled and try starting the
            session again for full AR passthrough.
          </p>
        </div>
      )}
    </div>
  );
}
