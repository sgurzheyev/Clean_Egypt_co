/**
 * [[Architecture_Overview.md]]
 * Primary Mapbox UI — mission pins, create flow, bids, crowdfunding.
 */
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import MapGL, { NavigationControl, GeolocateControl, MapRef, Source, Layer, Marker } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import imageCompression from 'browser-image-compression';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import SunCalc from 'suncalc';
import { supabase } from '../services/supabase';
import { submitMissionProof } from '../src/lib/submitMissionProof';
import { Navigation, Camera, X, User } from 'lucide-react';
import LiveMarketFeed, { type LiveMarketMission } from './LiveMarketFeed';
import MissionFeedCard from './MissionFeedCard';
import MissionBriefing, { type AssignedWorkerProfile } from './MissionBriefing';
import { checkHomeMissionWorkerVerification } from '../src/lib/trustDeposit';
import CreateMission from './CreateMission';
import {
  validateMissionDescription,
  filterMissionDescription,
} from '../src/lib/missionContentPolicy';
import {
  processMissionDescription,
  extractMissionFeedDescription,
  MISSION_SHORT_DESCRIPTION_MAX,
} from '../src/lib/missionDescription';
import { type MissionBidRow } from '../src/lib/missionBids';
import {
  PROFILE_GLASS_PANEL,
  HOME_MIN_PRICE,
  HOME_MAX_PRICE,
  CITY_MIN_PRICE,
  CITY_MAX_PRICE,
  SCOUT_STAKE_FEE_USD,
} from '../constants';
import { formatTokens, formatWorkBudgetUsd } from '../src/lib/formatMoney';
import { missionTokenBid, missionWorkBudgetUsd } from '../src/lib/missionBudget';
import { isPlatformAdmin } from '../src/lib/platformAdmin';
import { adminDeleteMission } from '../src/lib/adminMission';
import { floorUsd, parseIntegerUsdFromInput, sanitizeIntegerUsdDigits } from '../src/lib/integerUsdInput';
import ModeratedMissionPhoto from './ModeratedMissionPhoto';
import TokenPackModal from '../src/components/TokenPackModal';
import SubscriptionModal from '../src/components/SubscriptionModal';
import { YEARLY_SUBSCRIPTION, formatUsdPrice } from '../src/lib/tokenPricing';
import VerificationModal from './VerificationModal';
import {
  type FormTrigger,
  type ServiceType,
  defaultServiceForTrigger,
  findServiceOption,
  servicesForTrigger,
  taskTypeForTrigger,
  missionSector,
  missionPinIcon,
  missionPinIconImage,
  PIN_ICON_IMAGE_SPONGE,
  PIN_ICON_IMAGE_MOP,
} from '../src/lib/serviceSectors';
import { isCrowdfundingOpen, isGarbageRemovalService } from '../src/lib/crowdfunding';
import { applyEgyptMapTheme, egyptRoadLineColorExpr } from '../src/lib/mapEgyptTheme';
import {
  applyWeatherFog,
  isWeatherDebugEnabled,
  setWeatherDebugEnabled,
  type MapWeatherMode,
} from '../src/lib/mapWeather';
import WeatherOverlay from '../src/components/WeatherOverlay';
import WeatherDebugPanel from '../src/components/WeatherDebugPanel';
import { confirmContributionCheckout, startContributionCheckout } from '../src/lib/contributions';
import { closestMarketplaceCity } from '../src/lib/egyptMarketplace';
import {
  type PinLocationContext,
  formatPinLocationTag,
  reverseGeocodePinLocation,
} from '../src/lib/mapboxReverseGeocode';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
// Egypt approximate bounding box (used only to validate pin placement — map view is global).
const EGYPT_MAX_BOUNDS: [[number, number], [number, number]] = [[24.7, 22.0], [36.9, 31.6]];
const PROOF_IMAGE_COMPRESSION = {
  maxWidthOrHeight: 1200,
  initialQuality: 0.7,
  useWebWorker: true,
  fileType: 'image/jpeg' as const,
};

const isInsideEgyptBounds = (lng: number, lat: number) =>
  lng >= EGYPT_MAX_BOUNDS[0][0] &&
  lng <= EGYPT_MAX_BOUNDS[1][0] &&
  lat >= EGYPT_MAX_BOUNDS[0][1] &&
  lat <= EGYPT_MAX_BOUNDS[1][1];

/** Mission pin radii (px) — scale up to z17, then plateau so pins do not balloon at z18+. */
const MISSION_PIN_CORE_RADIUS: mapboxgl.Expression = [
  'interpolate',
  ['linear'],
  ['zoom'],
  8,
  4,
  12,
  6,
  15,
  7,
  18,
  10,
  22,
  10,
];
const MISSION_PIN_GLOW_RADIUS: mapboxgl.Expression = [
  'interpolate',
  ['linear'],
  ['zoom'],
  8,
  8,
  12,
  14,
  15,
  16,
  18,
  20,
  22,
  20,
];
const DRAFT_PIN_RADIUS: mapboxgl.Expression = [
  'interpolate',
  ['linear'],
  ['zoom'],
  8,
  8,
  12,
  11,
  15,
  13,
  18,
  14,
  22,
  14,
];

/** Core pin colors by service_type (Mapbox `match` on GeoJSON properties). */
const MISSION_PIN_CATEGORY_FALLBACK: mapboxgl.Expression = [
  'match',
  ['get', 'category'],
  'public',
  '#22c55e',
  'home',
  '#f59e0b',
  'office',
  '#f59e0b',
  '#ff2d55',
];

const MISSION_PIN_CORE_COLOR: mapboxgl.Expression = [
  'match',
  ['coalesce', ['get', 'service_type'], ''],
  'home_office',
  '#10b981',
  'ac_cleaning',
  '#0ea5e9',
  'pool_maintenance',
  '#06b6d4',
  'pest_control',
  '#65a30d',
  'windows_facades',
  '#3b82f6',
  'terrace_garden',
  '#16a34a',
  'car_detailing',
  '#f59e0b',
  'yacht_boat_cleaning',
  '#6366f1',
  'solar_panels',
  '#eab308',
  'ultrasound_cleaning',
  '#8b5cf6',
  'carpets_mattresses',
  '#f43f5e',
  'kitchen_hoods_grease',
  '#f97316',
  'laundry_ironing',
  '#14b8a6',
  'water_tank_cleaning',
  '#0284c7',
  'junk_removal',
  '#94a3b8',
  'beach_street_cleanup',
  '#22c55e',
  MISSION_PIN_CATEGORY_FALLBACK,
];

const MISSION_PIN_HOVER_STROKE_WIDTH: mapboxgl.Expression = [
  'case',
  ['boolean', ['feature-state', 'hover'], false],
  3,
  2,
];

/** icon-size is a scale factor: emoji images are 64px @ pixelRatio 2 → 32 CSS px at 1.0. */
const MISSION_PIN_ICON_SIZE: mapboxgl.Expression = [
  'interpolate',
  ['linear'],
  ['zoom'],
  8,
  0.34,
  12,
  0.42,
  15,
  0.48,
  18,
  0.55,
  22,
  0.55,
];

/**
 * Mapbox glyph PBFs are monochrome SDFs (Open Sans / Arial Unicode) and contain no emoji,
 * so 🧽/🧹 in a `text-field` never render. Rasterize the emoji onto a canvas and register
 * them as style images for an `icon-image` symbol layer instead.
 */
function registerEmojiPinImages(map: any) {
  const addEmojiImage = (id: string, emoji: string) => {
    try {
      if (map.hasImage?.(id)) return;
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.round(size * 0.8)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      ctx.fillText(emoji, size / 2, size / 2 + size * 0.04);
      map.addImage(id, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
    } catch {
      /* canvas/image registration is best-effort; circles still render */
    }
  };
  addEmojiImage(PIN_ICON_IMAGE_SPONGE, '🧽');
  addEmojiImage(PIN_ICON_IMAGE_MOP, '🧹');
}

type TaskType = 'city' | 'home';

interface JobOnMap {
  id: string;
  category: 'public' | 'home' | 'office' | string;
  service_type?: string | null;
  amount_target: number;
  expected_price?: number | null;
  current_funding?: number | null;
  crowdfunding_mode?: boolean | null;
  crowdfunding_expires_at?: string | null;
  location_lat: number;
  location_lng: number;
  status: string;
  building_id?: number | string | null;
  cleaner_id?: string | null;
  creator_id?: string | null;
  description?: string | null;
  photo_urls?: string[] | null;
  after_photo_urls?: string[] | null;
  created_at?: string | null;
  started_at?: string | null;
  completion_lat?: number | null;
  completion_lng?: number | null;
  completion_distance_meters?: number | null;
  creator?: {
    avatar_url?: string | null;
    phone_number?: string | null;
    is_verified?: boolean | null;
  } | null;
}

/** Same filter as mission markers — heatmap aligns with visible pins. */
function missionEligibleForMapPin(job: JobOnMap): boolean {
  // Phantom pins (unpaid drafts) must never appear on the map.
  if (job.status === 'pending_payment') return false;
  if (job.status === 'pending') return true;
  if (job.status === 'available') return true;
  if (job.status === 'funding') return true;
  if (job.status === 'in_progress') return true;
  if (job.status === 'completed') {
    const ts = job.created_at;
    if (!ts) return false;
    const completedAt = new Date(ts).getTime();
    if (!Number.isFinite(completedAt)) return false;
    return Date.now() - completedAt <= 24 * 60 * 60 * 1000;
  }
  return false;
}

/** Keep locally injected missions when a refetch hasn't caught up with the DB yet. */
function mergeFetchedMissions(existing: JobOnMap[], fetched: JobOnMap[]): JobOnMap[] {
  const byId = new Map<string, JobOnMap>();
  for (const j of fetched) byId.set(String(j.id), j);
  for (const j of existing) {
    const id = String(j.id);
    if (!byId.has(id)) byId.set(id, j);
  }
  return Array.from(byId.values()).sort((a, b) => {
    const ta = new Date(a.created_at ?? 0).getTime();
    const tb = new Date(b.created_at ?? 0).getTime();
    return tb - ta;
  });
}

function buildOptimisticLeadMission(
  missionId: string,
  serviceType: string,
  location: { lat: number; lng: number },
  sessionUserId: string,
  descriptionToSave: string,
  creatorPhotoUrls: string[] | undefined,
  viewerProfile: any,
  tokenBid: number,
  expectedPrice: number,
  crowdfundingMode = false
): JobOnMap {
  const isCrowdfund =
    crowdfundingMode && isGarbageRemovalService(serviceType);
  return {
    id: String(missionId),
    category: missionSector(serviceType, null) === 'home' ? 'home' : 'public',
    service_type: serviceType,
    amount_target: Math.max(1, tokenBid),
    expected_price: Math.max(1, expectedPrice),
    current_funding: 0,
    crowdfunding_mode: isCrowdfund,
    location_lat: Number(location.lat),
    location_lng: Number(location.lng),
    status: isCrowdfund ? 'funding' : 'available',
    building_id: null,
    cleaner_id: null,
    creator_id: sessionUserId,
    description: descriptionToSave || null,
    photo_urls: creatorPhotoUrls || [],
    after_photo_urls: null,
    created_at: new Date().toISOString(),
    started_at: null,
    completion_lat: null,
    completion_lng: null,
    completion_distance_meters: null,
    creator: viewerProfile
      ? {
          avatar_url: viewerProfile?.avatar_url ?? null,
          phone_number: viewerProfile?.phone_number ?? null,
          is_verified: viewerProfile?.is_verified ?? null,
        }
      : null,
  };
}

const OPEN_BID_MISSION_STATUSES = new Set(['pending', 'available']);
/** Legacy public funding pins may still use status=funding without crowdfunding_mode. */

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Thin cylinder footprint: closed ring approximating a circle (meters radius). */
function footprintCylinderRing(
  lng: number,
  lat: number,
  radiusMeters = 2.5,
  segments = 28
): [number, number][] {
  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const ang = (i / segments) * 2 * Math.PI;
    const eastM = radiusMeters * Math.cos(ang);
    const northM = radiusMeters * Math.sin(ang);
    const dLng = eastM / (111320 * cosLat);
    const dLat = northM / 111320;
    ring.push([lng + dLng, lat + dLat]);
  }
  return ring;
}

function HallOfFameSlider({ mission }: { mission: JobOnMap }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(50);
  const beforePhotos = mission.photo_urls || [];
  const afterPhotos = mission.after_photo_urls || [];
  if (beforePhotos.length === 0 && afterPhotos.length === 0) {
    return (
      <p className="mt-4 text-xs text-slate-400">
        {t('noBeforeAfterPhotosYet')}
      </p>
    );
  }
  const before = beforePhotos[0] || afterPhotos[0];
  const after = afterPhotos[0] || beforePhotos[0];

  return (
    <div className="mt-5">
      <div className="relative w-full aspect-video rounded-2xl overflow-hidden border border-cyan-500/20 bg-cyan-950/30 shadow-[0_4px_30px_rgba(6,182,212,0.1)]">
        <img src={before} alt={t('before')} className="absolute inset-0 h-full w-full object-cover" />
        <div
          className="absolute inset-0 overflow-hidden border-l border-amber-300/70 shadow-[0_0_30px_rgba(251,191,36,0.5)]"
          style={{ width: `${value}%` }}
        >
          <img src={after} alt={t('after')} className="h-full w-full object-cover" />
        </div>
        <div className="absolute inset-x-0 bottom-3 flex justify-center">
          <input
            type="range"
            min={0}
            max={100}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            className="w-48 accent-amber-300"
          />
        </div>
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-slate-500 uppercase tracking-[0.18em]">
        <span>{t('before')}</span>
        <span>{t('after')}</span>
      </div>
    </div>
  );
}

function ActiveMissionWidget({
  mission,
  onNavigate,
  onUploadProof,
}: {
  mission: JobOnMap;
  onNavigate: () => void;
  onUploadProof: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const started = mission.started_at ? new Date(mission.started_at).getTime() : NaN;
  const endAt = Number.isFinite(started) ? started + 2 * 60 * 60 * 1000 : NaN;
  const msLeft = Number.isFinite(endAt) ? Math.max(0, endAt - now) : 0;
  const mins = Math.floor(msLeft / 60000);
  const secs = Math.floor((msLeft % 60000) / 1000);

  return (
    <motion.div
      initial={{ y: 28, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 20, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      className={`pointer-events-auto w-full max-w-xl rounded-3xl p-4 ${PROFILE_GLASS_PANEL} border border-orange-500/35 shadow-[0_0_28px_rgba(249,115,22,0.2)]`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-lg font-black text-orange-300 tabular-nums">
          {formatWorkBudgetUsd(missionWorkBudgetUsd(mission))}
        </p>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-300 tabular-nums">
          {`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`}
        </p>
        <button
          type="button"
          onClick={onNavigate}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-cyan-500/55 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 transition-all"
          aria-label="Navigate"
        >
          <Navigation className="h-4 w-4" />
        </button>
      </div>
      <button
        type="button"
        onClick={onUploadProof}
        className="mt-3 w-full rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.2em] text-orange-200 border border-orange-500/60 bg-orange-500/15 hover:bg-orange-500/25 hover:shadow-[0_0_20px_rgba(249,115,22,0.35)] transition-all"
      >
        UPLOAD WORK PROOF
      </button>
    </motion.div>
  );
}

function DraftPinActionHub({
  lat,
  lng,
  expanded,
  onToggleExpand,
  avatarUrl,
  avatarInitial,
  onMop,
  onSponge,
  onOpenMarket,
  mopLabel,
  spongeLabel,
  marketLabel,
}: {
  lat: number;
  lng: number;
  expanded: boolean;
  onToggleExpand: () => void;
  avatarUrl?: string | null;
  avatarInitial?: string | null;
  onMop: () => void;
  onSponge: () => void;
  onOpenMarket: () => void;
  mopLabel: string;
  spongeLabel: string;
  marketLabel: string;
}) {
  const orbitButtonClass =
    'absolute -left-[1.375rem] -top-[1.375rem] pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border text-lg leading-none shadow-lg backdrop-blur-md transition-transform active:scale-95';

  const orbitActions = [
    {
      key: 'sponge-orbit',
      offset: { x: -50, y: -30 },
      label: spongeLabel,
      onClick: onSponge,
      className:
        'border-amber-400/75 bg-amber-500/35 shadow-[0_0_16px_rgba(251,191,36,0.5)]',
      content: '🧽',
    },
    {
      key: 'mop-orbit',
      offset: { x: 50, y: -30 },
      label: mopLabel,
      onClick: onMop,
      className:
        'border-emerald-400/70 bg-emerald-500/35 shadow-[0_0_16px_rgba(34,197,94,0.5)]',
      content: '🧹',
    },
    {
      key: 'market-orbit',
      offset: { x: 0, y: -58 },
      label: marketLabel,
      onClick: onOpenMarket,
      className:
        'border-cyan-400/70 bg-cyan-500/35 text-base font-black text-cyan-50 shadow-[0_0_16px_rgba(34,211,238,0.45)]',
      content: '$',
    },
  ] as const;

  return (
    <Marker longitude={lng} latitude={lat} anchor="center">
      <div className="draft-pin-action-hub pointer-events-none relative z-50 h-0 w-0 overflow-visible">
        <AnimatePresence mode="popLayout">
          {expanded &&
            orbitActions.map((action, index) => {
              const { x, y } = action.offset;
              return (
                <div
                  key={action.key}
                  className="pointer-events-none absolute left-1/2 top-1/2 z-50 flex h-0 w-0 items-center justify-center overflow-visible"
                >
                  <motion.button
                    type="button"
                    initial={{ scale: 0, opacity: 0, x: 0, y: 0 }}
                    animate={{ scale: 1, opacity: 1, x, y }}
                    exit={{ scale: 0, opacity: 0, x: 0, y: 0 }}
                    transition={{
                      type: 'spring',
                      stiffness: 420,
                      damping: 22,
                      delay: index * 0.05,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      action.onClick();
                    }}
                    className={`${orbitButtonClass} ${action.className}`}
                    aria-label={action.label}
                  >
                    {action.content}
                  </motion.button>
                </div>
              );
            })}
        </AnimatePresence>

        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[60] flex h-0 w-0 items-center justify-center overflow-visible">
          <motion.button
            type="button"
            whileTap={{ scale: 0.92 }}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            className="pointer-events-auto absolute -left-6 -top-6 flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-2 border-cyan-400/80 bg-slate-950/90 shadow-[0_0_12px_rgba(34,211,238,0.35)]"
            aria-label={expanded ? 'Collapse actions' : 'Open actions'}
            aria-expanded={expanded}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : avatarInitial ? (
              <span className="text-sm font-black text-emerald-300">{avatarInitial}</span>
            ) : (
              <User className="h-5 w-5 text-cyan-200" aria-hidden />
            )}
          </motion.button>
        </div>
      </div>
    </Marker>
  );
}

function MyOrdersPanel({
  open,
  onClose,
  missions,
  onSelectMission,
  isLoggedIn,
  onRequestAuth,
}: {
  open: boolean;
  onClose: () => void;
  missions: JobOnMap[];
  onSelectMission: (mission: JobOnMap) => void;
  isLoggedIn: boolean;
  onRequestAuth?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[135] bg-black/50 backdrop-blur-sm pointer-events-auto"
          onClick={onClose}
        >
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className={`absolute inset-y-0 right-0 flex w-full max-w-sm flex-col border-l border-cyan-500/25 bg-slate-950/95 p-4 shadow-[-8px_0_32px_rgba(8,145,178,0.15)] ${PROFILE_GLASS_PANEL} !rounded-none !border-l`}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-400">
                  {t('myOrders')}
                </p>
                <p className="mt-1 text-xs text-slate-400">{t('myOrdersPanelHint')}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/40 text-slate-300 hover:border-cyan-500/45 hover:text-cyan-200"
                aria-label={t('close')}
              >
                ✕
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-y-contain pr-0.5">
              {!isLoggedIn && (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center">
                  <p className="text-sm text-slate-300">{t('myOrdersLoginHint')}</p>
                  {onRequestAuth && (
                    <button
                      type="button"
                      onClick={onRequestAuth}
                      className="mt-3 rounded-full border border-cyan-500/50 bg-cyan-500/15 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-cyan-200"
                    >
                      {t('signIn')}
                    </button>
                  )}
                </div>
              )}
              {isLoggedIn && missions.length === 0 && (
                <p className="px-1 py-6 text-center text-xs text-slate-400">{t('myOrdersEmpty')}</p>
              )}
              {isLoggedIn &&
                missions.map((mission) => {
                  const isHome = mission.category === 'home';
                  return (
                    <MissionFeedCard
                      key={mission.id}
                      photoUrl={mission.photo_urls?.[0] ?? null}
                      placeholderVariant={isHome ? 'home' : 'city'}
                      placeholderIcon={missionPinIcon(mission.service_type, mission.category)}
                      budgetValue={formatWorkBudgetUsd(missionWorkBudgetUsd(mission))}
                      metaLine={`${t('orderNumber')} ${mission.id.slice(0, 8)}`}
                      locationLine={mission.description?.split('\n')[0]?.trim() || undefined}
                      description={extractMissionFeedDescription(mission.description)}
                      statusBadge={
                        <span className="rounded-full border border-white/20 bg-black/40 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-slate-200 backdrop-blur-sm capitalize">
                          {mission.status}
                        </span>
                      }
                      onClick={() => onSelectMission(mission)}
                      onLocate={() => onSelectMission(mission)}
                      locateAriaLabel={t('locateOnMap')}
                    />
                  );
                })}
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ProofUploadModal({
  open,
  mission,
  onClose,
  onSuccess,
  toast,
}: {
  open: boolean;
  mission: JobOnMap | null;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
  toast: { error: (msg: string) => void; success: (msg: string) => void };
}) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) setFiles([]);
  }, [open]);

  const onFilesChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Array.from(event.target.files || []).filter((f) => f.type.startsWith('image/'));
    setFiles(next);
    event.target.value = '';
  }, []);

  const removeFileAt = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const previewUrls = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);

  useEffect(() => {
    return () => {
      for (const url of previewUrls) URL.revokeObjectURL(url);
    };
  }, [previewUrls]);

  const submitProof = useCallback(async () => {
    if (!mission) return;
    if (files.length === 0) {
      toast.error(t('proofAddPhotoRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        toast.error(t('signInToPlaceBid'));
        return;
      }

      const uploadedUrls: string[] = [];
      for (const file of files.slice(0, 9)) {
        let toUpload: File = file;
        try {
          const compressed = await imageCompression(file, PROOF_IMAGE_COMPRESSION);
          toUpload = compressed as File;
        } catch {
          // keep original when compression fails
        }

        const fileName = `proof_${mission.id}_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
        let uploadError: Error | null = null;

        const tryPrimary = await supabase.storage
          .from('mission-proofs')
          .upload(fileName, toUpload, { upsert: false, contentType: 'image/jpeg' });
        if (tryPrimary.error) {
          const tryFallback = await supabase.storage
            .from('order-photos')
            .upload(fileName, toUpload, { upsert: false, contentType: 'image/jpeg' });
          if (tryFallback.error) uploadError = tryFallback.error;
          else {
            const {
              data: { publicUrl },
            } = supabase.storage.from('order-photos').getPublicUrl(fileName);
            uploadedUrls.push(publicUrl);
          }
        } else {
          const {
            data: { publicUrl },
          } = supabase.storage.from('mission-proofs').getPublicUrl(fileName);
          uploadedUrls.push(publicUrl);
        }

        if (uploadError) throw uploadError;
      }

      await submitMissionProof({
        missionId: mission.id,
        afterPhotoUrls: uploadedUrls,
      });

      toast.success(t('proofUploadSuccess'));
      await onSuccess();
      onClose();
      setFiles([]);
    } catch (err: any) {
      toast.error(err?.message || t('failedUploadProof'));
    } finally {
      setSubmitting(false);
    }
  }, [files, mission, onClose, onSuccess, t, toast]);

  return (
    <AnimatePresence>
      {open && mission && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10060] flex flex-col justify-end bg-black/85 backdrop-blur-md pointer-events-auto"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 28, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
            className={`relative mx-auto flex w-full max-w-2xl max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-top)-0.5rem))] flex-col overflow-hidden rounded-t-3xl sm:mx-3 sm:mb-3 sm:rounded-3xl ${PROFILE_GLASS_PANEL}`}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
              <h3 className="text-xl font-black uppercase leading-tight tracking-[0.12em] text-orange-300 sm:text-2xl">
                {t('missionAccomplishedPrompt')}
              </h3>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/20 text-slate-300 hover:text-white"
                aria-label={t('close')}
              >
                ✕
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-5 py-4 pb-36 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <label className="block w-full cursor-pointer rounded-2xl border-2 border-dashed border-cyan-400/65 bg-cyan-500/5 p-8 text-center hover:bg-cyan-500/10 transition-all">
                <div className="mx-auto mb-3 inline-flex h-14 w-14 items-center justify-center rounded-full border border-cyan-400/60 bg-black/50 text-cyan-300">
                  <Camera className="h-6 w-6" />
                </div>
                <p className="text-sm font-bold text-cyan-200">Tap to capture/upload AFTER photos</p>
                <p className="mt-1 text-xs text-slate-400">Drag & drop supported, up to 9 photos</p>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  onChange={onFilesChange}
                  disabled={submitting}
                  className="hidden"
                />
              </label>

              {files.length > 0 && (
                <>
                  <p className="mt-3 text-xs font-semibold text-emerald-300">
                    {files.length} photo(s) selected
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {previewUrls.map((url, idx) => (
                      <div
                        key={`${url}-${idx}`}
                        className="relative overflow-hidden rounded-xl border border-cyan-500/35 bg-black/50 shadow-[0_0_12px_rgba(34,211,238,0.15)]"
                      >
                        <img src={url} alt={`Proof ${idx + 1}`} className="h-28 w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removeFileAt(idx)}
                          className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full border border-red-400/70 bg-red-500/25 text-red-100 hover:bg-red-500/35 hover:shadow-[0_0_12px_rgba(248,113,113,0.55)] transition-all"
                          aria-label="Remove image"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-10 border-t border-white/10 bg-slate-950/95 px-5 py-4 backdrop-blur-md pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={submitProof}
                disabled={submitting || files.length === 0}
                className="w-full rounded-full border border-orange-500/70 bg-orange-500/20 px-6 py-3.5 text-sm font-black uppercase tracking-[0.2em] text-orange-100 hover:bg-orange-500/30 hover:shadow-[0_0_24px_rgba(249,115,22,0.45)] disabled:opacity-60"
              >
                {submitting ? 'SUBMITTING...' : 'SUBMIT PROOF & GET PAID'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface MapPickerProps {
  onLocationSelect: (lat: number, lng: number) => void;
  selectedCoords?: { lat: number; lng: number } | null;
  onAvatarClick?: () => void;
  onRequestAuth?: () => void;
  flyToTarget?: { lat: number; lng: number } | null;
  onFlyToComplete?: () => void;
  orders?: any[]; // legacy, ignored
  currentAmount?: number; // legacy
  currentType?: 'home' | 'city'; // legacy
  hasFullAccess?: boolean; // legacy
  currentUserId?: string | null; // legacy
  onRequestPayment?: (params: {
    lat: number;
    lng: number;
    amount: number;
    type: 'home' | 'city';
  }) => void; // legacy, ignored
  showPayment?: boolean; // legacy
}

const customDarkStyle: any = {
  version: 8,
  sources: {
    composite: {
      type: 'vector',
      url: 'mapbox://mapbox.mapbox-streets-v8',
    },
    // Dark satellite base (aero-photo desert realism).
    'satellite': {
      type: 'raster',
      url: 'mapbox://mapbox.satellite',
      tileSize: 256,
    },
  },
  sprite: 'mapbox://sprites/mapbox/dark-v10',
  glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: {
        'background-color': '#000000',
      },
    },
    {
      id: 'satellite-base',
      type: 'raster',
      source: 'satellite',
      paint: {
        'raster-saturation': 0.1,
        'raster-brightness-max': 0.45,
        'raster-brightness-min': 0.05,
        'raster-contrast': 0.2,
        'raster-opacity': 0.8,
      },
    },
    // Landcover / landuse base palette (Egypt sand + mountains).
    // These layers stay below roads and below our 3D mission cylinders.
    {
      id: 'landcover',
      type: 'fill',
      source: 'composite',
      'source-layer': 'landcover',
      paint: {
        // Sand / scrub / rock tint that becomes slightly richer as you zoom in.
        'fill-color': [
          'interpolate',
          ['linear'],
          ['zoom'],
          5,
          [
            'match',
            ['get', 'class'],
            // Desert / sand
            'sand',
            '#d2b48c',
            'desert',
            '#e3bc9a',
            // Bare rock / mountains
            'bare_rock',
            '#4b3621',
            'rock',
            '#5d4037',
            // Scrub / dry vegetation
            'scrub',
            '#8b8680',
            'grass',
            '#8b8680',
            // Default: warm sand
            '#d2b48c',
          ],
          12,
          [
            'match',
            ['get', 'class'],
            'sand',
            '#e3bc9a',
            'desert',
            '#e3bc9a',
            'bare_rock',
            '#5d4037',
            'rock',
            '#5d4037',
            'scrub',
            '#8b8680',
            'grass',
            '#8b8680',
            '#e3bc9a',
          ],
        ],
        'fill-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          5,
          0.55,
          12,
          0.78,
        ],
      },
    },
    {
      id: 'landuse',
      type: 'fill',
      source: 'composite',
      'source-layer': 'landuse',
      paint: {
        'fill-color': [
          'match',
          ['get', 'class'],
          // Nile delta greenery (subtle emissive tint over satellite).
          'park',
          '#047857',
          'national_park',
          '#047857',
          'agriculture',
          '#047857',
          'grass',
          '#047857',
          // Default: transparent-ish sand overlay
          '#d2b48c',
        ],
        'fill-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          5,
          0.1,
          12,
          0.15,
        ],
      },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'composite',
      'source-layer': 'water',
      paint: {
        'fill-color': '#082f49',
        'fill-opacity': 0.85,
      },
    },
    // Nile glow: subtle bioluminescent shoreline / waterways.
    {
      id: 'waterway-glow',
      type: 'line',
      source: 'composite',
      'source-layer': 'waterway',
      paint: {
        'line-color': '#06b6d4',
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.3, 12, 1.2, 16, 2.4],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.25, 12, 0.55, 16, 0.75],
        'line-blur': 2,
      },
    },
    {
      id: 'waterway-core',
      type: 'line',
      source: 'composite',
      'source-layer': 'waterway',
      paint: {
        'line-color': '#06b6d4',
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.1, 12, 0.6, 16, 1.2],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.35, 12, 0.7, 16, 0.9],
      },
    },
    {
      id: 'road',
      type: 'line',
      source: 'composite',
      'source-layer': 'road',
      paint: {
        'line-color': egyptRoadLineColorExpr,
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          0.4,
          16,
          2.5,
        ],
        'line-opacity': 0.9,
      },
    },
    {
      id: 'place_label',
      type: 'symbol',
      source: 'composite',
      'source-layer': 'place_label',
      minzoom: 3,
      layout: {
        'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 10, 14, 14, 18],
        'text-anchor': 'center',
        'text-max-width': 10,
      },
      paint: {
        'text-color': '#e0e0e0',
        'text-halo-color': 'rgba(0, 0, 0, 0.8)',
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'road_label',
      type: 'symbol',
      source: 'composite',
      'source-layer': 'road_label',
      minzoom: 12,
      layout: {
        'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': 11,
        'symbol-placement': 'line',
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'map',
      },
      paint: {
        'text-color': '#c0c0c0',
        'text-halo-color': 'rgba(0, 0, 0, 0.8)',
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'water_name_line',
      type: 'symbol',
      source: 'composite',
      'source-layer': 'waterway_label',
      minzoom: 10,
      layout: {
        'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': 11,
        'symbol-placement': 'line',
      },
      paint: {
        'text-color': '#a0a0a0',
        'text-halo-color': 'rgba(0, 0, 0, 0.8)',
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'water_name_point',
      type: 'symbol',
      source: 'composite',
      'source-layer': 'water_name',
      minzoom: 4,
      layout: {
        'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 10, 14],
      },
      paint: {
        'text-color': '#a0a0a0',
        'text-halo-color': 'rgba(0, 0, 0, 0.8)',
        'text-halo-width': 1.5,
      },
    },
  ],
};

const MapPicker: React.FC<MapPickerProps> = ({
  onLocationSelect,
  selectedCoords = null,
  onAvatarClick,
  onRequestAuth,
  flyToTarget,
  onFlyToComplete,
}) => {
  const { t, i18n } = useTranslation();
  const isRu = (i18n.language || '').toLowerCase().startsWith('ru');
  const isTouchDevice =
    typeof window !== 'undefined' &&
    (('ontouchstart' in window) || (navigator && (navigator as any).maxTouchPoints > 0));
  const isMobile =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(max-width: 640px)').matches;
  const mapRef = React.useRef<MapRef>(null);
  const mapInstanceRef = React.useRef<any>(null);
  const orderFormRef = React.useRef<HTMLFormElement>(null);
  const jobsRef = React.useRef<JobOnMap[]>([]);
  const hoveredMissionIdRef = React.useRef<string | null>(null);
  // Latest map event closures. Native Mapbox listeners are bound ONCE (on map load) and delegate
  // through these refs, so updating React state never detaches/re-attaches the canvas listeners.
  const mapClickHandlerRef = React.useRef<(event: any) => void>(() => {});
  const mapMoveHandlerRef = React.useRef<(event: any) => void>(() => {});
  /** Brief cooldown after pin placement so the same tap cannot re-open the draft flow. */
  const pinPlacementCooldownRef = React.useRef(0);
  const mapWeatherRef = React.useRef<MapWeatherMode>('clear');

  const [mapWeather, setMapWeather] = useState<MapWeatherMode>('clear');
  const [weatherDebugOpen, setWeatherDebugOpen] = useState(() => isWeatherDebugEnabled());
  mapWeatherRef.current = mapWeather;

  const [viewState, setViewState] = useState({
    latitude: 27.2579,
    longitude: 33.8116,
    zoom: 12,
    pitch: 60,
    bearing: -20,
  });

  const [jobs, setJobs] = useState<JobOnMap[]>([]);
  const [mapReady, setMapReady] = useState(false);

  const updateAtmosphere = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const center = map.getCenter?.();
    const lat = Number(center?.lat);
    const lng = Number(center?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const now = new Date();
    const sun = SunCalc.getPosition(now, lat, lng);
    const moonPos = SunCalc.getMoonPosition(now, lat, lng);
    const moonIll = SunCalc.getMoonIllumination(now);

    const sunAltDeg = (sun.altitude * 180) / Math.PI;
    const sunAziDeg = ((sun.azimuth * 180) / Math.PI + 180 + 360) % 360;
    /** Angular elevation above horizon (−90…90). SunCalc uses astronomical convention. */
    const moonElevDeg = (moonPos.altitude * 180) / Math.PI;
    const moonAziDeg = ((moonPos.azimuth * 180) / Math.PI + 180 + 360) % 360;

    /**
     * Mapbox `sky-atmosphere-sun` polar angle: 0° = zenith, 90° = horizon (opposite of elevation).
     * @see https://docs.mapbox.com/mapbox-gl-js/style-spec/layers/#sky
     */
    const toSkyPolarDeg = (elevationDeg: number) =>
      Math.max(0, Math.min(180, 90 - elevationDeg));

    const moonSkyPolarDeg = toSkyPolarDeg(moonElevDeg);
    const sunSkyPolarDeg = toSkyPolarDeg(sunAltDeg);

    const isNight = sunAltDeg < 0;
    const moonFrac = Math.max(0, Math.min(1, Number(moonIll?.fraction ?? 0)));

    /** Moon above horizon: visible disc + scattering; scales with illumination (≈5–10 at full). */
    const moonAboveHorizon = moonElevDeg > 0.5;
    const moonSkyDiscIntensity = Math.max(
      4,
      Math.min(10, 4.5 + moonFrac * 5.5)
    );
    const nightSkyIntensity = moonAboveHorizon
      ? moonSkyDiscIntensity * (0.55 + 0.45 * Math.min(1, moonElevDeg / 60))
      : Math.max(2, moonFrac * 4);

    const skySunVec = isNight
      ? ([moonAziDeg, moonSkyPolarDeg] as [number, number])
      : ([sunAziDeg, sunSkyPolarDeg] as [number, number]);

    const golden = sunAltDeg >= 0 && sunAltDeg <= 10;

    /** Moonlit night: sharp, cool micro-glow toward zenith only (high-color), keep horizon band dark. */
    const moonGlowMix = isNight
      ? Math.max(
          0,
          Math.min(1, moonFrac * Math.max(0, Math.min(1, (moonElevDeg + 8) / 52)))
        )
      : 0;
    const nightFogHigh =
      moonGlowMix > 0.12
        ? '#101c32'
        : moonGlowMix > 0.04
          ? '#081018'
          : '#020617';
    const nightHorizonBlend = Math.min(
      0.028,
      0.01 + moonGlowMix * 0.018
    );

    const camZoom =
      typeof map.getZoom === 'function' ? map.getZoom() : 11;
    const camPitch =
      typeof map.getPitch === 'function' ? map.getPitch() : 60;

    /** Bright moon high in sky washes stars; thin crescent / low moon → dense starfield (cinematic). */
    const moonElevWash = moonAboveHorizon
      ? Math.pow(Math.min(1, moonElevDeg / 56), 1.12)
      : 0;
    const moonWashStars = moonFrac * (0.12 + moonElevWash * 0.88);
    const phaseStarBoost = (1 - moonFrac) * 0.18;
    const pitchStarBoost = Math.min(
      0.14,
      Math.max(0, camPitch - 26) * 0.0022
    );
    let starNightScalar = Math.min(
      1,
      Math.max(
        0.6,
        0.98 - moonWashStars * 0.45 + phaseStarBoost + pitchStarBoost
      )
    );

    const starIntensityExpr = [
      'interpolate',
      ['linear'],
      ['zoom'],
      2,
      Math.min(1, starNightScalar * 1.14),
      6,
      Math.min(1, starNightScalar * 1.08),
      10,
      starNightScalar,
      14,
      Math.max(0.6, starNightScalar * 0.96),
      18,
      Math.max(0.6, starNightScalar * 0.88),
    ];

    /** Slightly dim moon disc when stars are maximal so halo does not bloom over the starfield. */
    let nightSkyIntensityUse = nightSkyIntensity;
    if (
      isNight &&
      moonAboveHorizon &&
      starNightScalar >= 0.88 &&
      moonWashStars < 0.35
    ) {
      nightSkyIntensityUse *= 0.9;
    }

    const skySunIntensity = isNight
      ? nightSkyIntensityUse
      : Math.max(0, Math.min(15, (sunAltDeg / 45) * 15));

    /** Sample zoom curve when runtime rejects star-intensity expressions. */
    const starIntensitySampleAtZoom = (z: number, s: number) => {
      const tLo = Math.min(1, s * 1.14);
      const tMid = s;
      const tHi = Math.max(0.6, s * 0.87);
      if (z <= 2) return tLo;
      if (z >= 17.5) return tHi;
      if (z <= 9.5) {
        const u = (z - 2) / (9.5 - 2);
        return tLo + u * (tMid - tLo);
      }
      const u = (z - 9.5) / (17.5 - 9.5);
      return tMid + u * (tHi - tMid);
    };

    /** Night: procedural stars live in fog; base/space tint #020617 so pinpoints read sharp. */
    let fogPack: Record<string, unknown>;
    if (isNight) {
      fogPack = {
        range: [0.8, 8],
        color: '#020617',
        'high-color': nightFogHigh,
        'horizon-blend': nightHorizonBlend,
        'space-color': '#020617',
        'star-intensity': starIntensityExpr,
      };
    } else if (golden) {
      fogPack = {
        range: [0.8, 8],
        color: '#ff9e64',
        'high-color': '#ff9e64',
        'horizon-blend': 0.18,
        'space-color': '#000000',
        'star-intensity': 0.2,
      };
    } else {
      fogPack = {
        range: [0.8, 8],
        color: '#0b0e14',
        'high-color': '#1e293b',
        'horizon-blend': 0.12,
        'space-color': '#000000',
        'star-intensity': 0.15,
      };
    }

    // Simulated weather overrides (debug / prototype) — sandstorm washes distant buildings.
    fogPack = applyWeatherFog(mapWeatherRef.current, fogPack);

    try {
      if (map.getLayer?.('sky')) {
        map.setPaintProperty('sky', 'sky-atmosphere-sun', skySunVec);
        map.setPaintProperty('sky', 'sky-atmosphere-sun-intensity', skySunIntensity);
        map.setPaintProperty('sky', 'sky-atmosphere-color', isNight ? '#020617' : '#0f172a');
        try {
          map.setPaintProperty('sky', 'sky-opacity', 1);
        } catch {
          /* older runtimes */
        }
        try {
          if (isNight) {
            const haloA = Math.max(
              0.12,
              Math.min(0.58, 0.16 + moonFrac * 0.44)
            );
            map.setPaintProperty(
              'sky',
              'sky-atmosphere-halo-color',
              `rgba(224,248,255,${haloA})`
            );
          } else {
            map.setPaintProperty(
              'sky',
              'sky-atmosphere-halo-color',
              'rgba(255,158,100,0.55)'
            );
          }
        } catch {
          /* halo optional */
        }
      }
    } catch {
      // ignore
    }

    try {
      map.setFog?.(fogPack as Parameters<typeof map.setFog>[0]);
    } catch {
      if (isNight) {
        try {
          map.setFog?.({
            range: [0.8, 8],
            color: '#020617',
            'high-color': nightFogHigh,
            'horizon-blend': nightHorizonBlend,
            'space-color': '#020617',
            'star-intensity': starIntensitySampleAtZoom(camZoom, starNightScalar),
          });
        } catch {
          /* ignore */
        }
      }
    }

    try {
      map.setConfigProperty?.('basemap', 'lightPreset', isNight ? 'night' : golden ? 'dawn' : 'day');
    } catch {
      /* Custom vector style may not expose Standard basemap config */
    }

    try {
      if (map.getLayer?.('terrain-hillshade')) {
        const t = moonGlowMix;
        const hillNight =
          isNight && t > 0.03
            ? `rgb(${Math.round(30 + (220 - 30) * t)}, ${Math.round(41 + (245 - 41) * t)}, ${Math.round(59 + (255 - 59) * t)})`
            : isNight
              ? '#1e293b'
              : '#ff9e64';
        map.setPaintProperty('terrain-hillshade', 'hillshade-highlight-color', hillNight);
        if (isNight && t > 0.08) {
          map.setPaintProperty(
            'terrain-hillshade',
            'hillshade-accent-color',
            `rgb(${Math.round(8 + 18 * t)}, ${Math.round(47 + 60 * t)}, ${Math.round(73 + 100 * t)})`
          );
        } else {
          map.setPaintProperty('terrain-hillshade', 'hillshade-accent-color', '#022c22');
        }
      }
    } catch {
      // ignore
    }

    try {
      if (isNight) {
        const moonLightIntensity = Math.min(
          0.82,
          0.22 + moonFrac * 0.52 + moonGlowMix * 0.18
        );
        map.setLight?.({
          anchor: 'map',
          color: '#ecfeff',
          intensity: moonLightIntensity,
          position: [
            1.2 + moonFrac * 0.15,
            ((moonAziDeg % 360) + 360) % 360,
            Math.max(12, Math.min(88, moonSkyPolarDeg)),
          ],
        });
      } else {
        map.setLight?.({
          anchor: 'map',
          color: '#ff9e64',
          intensity: 0.5,
          position: [1.5, 120, 60],
        });
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    updateAtmosphere();
    const id = window.setInterval(updateAtmosphere, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [updateAtmosphere]);

  // Re-apply fog when simulated weather changes.
  useEffect(() => {
    updateAtmosphere();
  }, [mapWeather, updateAtmosphere]);
  // SaaS lead-gen: no 3D funding towers.

  const [selectedLocation, setSelectedLocation] = useState<
    { lat: number; lng: number } | null
  >(selectedCoords || null);
  const [pinLocationContext, setPinLocationContext] = useState<PinLocationContext | null>(null);
  const [pinLocationLoading, setPinLocationLoading] = useState(false);

  // Adaptive UI: task type selected = show form overlay
  const [taskTypeSelected, setTaskTypeSelected] = useState<TaskType | null>(null);
  const [activeFormTrigger, setActiveFormTrigger] = useState<FormTrigger | null>(null);
  const [showLiveMarketFeed, setShowLiveMarketFeed] = useState(false);
  const [showMyOrdersPanel, setShowMyOrdersPanel] = useState(false);
  const [mapDraftPin, setMapDraftPin] = useState<{ lat: number; lng: number } | null>(null);
  const [draftPinMenuExpanded, setDraftPinMenuExpanded] = useState(false);
  const [proofUploadMission, setProofUploadMission] = useState<JobOnMap | null>(null);
  const [taskType, setTaskType] = useState<TaskType>('city');
  const [serviceType, setServiceType] = useState<ServiceType>('home_office');
  const [crowdfundingMode, setCrowdfundingMode] = useState(false);
  const [tokenBid, setTokenBid] = useState(1);
  const [workBudget, setWorkBudget] = useState<number | ''>('');
  const [orderDescription, setOrderDescription] = useState('');
  const [orderPhotos, setOrderPhotos] = useState<File[]>([]);
  const [descriptionPolicyError, setDescriptionPolicyError] = useState<string | null>(null);
  const [photoModerationBusy, setPhotoModerationBusy] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null);
  const [mapToast, setMapToast] = useState<{
    message: string;
    variant: 'error' | 'success' | 'notice';
  } | null>(null);
  const [textWarning, setTextWarning] = useState<string | null>(null);

  const toast = useMemo(
    () => ({
      error: (message: string) => {
        setMapToast({ message, variant: 'error' });
        window.setTimeout(() => setMapToast(null), 3200);
      },
      success: (message: string) => {
        setMapToast({ message, variant: 'success' });
        window.setTimeout(() => setMapToast(null), 3200);
      },
      /** Non-blocking tip (e.g. add WhatsApp in Profile) */
      notice: (message: string) => {
        setMapToast({ message, variant: 'notice' });
        window.setTimeout(() => setMapToast(null), 4500);
      },
    }),
    []
  );

  const resetMissionDraft = useCallback((options?: { keepLocation?: boolean; keepMapDraftPin?: boolean }) => {
    setTokenBid(1);
    setWorkBudget('');
    setActiveFormTrigger(null);
    setCrowdfundingMode(false);
    setPinLocationContext(null);
    setPinLocationLoading(false);
    setOrderDescription('');
    setOrderPhotos([]);
    if (!options?.keepLocation) {
      setSelectedLocation(null);
    }
    if (!options?.keepMapDraftPin) {
      setMapDraftPin(null);
      setDraftPinMenuExpanded(false);
    }
    setPhotoModerationBusy(false);
    setTextWarning(null);
    setOrderError(null);
    setOrderSuccess(null);
    setDescriptionPolicyError(null);
  }, []);

  const openMissionForm = useCallback((trigger: FormTrigger) => {
    setShowLiveMarketFeed(false);
    setShowMyOrdersPanel(false);
    setDraftPinMenuExpanded(false);
    setProofUploadMission(null);
    const draftLoc = mapDraftPin ?? selectedLocation;
    resetMissionDraft({ keepLocation: false, keepMapDraftPin: true });
    if (draftLoc) {
      setSelectedLocation(draftLoc);
      onLocationSelect?.(draftLoc.lat, draftLoc.lng);
    }
    setActiveFormTrigger(trigger);
    const nextTaskType = taskTypeForTrigger(trigger);
    setTaskType(nextTaskType);
    setServiceType(defaultServiceForTrigger(trigger));
    setTaskTypeSelected(nextTaskType);
  }, [mapDraftPin, selectedLocation, resetMissionDraft, onLocationSelect]);

  const formSectorServices = useMemo(
    () => (activeFormTrigger ? servicesForTrigger(activeFormTrigger) : []),
    [activeFormTrigger]
  );

  /** Default pin to map center when the creation form opens (overlay blocks easy re-taps). */
  useEffect(() => {
    if (!taskTypeSelected) return;
    setSelectedLocation((prev) => {
      if (prev) return prev;
      const map = mapInstanceRef.current;
      const center = map?.getCenter?.();
      const lat = Number(center?.lat ?? viewState.latitude);
      const lng = Number(center?.lng ?? viewState.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return prev;
      if (!isInsideEgyptBounds(lng, lat)) return prev;
      return { lat, lng };
    });
  }, [taskTypeSelected, viewState.latitude, viewState.longitude]);

  const resolvePinLocation = useCallback(async (lat: number, lng: number) => {
    setPinLocationLoading(true);
    try {
      const ctx = await reverseGeocodePinLocation(lat, lng, MAPBOX_TOKEN);
      setPinLocationContext(ctx);
    } catch {
      const city = closestMarketplaceCity(lat, lng);
      setPinLocationContext(
        city
          ? { areaName: '', closestCityId: city.id, closestCityNameKey: city.nameKey }
          : null
      );
    } finally {
      setPinLocationLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedLocation) {
      setPinLocationContext(null);
      return;
    }
    void resolvePinLocation(selectedLocation.lat, selectedLocation.lng);
  }, [selectedLocation, resolvePinLocation]);

  const pinLocationPreview = useMemo(() => {
    if (!pinLocationContext) return null;
    return formatPinLocationTag(pinLocationContext, (key) => t(key), t('pinLocationLabel'));
  }, [pinLocationContext, t]);

  const closeFormOverlay = useCallback(() => {
    if (!orderSubmitting) {
      resetMissionDraft({ keepMapDraftPin: true });
      setTaskTypeSelected(null);
    }
  }, [orderSubmitting, resetMissionDraft]);

  const [activeBidCounts, setActiveBidCounts] = useState<Record<string, number>>({});

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [viewerProfile, setViewerProfile] = useState<{
    full_name?: string | null;
    contact_email?: string | null;
    avatar_url?: string | null;
    telegram_username?: string | null;
    role?: string | null;
    token_balance?: number | null;
    subscription_expires_at?: string | null;
  } | null>(null);
  const [leadPhoneVisible, setLeadPhoneVisible] = useState(false);
  const [unlockedLeadPhone, setUnlockedLeadPhone] = useState<string | null>(null);
  const [unlockLeadLoading, setUnlockLeadLoading] = useState(false);
  const [showTokenPackModal, setShowTokenPackModal] = useState(false);
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);
  const [showWorkerSubscriptionGate, setShowWorkerSubscriptionGate] = useState(false);
  const [showVerificationModal, setShowVerificationModal] = useState(false);

  const isExecutorViewer = useMemo(() => {
    const role = String(viewerProfile?.role ?? '').toLowerCase();
    if (role === 'cleaner') return true;
    if (role === 'customer') return false;
    // Backward-compatible fallback (older profiles without role populated).
    const n = String(viewerProfile?.full_name ?? '').toLowerCase();
    const u = String(viewerProfile?.telegram_username ?? '').toLowerCase();
    return n.includes('ahmed') || u === 'ahmed';
  }, [viewerProfile?.role, viewerProfile?.full_name, viewerProfile?.telegram_username]);

  const workerHasActiveSubscription = useMemo(() => {
    const expRaw = viewerProfile?.subscription_expires_at;
    const exp = expRaw ? Date.parse(expRaw) : NaN;
    return Number.isFinite(exp) && Date.now() < exp;
  }, [viewerProfile?.subscription_expires_at]);

  const isPlatformAdminViewer = useMemo(
    () =>
      isPlatformAdmin({
        email: authEmail,
        telegramUsername: viewerProfile?.telegram_username,
        role: viewerProfile?.role,
      }),
    [authEmail, viewerProfile?.telegram_username, viewerProfile?.role]
  );

  const [adminDeleteMissionId, setAdminDeleteMissionId] = useState<string | null>(null);

  const profileAvatarInitial = useMemo(() => {
    const name = String(viewerProfile?.full_name ?? '').trim();
    if (name) return name.charAt(0).toUpperCase();
    const email = String(viewerProfile?.contact_email ?? authEmail ?? '').trim();
    if (email) return email.charAt(0).toUpperCase();
    return null;
  }, [viewerProfile?.full_name, viewerProfile?.contact_email, authEmail]);

  const serviceLabelFromId = useCallback(
    (id: string | null | undefined) => {
      const found = findServiceOption(id);
      if (found) return t(found.labelKey);
      return id ? String(id) : t('serviceHomeOffice');
    },
    [t]
  );

  const serviceTypeForMission = useCallback((m: any): string => {
    const raw = m?.service_type ?? m?.serviceType ?? null;
    return typeof raw === 'string' && raw.length > 0 ? raw : 'home_office';
  }, []);

  const missionHoverTitle = useCallback(
    (job: JobOnMap) => {
      const raw = job.service_type ?? null;
      if (typeof raw === 'string' && raw.trim().length > 0) {
        return serviceLabelFromId(raw.trim());
      }
      if (job.category === 'public') return t('cityCleaning');
      return t('homeCleaning');
    },
    [serviceLabelFromId, t]
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUserId(session?.user?.id ?? null);
      setAuthEmail(session?.user?.email ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUserId(session?.user?.id ?? null);
      setAuthEmail(session?.user?.email ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!currentUserId) {
        if (!cancelled) setViewerProfile(null);
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('full_name, contact_email, avatar_url, telegram_username, role, token_balance, subscription_expires_at')
        .eq('id', currentUserId)
        .maybeSingle();
      if (!cancelled) {
        setViewerProfile({
          full_name: (data as any)?.full_name ?? null,
          contact_email: (data as any)?.contact_email ?? null,
          avatar_url: (data as any)?.avatar_url ?? null,
          telegram_username: (data as any)?.telegram_username ?? null,
          role: (data as any)?.role ?? null,
          token_balance: Number.isFinite(Number((data as any)?.token_balance))
            ? Number((data as any)?.token_balance)
            : null,
          subscription_expires_at: (data as any)?.subscription_expires_at ?? null,
        });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  // Fetch pending and in_progress missions from Supabase
  const fetchMissions = useCallback(async () => {
    const { data, error } = await supabase
      .from('missions')
      .select(`
        id,
        category,
        service_type,
        amount_target,
        expected_price,
        current_funding,
        crowdfunding_mode,
        crowdfunding_expires_at,
        location_lat,
        location_lng,
        status,
        building_id,
        cleaner_id,
        creator_id,
        description,
        photo_urls,
        after_photo_urls,
        created_at,
        started_at,
        completion_lat,
        completion_lng,
        completion_distance_meters,
        creator:profiles!creator_id (
          avatar_url,
          is_verified
        )
      `)
      .in('status', ['pending', 'available', 'funding', 'in_progress', 'review', 'pending_approval'])
      .not('status', 'eq', 'pending_payment')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      console.error(
        'Ошибка загрузки jobs с Supabase:',
        error.message,
        (error as any)?.details || ''
      );
      // Keep the current global feed instead of blanking the map. Wiping to [] on a transient
      // refetch error (e.g. right after creating a task) is what made every other user's pin vanish.
      return;
    }

    const list: JobOnMap[] = (data || [])
      .filter((row: any) => row.status !== 'pending_payment')
      .filter(
        (row: any) =>
          typeof row.location_lat === 'number' &&
          typeof row.location_lng === 'number'
      ) as JobOnMap[];

    setJobs((prev) => {
      const merged = mergeFetchedMissions(prev || [], list);
      jobsRef.current = merged;
      return merged;
    });

    // Fetch active bid counts (pending bids) for marker badges
    try {
      const jobIds = (list || []).map((j) => j.id);
      if (jobIds.length === 0) {
        setActiveBidCounts({});
        return;
      }
      const { data: bidsData } = await supabase
        .from('mission_bids')
        .select('mission_id')
        .in('mission_id', jobIds)
        .eq('status', 'pending');
      const counts: Record<string, number> = {};
      for (const row of (bidsData || []) as any[]) {
        const jid = row.mission_id as string;
        counts[jid] = (counts[jid] || 0) + 1;
      }
      setActiveBidCounts(counts);
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    fetchMissions();
  }, [fetchMissions]);

  useEffect(() => {
    const onMissionCompleted = (event: Event) => {
      const missionId = (event as CustomEvent<{ missionId?: string }>).detail?.missionId;
      if (missionId) {
        setJobs((prev) => {
          const next = prev.filter((j) => j.id !== missionId);
          jobsRef.current = next;
          return next;
        });
        setSelectedMission((prev) => (prev?.id === missionId ? null : prev));
      }
      void fetchMissions();
    };
    window.addEventListener('cleanegypt:mission-completed', onMissionCompleted);
    return () => window.removeEventListener('cleanegypt:mission-completed', onMissionCompleted);
  }, [fetchMissions]);

  useEffect(() => {
    const onMissionDeleted = (event: Event) => {
      const missionId = (event as CustomEvent<{ missionId?: string }>).detail?.missionId;
      if (missionId) {
        setJobs((prev) => {
          const next = prev.filter((j) => j.id !== missionId);
          jobsRef.current = next;
          return next;
        });
        setSelectedMission((prev) => (prev?.id === missionId ? null : prev));
      }
      void fetchMissions();
    };
    window.addEventListener('cleanegypt:mission-deleted', onMissionDeleted);
    return () => window.removeEventListener('cleanegypt:mission-deleted', onMissionDeleted);
  }, [fetchMissions]);

  useEffect(() => {
    const handleFocus = () => fetchMissions();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [fetchMissions]);

  useEffect(() => {
    const onPaymentSuccess = () => {
      // Initial refresh
      fetchMissions();
      // Simple polling to wait for webhook to finish inserting the mission
      setTimeout(() => fetchMissions(), 1500);
      setTimeout(() => fetchMissions(), 4000);
    };
    window.addEventListener('paymentSuccess', onPaymentSuccess);
    return () => window.removeEventListener('paymentSuccess', onPaymentSuccess);
  }, [fetchMissions]);

  // Fly to job location when requested from Profile "View on Map"
  useEffect(() => {
    if (!flyToTarget || !mapRef.current) return;
    const map = mapRef.current.getMap();
    if (!map) return;
    map.flyTo({
      center: [flyToTarget.lng, flyToTarget.lat],
      zoom: 16,
      essential: true,
      duration: 2000,
    });
    onFlyToComplete?.();
  }, [flyToTarget, onFlyToComplete]);

  const PENDING_SUBMIT_KEY = 'cleaneypt_pending_submit';

  // Stripe is the only payment gateway now. Mission creation is token-backed (no redirect flow).

  const [selectedMission, setSelectedMission] = useState<JobOnMap | null>(null);

  const handleUnlockLead = useCallback(async (opts?: { skipSubscriptionCheck?: boolean }) => {
    if (!currentUserId) {
      onRequestAuth?.();
      return;
    }
    if (!opts?.skipSubscriptionCheck) {
      const expRaw = viewerProfile?.subscription_expires_at;
      const exp = expRaw ? new Date(expRaw).getTime() : NaN;
      const active = Number.isFinite(exp) && Date.now() < exp;
      if (!active) {
        setShowWorkerSubscriptionGate(true);
        return;
      }
    }
    const creatorId = selectedMission?.creator_id;
    if (!creatorId) {
      toast.error(t('contactUnavailable'));
      return;
    }
    setUnlockLeadLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('phone_number')
        .eq('id', creatorId)
        .maybeSingle();
      if (error) throw error;
      const phone = String((data as { phone_number?: string | null })?.phone_number ?? '').trim();
      if (!phone) {
        toast.error(t('contactUnavailable'));
        return;
      }
      setUnlockedLeadPhone(phone);
      setLeadPhoneVisible(true);
    } catch (err) {
      console.error('handleUnlockLead', err);
      toast.error(t('unexpectedErrorTryAgain'));
    } finally {
      setUnlockLeadLoading(false);
    }
  }, [
    currentUserId,
    onRequestAuth,
    selectedMission?.creator_id,
    t,
    toast,
    viewerProfile?.subscription_expires_at,
  ]);

  const [mobileTapPulse, setMobileTapPulse] = useState<{ lng: number; lat: number } | null>(null);
  const [sheetDragY, setSheetDragY] = useState(0);
  const sheetTouchStartYRef = React.useRef<number | null>(null);
  const sheetTouchStartTimeRef = React.useRef<number | null>(null);
  const [hoveredPinInfo, setHoveredPinInfo] = useState<{
    lat: number;
    lng: number;
    title: string;
    status: string;
    priceLabel: string;
  } | null>(null);
  const [hoveredPinScreen, setHoveredPinScreen] = useState<{ x: number; y: number } | null>(null);
  const [hallOfFameMission, setHallOfFameMission] = useState<JobOnMap | null>(null);
  const [hallOfFameCleanerName, setHallOfFameCleanerName] = useState<string | null>(null);
  const [hallOfFameHeroes, setHallOfFameHeroes] = useState<string[]>([]);
  const [isAccepting, setIsAccepting] = useState(false);
  const [showBidInput, setShowBidInput] = useState(false);
  const [missionBidAmount, setMissionBidAmount] = useState<string>('');

  /** Keep WebGL map markers visually below modal stack (z-[9999]); dim when any overlay is open. */
  const mapMarkerLayerSuppressed = useMemo(
    () =>
      Boolean(
        selectedMission ||
          hallOfFameMission ||
          taskTypeSelected ||
          showWorkerSubscriptionGate ||
          showSubscriptionModal
      ),
    [
      selectedMission,
      hallOfFameMission,
      taskTypeSelected,
      showWorkerSubscriptionGate,
      showSubscriptionModal,
    ]
  );

  const [selectedRating, setSelectedRating] = useState<number>(0);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [reviewedMissions, setReviewedMissions] = useState<Set<string>>(new Set());
  const [missionBids, setMissionBids] = useState<MissionBidRow[]>([]);
  const [missionBidsLoading, setMissionBidsLoading] = useState(false);
  const [missionBidsError, setMissionBidsError] = useState<string | null>(null);
  const [briefingBidSubmitting, setBriefingBidSubmitting] = useState(false);
  const [assignedWorker, setAssignedWorker] = useState<AssignedWorkerProfile | null>(null);
  const [gpsDistanceMeters, setGpsDistanceMeters] = useState<number | null>(null);
  const [gpsDistanceError, setGpsDistanceError] = useState<string | null>(null);

  const loadMissionBids = useCallback(async (missionId: string) => {
    const { data, error } = await supabase
      .from('mission_bids')
      .select(`
        id,
        mission_id,
        cleaner_id,
        bid_amount,
        status,
        created_at,
        cleaner:profiles!cleaner_id (
          full_name,
          avatar_url,
          rating,
          telegram_username
        )
      `)
      .eq('mission_id', missionId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return (data || []) as MissionBidRow[];
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setMissionBids([]);
      setMissionBidsError(null);
      setGpsDistanceMeters(null);
      setGpsDistanceError(null);
      if (!selectedMission?.id) return;

      setMissionBidsLoading(true);
      try {
        const bids = await loadMissionBids(selectedMission.id);
        if (!cancelled) setMissionBids(bids);
      } catch (e: any) {
        console.error('Mission bids fetch error:', e);
        if (!cancelled) setMissionBidsError(e?.message || 'Failed to load bids.');
      } finally {
        if (!cancelled) setMissionBidsLoading(false);
      }

      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          if (selectedMission.location_lat == null || selectedMission.location_lng == null) return;
          const d = haversineMeters(
            { lat: pos.coords.latitude, lng: pos.coords.longitude },
            { lat: selectedMission.location_lat, lng: selectedMission.location_lng }
          );
          setGpsDistanceMeters(d);
        },
        () => {
          if (!cancelled) setGpsDistanceError('GPS unavailable.');
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [selectedMission?.id, selectedMission?.location_lat, selectedMission?.location_lng, loadMissionBids]);

  useEffect(() => {
    let cancelled = false;
    const cleanerId = selectedMission?.cleaner_id;
    const inProgress = selectedMission?.status === 'in_progress';
    if (!cleanerId || !inProgress) {
      setAssignedWorker(null);
      return;
    }
    void (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, avatar_url, rating, telegram_username')
        .eq('id', cleanerId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error('Assigned worker profile fetch:', error);
        setAssignedWorker(null);
        return;
      }
      setAssignedWorker(data ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMission?.cleaner_id, selectedMission?.status]);

  const missionBriefingBooting = false;

  const clearMissionPinHover = useCallback(() => {
    // Nothing is hovered — bail without touching state (prevents a setState storm on every empty mousemove).
    if (!hoveredMissionIdRef.current) return;
    const map = mapRef.current?.getMap();
    const prevId = hoveredMissionIdRef.current;
    if (map && prevId) {
      try {
        map.setFeatureState({ source: 'mission-pins', id: prevId }, { hover: false });
      } catch {
        /* layer/source may not be ready */
      }
    }
    hoveredMissionIdRef.current = null;
    const canvas = map?.getCanvas();
    if (canvas) canvas.style.cursor = '';
    setHoveredPinInfo(null);
    setHoveredPinScreen(null);
  }, []);

  const applyMissionPinHover = useCallback(
    (job: JobOnMap) => {
      const map = mapRef.current?.getMap();
      if (!map) return;

      const missionId = String(job.id);
      const prevId = hoveredMissionIdRef.current;
      // Already hovering this exact pin — skip all state writes (the tooltip is anchored to the pin,
      // not the cursor, so nothing changes while the mouse moves within the same pin).
      if (prevId === missionId) return;
      if (prevId && prevId !== missionId) {
        try {
          map.setFeatureState({ source: 'mission-pins', id: prevId }, { hover: false });
        } catch {
          /* ignore */
        }
      }
      try {
        map.setFeatureState({ source: 'mission-pins', id: missionId }, { hover: true });
      } catch {
        /* ignore */
      }
      hoveredMissionIdRef.current = missionId;

      const canvas = map.getCanvas();
      if (canvas) canvas.style.cursor = 'pointer';

      const projected = map.project([job.location_lng, job.location_lat]);
      const rect = map.getContainer().getBoundingClientRect();
      setHoveredPinScreen({ x: rect.left + projected.x, y: rect.top + projected.y });
      setHoveredPinInfo({
        lat: job.location_lat,
        lng: job.location_lng,
        title: missionHoverTitle(job),
        status: job.status,
        priceLabel: formatWorkBudgetUsd(missionWorkBudgetUsd(job)),
      });
    },
    [missionHoverTitle]
  );

  const handleMarkerClick = useCallback((job: JobOnMap) => {
    clearMissionPinHover();
    setMapDraftPin(null);
    setSelectedMission(job);
    setShowBidInput(false);
    setMissionBidAmount(String(Math.floor(Number(job.amount_target ?? 0))));
  }, [clearMissionPinHover]);

  /**
   * Bbox hit-test on mission-pins-core (pad in screen px).
   * Primary path: queryRenderedFeatures on the pins layer only (buildings/terrain ignored).
   * Fallback path: at high zoom with 3D terrain + fill-extrusions, Mapbox depth-culls circle
   * features and queryRenderedFeatures returns nothing even though the pin is visually there.
   * In that case we project every eligible mission to screen space and pick the nearest pin
   * within the pad — occlusion-proof.
   */
  const findMissionPinAtPoint = useCallback(
    (point: { x: number; y: number } | undefined, pad = 15): JobOnMap | null => {
      const map = mapRef.current?.getMap();
      if (!map || !point) return null;

      const bbox: [mapboxgl.PointLike, mapboxgl.PointLike] = [
        [point.x - pad, point.y - pad],
        [point.x + pad, point.y + pad],
      ];

      try {
        const hits = map.queryRenderedFeatures(bbox, {
          layers: ['mission-pins-core'],
        });
        const validHit = hits.find(
          (hit) => hit.properties?.mission_id != null && hit.properties.mission_id !== ''
        );
        if (validHit?.properties?.mission_id) {
          const missionId = String(validHit.properties.mission_id);
          const job = (jobsRef.current || []).find((j) => String(j.id) === missionId);
          if (job) return job;
        }
      } catch {
        /* layer may not be registered yet — fall through to projection check */
      }

      // Occlusion-proof fallback: screen-space distance to each eligible pin.
      let best: JobOnMap | null = null;
      let bestDist = Infinity;
      for (const j of jobsRef.current || []) {
        if (!missionEligibleForMapPin(j)) continue;
        if (!Number.isFinite(j.location_lat) || !Number.isFinite(j.location_lng)) continue;
        let projected: { x: number; y: number };
        try {
          projected = map.project([j.location_lng, j.location_lat]);
        } catch {
          continue;
        }
        if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) continue;
        const dx = projected.x - point.x;
        const dy = projected.y - point.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= pad && dist < bestDist) {
          best = j;
          bestDist = dist;
        }
      }
      return best;
    },
    []
  );

  const handleMapClick = useCallback(
    (event: any) => {
      if (Date.now() < pinPlacementCooldownRef.current) return;
      if (orderSubmitting) return;

      // 1. FORGIVING HITBOX DETECTION (15px bbox).
      // Skipped while the creation form is open: the briefing sheet (z-10030) renders
      // BELOW the form overlay (z-10050), so opening it there would be invisible.
      // Taps then reposition the draft pin instead.
      if (!taskTypeSelected) {
        const job = findMissionPinAtPoint(event?.point, 15);
        if (job) {
          handleMarkerClick(job);
          return;
        }
      }

      // 2. Map tap — draft pin first; move pin while creation form is open
      if (!event?.lngLat) return;
      const { lng, lat } = event.lngLat;

      if (!isInsideEgyptBounds(lng, lat)) {
        toast.error(t('geofenceEgyptShelf'));
        return;
      }

      if (taskTypeSelected) {
        setSelectedLocation({ lat, lng });
        setMapDraftPin({ lat, lng });
        setDraftPinMenuExpanded(false);
        setShowLiveMarketFeed(false);
        onLocationSelect?.(lat, lng);
        return;
      }

      setMapDraftPin({ lat, lng });
      setDraftPinMenuExpanded(false);
      setShowLiveMarketFeed(false);
      onLocationSelect?.(lat, lng);
    },
    [findMissionPinAtPoint, handleMarkerClick, onLocationSelect, orderSubmitting, t, taskTypeSelected]
  );

  const handleMapMouseMove = useCallback(
    (event: any) => {
      if (!event?.point) {
        clearMissionPinHover();
        return;
      }

      const job = findMissionPinAtPoint(event.point, 25);
      if (
        job &&
        Number.isFinite(job.location_lat) &&
        Number.isFinite(job.location_lng)
      ) {
        applyMissionPinHover(job);
        return;
      }

      clearMissionPinHover();
    },
    [applyMissionPinHover, clearMissionPinHover, findMissionPinAtPoint]
  );

  // Keep the refs the native canvas listeners read pointed at the freshest closures every render.
  mapClickHandlerRef.current = handleMapClick;
  mapMoveHandlerRef.current = handleMapMouseMove;

  useEffect(() => {
    if (!hoveredPinInfo) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    const projected = map.project([hoveredPinInfo.lng, hoveredPinInfo.lat]);
    const rect = map.getContainer().getBoundingClientRect();
    setHoveredPinScreen({ x: rect.left + projected.x, y: rect.top + projected.y });
  }, [viewState, hoveredPinInfo]);

  /**
   * Native canvas click + mousemove listeners.
   * Bound ONCE when the map finishes loading and delegate to the handler refs, so React re-renders
   * never detach them. This is the single source of truth for pin clicks/hover — react-map-gl's
   * synthetic onClick/onMouseMove are intentionally NOT used (they listen to the same canvas events
   * and only added a redundant second setState per pixel).
   */
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;

    const onCanvasClick = (e: any) => mapClickHandlerRef.current?.(e);
    const onCanvasMove = (e: any) => mapMoveHandlerRef.current?.(e);
    const onLayerEnter = () => {
      const canvas = map.getCanvas();
      if (canvas) canvas.style.cursor = 'pointer';
    };
    const onLayerLeave = () => clearMissionPinHover();

    let layerHandlersBound = false;
    const bindLayerHandlers = () => {
      if (layerHandlersBound || !map.getLayer('mission-pins-core')) return;
      layerHandlersBound = true;
      map.on('mouseenter', 'mission-pins-core', onLayerEnter);
      map.on('mouseleave', 'mission-pins-core', onLayerLeave);
    };

    // Pins must render above 3d-buildings/labels or fill-extrusions hide them at zoom 13+.
    const keepPinLayersOnTop = () => {
      try {
        const layers = map.getStyle()?.layers;
        if (!layers || layers.length === 0) return;
        const order = ['mission-pins-glow', 'mission-pins-core', 'mission-pins-icon'];
        const topIds = layers.slice(-order.length).map((l: { id: string }) => l.id);
        if (order.every((id, i) => topIds[i] === id)) return;
        for (const id of order) {
          if (map.getLayer(id)) map.moveLayer(id);
        }
      } catch {
        /* style may be transitioning */
      }
    };

    map.on('click', onCanvasClick);
    map.on('mousemove', onCanvasMove);
    bindLayerHandlers();
    keepPinLayersOnTop();
    const onIdle = () => {
      bindLayerHandlers();
      keepPinLayersOnTop();
    };
    map.on('idle', onIdle);

    return () => {
      map.off('click', onCanvasClick);
      map.off('mousemove', onCanvasMove);
      map.off('idle', onIdle);
      if (layerHandlersBound && map.getLayer('mission-pins-core')) {
        map.off('mouseenter', 'mission-pins-core', onLayerEnter);
        map.off('mouseleave', 'mission-pins-core', onLayerLeave);
      }
    };
  }, [mapReady, clearMissionPinHover]);

  // Click-to-open leads is handled via marker layers (no funding towers).

  const handleCloseMissionBriefing = useCallback(() => {
    setSelectedMission(null);
    setShowBidInput(false);
    setMissionBidAmount('');
    setLeadPhoneVisible(false);
    setUnlockedLeadPhone(null);
    setSelectedRating(0);
  }, []);

  const handleAdminDeleteMission = useCallback(async () => {
    if (!isPlatformAdminViewer || !selectedMission) return;
    if (!window.confirm(t('adminDeleteMissionConfirm'))) return;
    const missionId = selectedMission.id;
    try {
      setAdminDeleteMissionId(missionId);
      await adminDeleteMission(missionId);
      handleCloseMissionBriefing();
      toast.success(t('adminDeleteMissionSuccess'));
    } catch (err: any) {
      console.error('Admin delete mission error:', err);
      toast.error(err?.message || t('unexpectedErrorTryAgain'));
    } finally {
      setAdminDeleteMissionId(null);
    }
  }, [isPlatformAdminViewer, selectedMission, t, toast, handleCloseMissionBriefing]);


  const handleSubmitReview = useCallback(
    async (rating: number) => {
      if (!selectedMission || !selectedMission.cleaner_id) return;
      if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
        toast.error(t('mapToastRatingRange'));
        return;
      }
      try {
        setIsSubmittingReview(true);
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.user?.id) {
          onRequestAuth?.();
          return;
        }

        const { error } = await supabase.rpc('submit_review', {
          p_mission_id: selectedMission.id,
          p_cleaner_id: selectedMission.cleaner_id,
          p_rating: rating,
        });
        if (error) {
          toast.error(t('mapToastRatingSubmitFailed'));
          return;
        }

        toast.success(t('mapToastRatingThanks'));
        setReviewedMissions((prev) => {
          const next = new Set(prev);
          next.add(selectedMission.id);
          return next;
        });
        setSelectedRating(0);
      } catch (e: any) {
        toast.error(t('mapToastRatingSubmitFailed'));
      } finally {
        setIsSubmittingReview(false);
      }
    },
    [onRequestAuth, selectedMission]
  );

  const placePendingBid = useCallback(
    async (missionId: string, bidAmount: number) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user?.id) {
        onRequestAuth?.();
        return;
      }

      const { error } = await supabase.from('mission_bids').insert({
        mission_id: missionId,
        cleaner_id: user.id,
        bid_amount: floorUsd(bidAmount),
        status: 'pending',
      });
      if (error) {
        throw error;
      }
    },
    [onRequestAuth]
  );

  const refreshMissionBids = useCallback(async () => {
    if (!selectedMission?.id) return;
    try {
      const bids = await loadMissionBids(selectedMission.id);
      setMissionBids(bids);
      setMissionBidsError(null);
    } catch (e: any) {
      console.error('Mission bids refresh error:', e);
      setMissionBidsError(e?.message || 'Failed to load bids.');
    }
  }, [loadMissionBids, selectedMission?.id]);

  const handleBriefingAcceptBid = useCallback(
    async (bid: MissionBidRow) => {
      if (!selectedMission) return;
      const missionValue = Number(bid.bid_amount ?? 0);
      if (!Number.isFinite(missionValue) || missionValue <= 0) return;

      const { data: workerProf, error: workerProfErr } = await supabase
        .from('profiles')
        .select('is_verified')
        .eq('id', bid.cleaner_id)
        .maybeSingle();
      if (workerProfErr) {
        toast.error(workerProfErr.message || t('unexpectedErrorTryAgain'));
        return;
      }
      const homeOk = checkHomeMissionWorkerVerification(
        selectedMission.category,
        workerProf?.is_verified
      );
      if (!homeOk.ok) {
        setShowVerificationModal(true);
        return;
      }

      try {
        const { error: rpcErr } = await supabase.rpc('accept_mission_bid', {
          p_bid_id: bid.id,
        });
        if (rpcErr) throw rpcErr;

        const budgetUsd = Math.max(1, Math.floor(missionValue));
        setSelectedMission((prev) =>
          prev
            ? {
                ...prev,
                status: 'in_progress',
                cleaner_id: bid.cleaner_id,
                expected_price: budgetUsd,
              }
            : prev
        );
        setAssignedWorker(bid.cleaner ?? null);
        setMissionBids([]);

        toast.success(t('mapToastMissionAcceptedProfile'));
        void fetchMissions();
      } catch (e: any) {
        console.error('handleBriefingAcceptBid', e);
        toast.error(e?.message || t('unexpectedErrorTryAgain'));
      }
    },
    [fetchMissions, selectedMission, t, toast]
  );

  const handleBriefingDeclineBid = useCallback(
    async (bidId: string) => {
      try {
        const { error } = await supabase.rpc('reject_mission_bid', { p_bid_id: bidId });
        if (error) throw error;
        await refreshMissionBids();
        void fetchMissions();
      } catch (e: any) {
        console.error('handleBriefingDeclineBid', e);
        toast.error(e?.message || t('unexpectedErrorTryAgain'));
      }
    },
    [fetchMissions, refreshMissionBids, t, toast]
  );

  const handleBriefingContribute = useCallback(
    async (amountUsd: number) => {
      if (!selectedMission) return;
      setBriefingBidSubmitting(true);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.user?.id) {
          onRequestAuth?.();
          return;
        }
        const returnUrl = `${window.location.origin}${window.location.pathname}`;
        const { url } = await startContributionCheckout({
          missionId: selectedMission.id,
          amountUsd,
          successUrl: returnUrl,
          cancelUrl: returnUrl,
        });
        window.location.assign(url);
      } catch (e: any) {
        console.error('handleBriefingContribute', e);
        toast.error(e?.message || t('stripeTopUpError') || t('unexpectedErrorTryAgain'));
        setBriefingBidSubmitting(false);
      }
    },
    [onRequestAuth, selectedMission, t, toast]
  );

  /** After Stripe Checkout redirect: verify payment and apply contribution. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('cf_contribution') !== '1') return;
    const sessionId = params.get('session_id');
    if (!sessionId) return;

    let cancelled = false;
    (async () => {
      try {
        setBriefingBidSubmitting(true);
        const result = await confirmContributionCheckout(sessionId);
        if (cancelled) return;

        // Re-select mission so briefing shows updated funding immediately.
        const { data: missionRow } = await supabase
          .from('missions')
          .select(
            'id, category, service_type, amount_target, expected_price, current_funding, crowdfunding_mode, crowdfunding_expires_at, location_lat, location_lng, status, cleaner_id, creator_id, description, photo_urls, created_at'
          )
          .eq('id', result.mission_id)
          .maybeSingle();

        if (!cancelled && missionRow) {
          const updated: JobOnMap = {
            ...(missionRow as JobOnMap),
            current_funding: result.current_funding,
            status: result.opened_for_bidding
              ? 'available'
              : String((missionRow as JobOnMap).status || 'funding'),
          };
          setSelectedMission(updated);
          setJobs((prev) => {
            const next = (prev || []).map((j) =>
              j.id === updated.id ? { ...j, ...updated } : j
            );
            const exists = next.some((j) => j.id === updated.id);
            const withMission = exists ? next : [updated, ...next];
            jobsRef.current = withMission;
            return withMission;
          });
        }

        toast.success(
          result.opened_for_bidding
            ? t('crowdfundingTargetReached')
            : t('contributionThanks')
        );
        await fetchMissions();
      } catch (e: any) {
        console.error('confirmContributionCheckout', e);
        toast.error(e?.message || t('stripeTopUpError') || t('unexpectedErrorTryAgain'));
      } finally {
        if (!cancelled) setBriefingBidSubmitting(false);
        // Clear query params so refresh does not re-trigger.
        const url = new URL(window.location.href);
        url.searchParams.delete('cf_contribution');
        url.searchParams.delete('session_id');
        window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchMissions, t, toast]);

  const handleBriefingPlaceBid = useCallback(
    async (amountUsd: number) => {
      if (!selectedMission) return;
      setBriefingBidSubmitting(true);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user?.id) {
          onRequestAuth?.();
          return;
        }
        if (selectedMission.creator_id && selectedMission.creator_id === user.id) {
          toast.error(t('mapToastCannotBidOwnMission'));
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('phone_number, is_verified')
          .eq('id', user.id)
          .maybeSingle();
        if (profileError) {
          console.error('Profile check failed:', profileError.message);
        } else {
          const homeOk = checkHomeMissionWorkerVerification(
            selectedMission.category,
            profile?.is_verified
          );
          if (!homeOk.ok) {
            setShowVerificationModal(true);
            return;
          }
        }

        await placePendingBid(selectedMission.id, amountUsd);
        toast.success(t('placeBid'));
        await refreshMissionBids();
        void fetchMissions();
      } catch (e: any) {
        console.error('handleBriefingPlaceBid', e);
        toast.error(t('mapToastBidUnexpectedError'));
      } finally {
        setBriefingBidSubmitting(false);
      }
    },
    [
      fetchMissions,
      onRequestAuth,
      placePendingBid,
      refreshMissionBids,
      selectedMission,
      t,
      toast,
    ]
  );


  const handleCloseHallOfFame = useCallback(() => {
    setHallOfFameMission(null);
    setHallOfFameCleanerName(null);
    setHallOfFameHeroes([]);
  }, []);

  useEffect(() => {
    const loadHallOfFameMeta = async () => {
      if (!hallOfFameMission?.cleaner_id) {
        setHallOfFameCleanerName(null);
        setHallOfFameHeroes([]);
        return;
      }
      try {
        // Load cleaner name (joined via missions -> profiles)
        const { data: missionRow, error: missionErr } = await supabase
          .from('missions')
          .select('id, cleaner:profiles!cleaner_id(full_name, telegram_username)')
          .eq('id', hallOfFameMission.id)
          .maybeSingle();

        if (missionErr) {
          console.error('Failed to load cleaner profile via join', missionErr.message);
        }

        const cleaner = (missionRow as any)?.cleaner as
          | { full_name?: string | null; telegram_username?: string | null }
          | null
          | undefined;
        const cleanerName =
          cleaner?.full_name || cleaner?.telegram_username || 'an Eco-Hero';
        setHallOfFameCleanerName(cleanerName);

        // Load Eco-Hero donors from mission_donors_view
        const { data: donors, error: donorsError } = await supabase
          .from('mission_donors_view')
          .select('donor_name')
          .eq('mission_id', hallOfFameMission.id);

        if (donorsError) {
          console.error('Failed to load mission donors', donorsError.message);
          setHallOfFameHeroes([]);
        } else {
          const names = (donors || [])
            .map((row: any) => row.donor_name)
            .filter((n: any) => typeof n === 'string' && n.trim().length > 0);
          setHallOfFameHeroes(names);
        }
      } catch (e) {
        console.error('Failed to load Hall of Fame metadata', e);
        setHallOfFameCleanerName(null);
        setHallOfFameHeroes([]);
      }
    };
    if (hallOfFameMission) {
      loadHallOfFameMeta();
    }
  }, [hallOfFameMission]);

  const handleSubmitMissionBid = useCallback(async () => {
    if (!selectedMission) return;
    setIsAccepting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user?.id) {
        onRequestAuth?.();
        return;
      }
      if (selectedMission.creator_id && selectedMission.creator_id === user.id) {
        toast.error(t('mapToastCannotBidOwnMission'));
        return;
      }
      const amtUsd = parseIntegerUsdFromInput(String(missionBidAmount || ''));
      if (amtUsd <= 0) {
        toast.error(t('enterPositiveUsdAmount'));
        return;
      }

      // SaaS model: no security deposit — access is subscription/token gated only.
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('phone_number, is_verified')
        .eq('id', user.id)
        .maybeSingle();
      if (profileError) {
        console.error('Profile check failed:', profileError.message);
      } else {
        const homeOk = checkHomeMissionWorkerVerification(
          selectedMission.category,
          profile?.is_verified
        );
        if (!homeOk.ok) {
          setShowVerificationModal(true);
          return;
        }

        if (!profile?.phone_number || String(profile.phone_number).trim().length === 0) {
          toast.notice(t('mapToastWhatsAppProfileTip'));
        }
      }

      await placePendingBid(selectedMission.id, amtUsd);

      handleCloseMissionBriefing();
      void fetchMissions();
    } catch (err: any) {
      toast.error(t('mapToastBidUnexpectedError'));
    } finally {
      setIsAccepting(false);
    }
  }, [
    fetchMissions,
    handleCloseMissionBriefing,
    missionBidAmount,
    onRequestAuth,
    placePendingBid,
    selectedMission,
    t,
    toast.error,
    toast.notice,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrderError(null);
    setOrderSuccess(null);

    const placementTokens = Math.max(1, Math.floor(Number(tokenBid) || 1));
    const budgetRaw = Math.floor(Number(workBudget));
    const minBudget = taskType === 'home' ? HOME_MIN_PRICE : CITY_MIN_PRICE;
    const maxBudget = taskType === 'home' ? HOME_MAX_PRICE : CITY_MAX_PRICE;

    if (!Number.isFinite(budgetRaw) || budgetRaw < minBudget) {
      setOrderError(
        taskType === 'home'
          ? t('homePriceRangeUsd', { min: minBudget, max: maxBudget })
          : t('cityPriceRangeUsd', { min: minBudget, max: maxBudget }),
      );
      return;
    }
    if (budgetRaw > maxBudget) {
      setOrderError(
        taskType === 'home'
          ? t('homePriceRangeUsd', { min: minBudget, max: maxBudget })
          : t('cityPriceRangeUsd', { min: minBudget, max: maxBudget }),
      );
      return;
    }

    if (viewerProfile?.role === 'customer') {
      const tb = Math.floor(Number(viewerProfile?.token_balance ?? 0));
      if (tb < placementTokens) {
        setShowTokenPackModal(true);
        return;
      }
    }

    const location = selectedLocation;
    if (!location) {
      setOrderError(t('tapMapToSetLocation'));
      return;
    }

    const rawDesc = (orderDescription || '').trim().slice(0, MISSION_SHORT_DESCRIPTION_MAX);
    if (rawDesc.length > 0) {
      const policy = validateMissionDescription(rawDesc);
      if (!policy.ok) {
        setOrderError('error' in policy ? policy.error : t('invalidDescription'));
        return;
      }
    }

    const { filteredText } = filterMissionDescription(rawDesc);
    let bodyText = filteredText.trim() || rawDesc;
    if (!bodyText) {
      bodyText = t('leadPinDefaultDescription');
    }
    bodyText = processMissionDescription(bodyText, serviceType);
    let descriptionToSave = bodyText;

    if (pinLocationContext) {
      const locationTag = formatPinLocationTag(
        pinLocationContext,
        (key) => t(key),
        t('pinLocationLabel')
      );
      if (!descriptionToSave.startsWith('📍') && !descriptionToSave.includes(locationTag)) {
        descriptionToSave = `${locationTag}\n\n${descriptionToSave}`;
      }
    }

    try {
      setOrderSubmitting(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user?.id) {
        localStorage.setItem(
          PENDING_SUBMIT_KEY,
          JSON.stringify({
            taskType,
            serviceType,
            location_lat: location.lat,
            location_lng: location.lng,
            description: descriptionToSave || orderDescription || '',
            token_bid: placementTokens,
            expected_price: budgetRaw,
          })
        );
        setOrderSubmitting(false);
        onRequestAuth?.();
        return;
      }

      // Secure backend deduct: token is deducted atomically inside `create_lead_mission_with_token`.

      // 1) Compress and upload creator proof photos (if any)
      let creatorPhotoUrls: string[] | undefined;
      if (orderPhotos.length > 0) {
        setUploadingProof(true);
        const uploaded: string[] = [];
        const compressionOptions = {
          maxSizeMB: 0.4,
          maxWidthOrHeight: 1280,
          useWebWorker: true,
          fileType: 'image/jpeg',
        };
        const compressedFiles: File[] = [];
        for (const file of orderPhotos) {
          if (!file.type || !file.type.startsWith('image/')) {
            setOrderError('Only images are allowed');
            setUploadingProof(false);
            return;
          }
          try {
            const compressed = await imageCompression(file, compressionOptions);
            compressedFiles.push(compressed);
          } catch (err) {
            console.warn('Compression failed for', file.name, err);
            compressedFiles.push(file);
          }
        }
        for (const file of compressedFiles) {
          const safeFileName = `mission_${Date.now()}_${Math.random().toString(36).substring(2)}.jpg`;
          const { error: uploadError } = await supabase.storage
            .from('order-photos')
            .upload(safeFileName, file, { upsert: false, contentType: 'image/jpeg' });
          if (uploadError) {
            throw uploadError;
          }
          const { data: { publicUrl } } = supabase.storage
            .from('order-photos')
            .getPublicUrl(safeFileName);
          uploaded.push(publicUrl);
        }
        creatorPhotoUrls = uploaded;
      }

      // Create lead mission immediately — token-backed.
      const pendingMissionId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `pending-${Date.now()}`;

      const optimisticPending = buildOptimisticLeadMission(
        pendingMissionId,
        serviceType,
        location,
        session.user.id,
        descriptionToSave,
        creatorPhotoUrls,
        viewerProfile,
        placementTokens,
        budgetRaw,
        crowdfundingMode
      );

      setJobs((prev) => {
        const next = [optimisticPending, ...(prev || [])];
        jobsRef.current = next;
        return next;
      });

      const { data: mid, error: leadErr } = await supabase.rpc('create_lead_mission_with_token', {
        p_service_type: serviceType,
        p_location_lat: Number(location.lat),
        p_location_lng: Number(location.lng),
        p_description: descriptionToSave || null,
        p_photo_urls: creatorPhotoUrls || [],
        p_building_id: null,
        p_building_height_m: null,
        p_token_bid: placementTokens,
        p_expected_price: budgetRaw,
        p_crowdfunding_mode:
          crowdfundingMode && isGarbageRemovalService(serviceType),
      });
      if (leadErr) {
        setJobs((prev) => {
          const next = (prev || []).filter((j) => String(j.id) !== pendingMissionId);
          jobsRef.current = next;
          return next;
        });
        console.error('[create_lead_mission_with_token]', leadErr);
        throw new Error(leadErr.message || leadErr.details || 'Mission create failed');
      }

      const missionId = mid != null && String(mid).length > 0 ? String(mid) : pendingMissionId;

      if (missionId !== pendingMissionId) {
        setJobs((prev) => {
          const next = (prev || []).map((j) =>
            String(j.id) === pendingMissionId ? { ...j, id: missionId } : j
          );
          jobsRef.current = next;
          return next;
        });
      }

      // Update local token balance snapshot.
      setViewerProfile((p) =>
        !p
          ? p
          : {
              ...p,
              token_balance:
                Number.isFinite(Number(p.token_balance))
                  ? Math.max(0, Number(p.token_balance) - placementTokens)
                  : p.token_balance,
            }
      );

      pinPlacementCooldownRef.current = Date.now() + 800;
      setTaskTypeSelected(null);
      setTaskType(null);
      resetMissionDraft();
      clearMissionPinHover();
      await fetchMissions();
      toast.success(t('pinPlaced'));
      return;
    } catch (err) {
      console.error('Job submit exception:', err);
      setOrderError(
        err instanceof Error ? err.message : t('unexpectedErrorTryAgain')
      );
    } finally {
      setUploadingProof(false);
      setOrderSubmitting(false);
    }
  };

  // SaaS lead-gen: no crowdfunding heatmap/towers — leads are displayed as pins only.

  /** Purple pulse anchor for missions where the current user is the active cleaner. */
  const activeWorkerPulseGeoJSON = useMemo(() => {
    const features = (jobs || [])
      .filter(missionEligibleForMapPin)
      .filter(
        (j) =>
          j.status === 'in_progress' &&
          !!currentUserId &&
          j.cleaner_id === currentUserId &&
          Number.isFinite(j.location_lat) &&
          Number.isFinite(j.location_lng)
      )
      .map((j) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [j.location_lng, j.location_lat],
        },
        properties: { mission_id: String(j.id) },
      }));
    return { type: 'FeatureCollection' as const, features };
  }, [jobs, currentUserId]);

  /** Service-colored mission pins on the map (always visible in 2D mode). */
  const missionPinsGeoJSON = useMemo(() => {
    const features = (jobs || [])
      .filter(missionEligibleForMapPin)
      .filter((j) => Number.isFinite(j.location_lat) && Number.isFinite(j.location_lng))
      .map((j) => ({
        type: 'Feature' as const,
        id: String(j.id),
        geometry: {
          type: 'Point' as const,
          coordinates: [j.location_lng, j.location_lat],
        },
        properties: {
          mission_id: String(j.id),
          status: j.status,
          service_type: serviceTypeForMission(j),
          category: j.category,
          pin_icon_image: missionPinIconImage(serviceTypeForMission(j), j.category),
        },
      }));
    return { type: 'FeatureCollection' as const, features };
  }, [jobs, serviceTypeForMission]);

  const activeWorkerMission = useMemo(
    () =>
      (jobs || []).find(
        (j) =>
          j.status === 'in_progress' &&
          !!currentUserId &&
          j.cleaner_id === currentUserId &&
          Number.isFinite(j.location_lat) &&
          Number.isFinite(j.location_lng)
      ) ?? null,
    [jobs, currentUserId]
  );

  const myOrdersMissions = useMemo(() => {
    if (!currentUserId) return [] as JobOnMap[];
    return (jobs || [])
      .filter((j) => j.creator_id === currentUserId)
      .sort(
        (a, b) =>
          new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      );
  }, [jobs, currentUserId]);

  const showWorkerMissionBar =
    !taskTypeSelected && !!activeWorkerMission && !proofUploadMission;
  const showDraftPinAvatarHub = !!mapDraftPin && !taskTypeSelected;

  /** Native Mapbox draft dot — only while mission form is open (avatar hub replaces it on the map). */
  const draftPinGeoJSON = useMemo(() => {
    if (showDraftPinAvatarHub) {
      return { type: 'FeatureCollection' as const, features: [] };
    }
    const pin = mapDraftPin ?? (taskTypeSelected ? selectedLocation : null);
    if (!pin) {
      return { type: 'FeatureCollection' as const, features: [] };
    }
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [pin.lng, pin.lat],
          },
          properties: { kind: 'draft' },
        },
      ],
    };
  }, [mapDraftPin, selectedLocation, showDraftPinAvatarHub, taskTypeSelected]);

  /** Mobile tap feedback pulse on mission pin tap. */
  const mobileTapPulseGeoJSON = useMemo(() => {
    if (!mobileTapPulse) return { type: 'FeatureCollection' as const, features: [] };
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [mobileTapPulse.lng, mobileTapPulse.lat] },
          properties: { kind: 'tap' },
        },
      ],
    };
  }, [mobileTapPulse]);

  // SaaS lead-gen: removed funding tower hover interactions.

  const navigateToActiveMission = useCallback(() => {
    if (!activeWorkerMission) return;
    mapRef.current?.flyTo({
      center: [activeWorkerMission.location_lng, activeWorkerMission.location_lat],
      zoom: 16,
      essential: true,
      duration: 1200,
    });
  }, [activeWorkerMission]);

  const openActiveMissionProof = useCallback(() => {
    if (activeWorkerMission) {
      setProofUploadMission(activeWorkerMission);
    }
  }, [activeWorkerMission]);

  const openLiveMarketMission = useCallback((mission: LiveMarketMission) => {
    setShowLiveMarketFeed(false);
    setMapDraftPin(null);
    setSelectedMission(mission as JobOnMap);
    mapRef.current?.flyTo({
      center: [mission.location_lng, mission.location_lat],
      zoom: 16,
      essential: true,
      duration: 1300,
    });
  }, []);

  const openMyOrderMission = useCallback((mission: JobOnMap) => {
    setShowMyOrdersPanel(false);
    setMapDraftPin(null);
    setSelectedMission(mission);
    if (Number.isFinite(mission.location_lat) && Number.isFinite(mission.location_lng)) {
      mapRef.current?.flyTo({
        center: [mission.location_lng, mission.location_lat],
        zoom: 16,
        essential: true,
        duration: 1300,
      });
    }
  }, []);

  const handleOpenMarketFeed = useCallback(() => {
    setShowMyOrdersPanel(false);
    setDraftPinMenuExpanded(false);
    setShowLiveMarketFeed(true);
  }, []);

  const toggleDraftPinMenu = useCallback(() => {
    setDraftPinMenuExpanded((prev) => !prev);
  }, []);

  const showProfileFab =
    !taskTypeSelected && !selectedMission && !proofUploadMission;

  return (
    <div
      className={`w-full h-screen relative bg-black overflow-hidden${
        showProfileFab ? ' ce-map-root--profile-fab' : ''
      }`}
    >
      {/* Mobile-first Mapbox control styling (44x44 hit targets + neon glass). */}
      <style>{`
        .ce-map .mapboxgl-ctrl-group {
          border: 1px solid rgba(34, 211, 238, 0.35);
          background: rgba(2, 6, 23, 0.55);
          backdrop-filter: blur(10px);
          box-shadow: 0 0 18px rgba(0, 229, 255, 0.18);
          border-radius: 14px;
          overflow: hidden;
        }
        .ce-map .mapboxgl-ctrl {
          z-index: 9999;
        }
        .ce-map .mapboxgl-ctrl-group button {
          width: 44px;
          height: 44px;
        }
        .ce-map .mapboxgl-ctrl button.mapboxgl-ctrl-icon {
          filter: drop-shadow(0 0 10px rgba(0, 229, 255, 0.25));
        }
        .ce-map .mapboxgl-marker .draft-pin-action-hub {
          box-sizing: border-box;
          overflow: visible !important;
          z-index: 50;
        }
        .ce-map .mapboxgl-marker .draft-pin-action-hub button {
          max-width: 2.75rem;
          max-height: 2.75rem;
        }
        .ce-map .mapboxgl-marker:has(.draft-pin-action-hub) {
          z-index: 50 !important;
          width: 0 !important;
          height: 0 !important;
          overflow: visible !important;
        }
        .ce-map .mapboxgl-ctrl-bottom-right {
          margin-right: 12px;
          margin-bottom: calc(20px + env(safe-area-inset-bottom));
        }
        @media (max-width: 640px) {
          .ce-map .mapboxgl-ctrl-group {
            border-radius: 10px;
          }
          .ce-map .mapboxgl-ctrl-group button {
            width: 34px;
            height: 34px;
          }
          .ce-map .mapboxgl-ctrl-bottom-right {
            margin-right: 8px;
            margin-bottom: calc(1.25rem + env(safe-area-inset-bottom));
          }
          .ce-map-root--profile-fab .ce-map .mapboxgl-ctrl-bottom-right {
            margin-bottom: calc(5.5rem + env(safe-area-inset-bottom));
          }
        }
        @media (min-width: 641px) {
          .ce-map .mapboxgl-ctrl-bottom-right {
            margin-bottom: 24px;
          }
          .ce-map-root--profile-fab .ce-map .mapboxgl-ctrl-bottom-right {
            margin-bottom: calc(5.75rem + env(safe-area-inset-bottom));
          }
        }
      `}</style>

      {/* Full-screen 3D map — no blocking overlays */}
      <div className="ce-map relative z-0 w-full h-full">
        <MapGL
          ref={mapRef}
          {...viewState}
          projection="globe"
          renderWorldCopies={false}
          antialias
          onMove={(evt) => setViewState(evt.viewState)}
          // 2D mode: pins are interactive, buildings are background only.
          // Click + hover are wired via native map.on(...) listeners (see the mapReady effect),
          // so no synthetic onClick/onMouseMove here.
          interactiveLayerIds={['mission-pins-core']}
          onLoad={(e: any) => {
          const map = e?.target;
          if (!map) return;
          mapInstanceRef.current = map;
          setMapReady(true);

          // Emoji pin icons must exist as style images before the symbol layer draws.
          registerEmojiPinImages(map);
          map.on('styleimagemissing', () => registerEmojiPinImages(map));

          // 3D Terrain + Mountains + realistic horizon.
          // DEM source must exist before `setTerrain`.
          try {
            if (!map.getSource('mapbox-dem')) {
              map.addSource('mapbox-dem', {
                type: 'raster-dem',
                url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
                tileSize: 512,
                maxzoom: 14,
              });
            }
            // Taper exaggeration when zoomed in: at 2.0 the inflated terrain depth-culls
            // mission pins at high zoom (queryRenderedFeatures returns nothing on hover).
            map.setTerrain({
              source: 'mapbox-dem',
              exaggeration: [
                'interpolate',
                ['linear'],
                ['zoom'],
                10,
                2.0,
                14,
                1.3,
                16,
                1.0,
              ],
            });
            // Add hillshade for extra mountain texture as you zoom in.
            if (!map.getLayer('terrain-hillshade')) {
              map.addLayer(
                {
                  id: 'terrain-hillshade',
                  type: 'hillshade',
                  source: 'mapbox-dem',
                  paint: {
                    'hillshade-shadow-color': '#0b0e14',
                    'hillshade-highlight-color': '#ff9e64',
                    'hillshade-accent-color': '#022c22',
                    'hillshade-exaggeration': [
                      'interpolate',
                      ['linear'],
                      ['zoom'],
                      8,
                      0.25,
                      14,
                      0.65,
                    ],
                  },
                },
                'road'
              );
            }
            if (!map.getLayer('sky')) {
              map.addLayer({
                id: 'sky',
                type: 'sky',
                paint: {
                  'sky-type': 'atmosphere',
                  'sky-atmosphere-sun': [0, 90],
                  'sky-atmosphere-sun-intensity': 0,
                  'sky-atmosphere-color': '#020617',
                  'sky-opacity': 1,
                },
              });
            }
          } catch {
            // Fail gracefully if the style/runtime doesn't support terrain/sky.
          }

          // Initial celestial sync as soon as map is ready.
          // (Will also update on interval via updateAtmosphere().)
          try {
            updateAtmosphere();
          } catch {
            // ignore
          }
          map.on?.('moveend', updateAtmosphere);
          let atmosphereCamTimer: ReturnType<typeof setTimeout>;
          const scheduleAtmosphereCamera = () => {
            clearTimeout(atmosphereCamTimer);
            atmosphereCamTimer = setTimeout(() => {
              try {
                updateAtmosphere();
              } catch {
                /* ignore */
              }
            }, 95);
          };
          map.on?.('zoom', scheduleAtmosphereCamera);
          map.on?.('rotate', scheduleAtmosphereCamera);

          const style = map.getStyle?.();
          const waterLikeLayers = (style?.layers || []).filter(
            (layer: any) => typeof layer?.id === 'string' && layer.id.includes('water')
          );
          for (const layer of waterLikeLayers) {
            if (layer.type === 'fill') {
              map.setPaintProperty(layer.id, 'fill-color', '#1a2b3c');
              map.setPaintProperty(layer.id, 'fill-opacity', 0.55);
            }
            if (layer.type === 'line') {
              map.setPaintProperty(layer.id, 'line-color', '#3ecfff');
              map.setPaintProperty(layer.id, 'line-opacity', 0.55);
            }
          }

          // SaaS lead-gen: legacy crowdfunding heatmap removed (2D bubble pins only).

          // Egypt / Orient thematic restyle: sandstone extrusions + sandy roads.
          applyEgyptMapTheme(map, { beforeLayerId: 'place_label' });
          // Neon road layers mount after first paint — re-apply once map is idle.
          map.once?.('idle', () => {
            try {
              applyEgyptMapTheme(map, { beforeLayerId: 'place_label' });
            } catch {
              /* ignore */
            }
          });
        }}
        mapStyle={customDarkStyle}
        mapboxAccessToken={MAPBOX_TOKEN}
        style={{ width: '100%', height: '100%' }}
      >
        <Source id="mapbox-streets" type="vector" url="mapbox://mapbox.mapbox-streets-v8">
          <Layer
            id="neon-roads-glow"
            type="line"
            source-layer="road"
            filter={['in', ['get', 'class'], ['literal', ['motorway', 'primary', 'secondary', 'trunk']]]}
            paint={{
              'line-color': '#E8C39E',
              'line-width': 3.5,
              'line-opacity': 0.22,
              'line-blur': 1.5,
            }}
          />
          <Layer
            id="neon-roads"
            type="line"
            source-layer="road"
            filter={['in', ['get', 'class'], ['literal', ['motorway', 'primary', 'secondary', 'trunk']]]}
            paint={{
              'line-color': '#C2B280',
              'line-width': 1.5,
              'line-opacity': 0.7,
            }}
          />
        </Source>
        <GeolocateControl
          position="bottom-right"
          positionOptions={{ enableHighAccuracy: true }}
          trackUserLocation
        />
        <NavigationControl position="bottom-right" showCompass={false} />

        {/* Mobile tap pulse feedback */}
        <Source id="tap-pulse" type="geojson" data={mobileTapPulseGeoJSON}>
          <Layer
            id="tap-pulse-outer"
            type="circle"
            paint={{
              'circle-radius': 20,
              'circle-color': 'rgba(0,229,255,0.18)',
              'circle-blur': 0.9,
              'circle-opacity': 0.95,
            }}
          />
          <Layer
            id="tap-pulse-inner"
            type="circle"
            paint={{
              'circle-radius': 7,
              'circle-color': '#00e5ff',
              'circle-stroke-width': 2,
              'circle-stroke-color': '#39ff14',
              'circle-opacity': 0.95,
            }}
          />
        </Source>

        {/* Main mission pins — colors driven by service_type GeoJSON property */}
        <Source id="mission-pins" type="geojson" data={missionPinsGeoJSON} promoteId="mission_id">
          <Layer
            id="mission-pins-glow"
            type="circle"
            paint={{
              'circle-radius': MISSION_PIN_GLOW_RADIUS,
              'circle-color': MISSION_PIN_CORE_COLOR,
              'circle-blur': 0.85,
              'circle-opacity': mapMarkerLayerSuppressed ? 0 : 0.35,
            }}
          />
          <Layer
            id="mission-pins-core"
            type="circle"
            paint={{
              'circle-radius': MISSION_PIN_CORE_RADIUS,
              'circle-color': MISSION_PIN_CORE_COLOR,
              'circle-stroke-width': MISSION_PIN_HOVER_STROKE_WIDTH,
              'circle-stroke-color': '#ffffff',
              'circle-opacity': mapMarkerLayerSuppressed ? 0.08 : 0.92,
              'circle-stroke-opacity': mapMarkerLayerSuppressed ? 0.08 : 0.95,
            }}
          />
          <Layer
            id="mission-pins-icon"
            type="symbol"
            layout={{
              'icon-image': ['get', 'pin_icon_image'],
              'icon-size': MISSION_PIN_ICON_SIZE,
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'icon-anchor': 'center',
            }}
            paint={{
              'icon-opacity': mapMarkerLayerSuppressed ? 0 : 1,
            }}
          />
        </Source>

        {/* Draft tap location — native circle only while form is open (avatar hub is the pin otherwise). */}
        {!showDraftPinAvatarHub && draftPinGeoJSON.features.length > 0 && (
        <Source id="draft-pin" type="geojson" data={draftPinGeoJSON}>
          <Layer
            id="draft-pin"
            type="circle"
            filter={['==', ['get', 'kind'], 'draft']}
            paint={{
              'circle-radius': DRAFT_PIN_RADIUS,
              'circle-color': '#00ffff',
              'circle-opacity': mapMarkerLayerSuppressed ? 0.08 : 0.92,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-opacity': mapMarkerLayerSuppressed ? 0.08 : 0.95,
            }}
          />
        </Source>
        )}

        {/* Active worker (your in-progress mission): purple pulse — pillar height is 0 there */}
        <Source id="mission-worker-pulse" type="geojson" data={activeWorkerPulseGeoJSON}>
          <Layer
            id="mission-worker-pulse-outer"
            type="circle"
            minzoom={12}
            paint={{
              'circle-radius': 18,
              'circle-color': 'rgba(168, 85, 247, 0.22)',
              'circle-opacity': mapMarkerLayerSuppressed ? 0 : 0.85,
              'circle-blur': 0.8,
            }}
          />
          <Layer
            id="mission-worker-pulse-inner"
            type="circle"
            minzoom={12}
            paint={{
              'circle-radius': 7,
              'circle-color': '#a855f7',
              'circle-opacity': mapMarkerLayerSuppressed ? 0 : 0.92,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#e9d5ff',
            }}
          />
        </Source>

        {/* SaaS lead-gen: removed crowdfunding/funding 3D pillars. */}

        {showDraftPinAvatarHub && mapDraftPin && (
          <DraftPinActionHub
            lat={mapDraftPin.lat}
            lng={mapDraftPin.lng}
            expanded={draftPinMenuExpanded}
            onToggleExpand={toggleDraftPinMenu}
            avatarUrl={viewerProfile?.avatar_url}
            avatarInitial={profileAvatarInitial}
            onMop={() => openMissionForm('mop')}
            onSponge={() => openMissionForm('sponge')}
            onOpenMarket={handleOpenMarketFeed}
            mopLabel={t('formTitleSpongeStreet')}
            spongeLabel={t('formTitleMopPrivate')}
            marketLabel={t('serviceMarketplace')}
          />
        )}
        </MapGL>

        <WeatherOverlay weather={mapWeather} />

        {weatherDebugOpen ? (
          <WeatherDebugPanel
            weather={mapWeather}
            onChange={setMapWeather}
            onHide={() => {
              setWeatherDebugOpen(false);
              if (!import.meta.env.DEV) setWeatherDebugEnabled(false);
            }}
          />
        ) : (
          <button
            type="button"
            title="Weather debug"
            aria-label="Weather debug"
            onClick={() => {
              setWeatherDebugEnabled(true);
              setWeatherDebugOpen(true);
            }}
            className="pointer-events-auto absolute left-2 top-[max(0.5rem,env(safe-area-inset-top))] z-[40] rounded-md border border-white/10 bg-black/40 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-500/80 opacity-40 hover:opacity-90 hover:text-amber-200"
          >
            WX
          </button>
        )}
      </div>

      <TokenPackModal
        open={showTokenPackModal}
        userId={currentUserId}
        onClose={() => setShowTokenPackModal(false)}
        onSuccess={async () => {
          if (!currentUserId) return;
          const { data } = await supabase
            .from('profiles')
            .select('token_balance')
            .eq('id', currentUserId)
            .maybeSingle();
          setViewerProfile((p) =>
            !p
              ? p
              : {
                  ...p,
                  token_balance: Number.isFinite(Number((data as any)?.token_balance))
                    ? Number((data as any)?.token_balance)
                    : p.token_balance,
                }
          );
        }}
      />

      {/* Worker subscription gate — blurred map stays visible behind slide-up */}
      {showWorkerSubscriptionGate && (
        <div
          className="absolute inset-0 z-[10060] flex items-end justify-center pt-[env(safe-area-inset-top)] pointer-events-none isolate"
          aria-hidden="false"
        >
          <div
            className="absolute inset-0 bg-black/45 backdrop-blur-md pointer-events-auto"
            onClick={() => setShowWorkerSubscriptionGate(false)}
            aria-hidden="true"
          />
          <div
            className="relative z-[1] w-full max-w-xl pointer-events-auto animate-slide-up rounded-t-3xl border-t border-cyan-500/30 bg-slate-950/75 backdrop-blur-xl px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-12px_48px_rgba(34,211,238,0.18)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-white/15 border border-white/10" aria-hidden />
            <p className="text-[10px] font-black uppercase tracking-[0.32em] text-cyan-400">
              {t('subscriptionGateTitle')}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">
              {t('subscriptionGateBody')}
            </p>
            <p className="mt-4 text-3xl font-black text-white">
              {t('subscriptionGatePerYear', { price: formatUsdPrice(YEARLY_SUBSCRIPTION.usd) })}
            </p>
            <ul className="mt-4 space-y-2 text-xs text-slate-300">
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 shrink-0">✓</span>
                <span>{t('saasPerkUnlimitedContacts')}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400 shrink-0">✓</span>
                <span>{t('saasPerkBonusTokens', { tokens: YEARLY_SUBSCRIPTION.bonusTokens })}</span>
              </li>
            </ul>
            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={() => setShowWorkerSubscriptionGate(false)}
                className="flex-1 min-h-[52px] rounded-2xl border border-white/15 bg-black/30 px-4 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-300 transition-all hover:bg-white/5 active:scale-[0.98]"
              >
                {t('close')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowWorkerSubscriptionGate(false);
                  setShowSubscriptionModal(true);
                }}
                className="flex-1 min-h-[52px] rounded-2xl border border-cyan-400/35 bg-cyan-600/90 px-4 text-[11px] font-bold uppercase tracking-[0.16em] text-white shadow-[0_4px_20px_rgba(34,211,238,0.35),inset_0_1px_0_0_rgba(255,255,255,0.12)] transition-all hover:border-cyan-300/50 hover:bg-cyan-500/95 active:scale-[0.98] active:bg-cyan-500"
              >
                {t('saasPaySubscription')}
              </button>
            </div>
          </div>
        </div>
      )}

      <SubscriptionModal
        open={showSubscriptionModal}
        userId={currentUserId}
        onClose={() => {
          setShowSubscriptionModal(false);
          setShowWorkerSubscriptionGate(false);
        }}
        onSuccess={async () => {
          if (!currentUserId) return;
          const { data } = await supabase
            .from('profiles')
            .select('subscription_expires_at')
            .eq('id', currentUserId)
            .maybeSingle();
          const exp = (data as any)?.subscription_expires_at ?? null;
          setViewerProfile((p) =>
            !p
              ? p
              : {
                  ...p,
                  subscription_expires_at: exp ?? p.subscription_expires_at,
                }
          );
          setShowWorkerSubscriptionGate(false);
          if (exp && Date.parse(exp) > Date.now() && selectedMission?.creator_id) {
            void handleUnlockLead({ skipSubscriptionCheck: true });
          }
        }}
      />

      {/* KYC modal — triggered from restricted mission bidding gates */}
      <VerificationModal
        open={showVerificationModal}
        onClose={() => setShowVerificationModal(false)}
        userId={currentUserId}
      />

      {/* Pin hover tooltip — fixed to viewport so it is not clipped or misaligned vs map canvas */}
      {hoveredPinInfo && hoveredPinScreen && !selectedMission && (
        <div
          className="pointer-events-none fixed z-[150]"
          style={{
            left: hoveredPinScreen.x,
            top: hoveredPinScreen.y,
            transform: 'translate(-50%, calc(-100% - 12px))',
          }}
        >
          <div className="rounded-xl bg-slate-950/90 border border-cyan-500/30 px-3 py-2 text-white shadow-lg">
            <p className="text-[10px] font-bold tracking-wide text-cyan-300 leading-snug">
              {hoveredPinInfo.title}
            </p>
            <p className="text-[10px] text-slate-300 mt-1 font-semibold">{hoveredPinInfo.priceLabel}</p>
            <p className="text-[10px] text-slate-400 mt-0.5 capitalize">
              Status: {hoveredPinInfo.status}
            </p>
          </div>
        </div>
      )}

      {showProfileFab && (
        <div className="fixed inset-x-0 bottom-0 z-[10020] flex justify-center pointer-events-none pb-[max(1rem,calc(env(safe-area-inset-bottom)+0.5rem))]">
          <button
            type="button"
            onClick={() => onAvatarClick?.()}
            className="pointer-events-auto flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-cyan-400/60 bg-black/80 backdrop-blur-lg shadow-[0_0_24px_rgba(34,211,238,0.35)] transition-transform active:scale-95"
            aria-label="Profile"
          >
            {viewerProfile?.avatar_url ? (
              <img
                src={viewerProfile.avatar_url}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : profileAvatarInitial ? (
              <span className="text-base font-black text-emerald-300">{profileAvatarInitial}</span>
            ) : (
              <User className="h-6 w-6 text-white/90" aria-hidden />
            )}
          </button>
        </div>
      )}

      {showWorkerMissionBar && activeWorkerMission && (
        <div className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-[10015] flex justify-center px-4 pointer-events-none">
          <ActiveMissionWidget
            mission={activeWorkerMission}
            onNavigate={navigateToActiveMission}
            onUploadProof={openActiveMissionProof}
          />
        </div>
      )}

      {/* Adaptive form — slides up from bottom only after City or Home selected */}
      {taskTypeSelected && (
        <div
          className="absolute inset-0 z-[10050] flex items-end justify-center p-4 pt-[env(safe-area-inset-top)] pointer-events-none isolate"
          aria-hidden="false"
        >
          <div
            className="absolute inset-x-0 bottom-0 top-[45%] bg-gradient-to-t from-black/70 via-black/30 to-transparent backdrop-blur-[2px] pointer-events-none"
            aria-hidden
          />
          <div
            className={`pointer-events-auto relative z-[1] w-full max-w-xl flex flex-col min-h-0 max-h-[calc(100dvh-9rem)] sm:max-h-[75dvh] overflow-hidden animate-slide-up p-4 shadow-2xl ${PROFILE_GLASS_PANEL}`}
            style={{
              marginBottom: isMobile
                ? 'calc(env(safe-area-inset-bottom) + 1rem)'
                : undefined,
            }}
          >
            <form ref={orderFormRef} onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain pl-2 pr-3 pb-3 space-y-4 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20">
              <div className="flex items-center justify-between mb-2">
                <button
                  type="button"
                  onClick={closeFormOverlay}
                  disabled={orderSubmitting}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-200 bg-white/5 border border-white/10 hover:bg-white/10 active:scale-95 transition-all disabled:opacity-40 mr-2"
                >
                  ✕
                </button>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                  {activeFormTrigger === 'sponge'
                    ? t('formTitleMopPrivate')
                    : activeFormTrigger === 'mop'
                      ? t('formTitleSpongeStreet')
                      : taskType === 'city'
                        ? t('cleanCityArea')
                        : t('cleanYourHomeOffice')}
                </p>
              </div>

              {(pinLocationLoading || pinLocationPreview) && (
                <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-2.5">
                  {pinLocationLoading ? (
                    <p className="text-[11px] text-cyan-200/80 animate-pulse">{t('pinLocationResolving')}</p>
                  ) : (
                    <p className="text-[11px] font-medium leading-snug text-cyan-100">{pinLocationPreview}</p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                    {t('serviceTypeLabel')}
                  </label>
                  <select
                    value={serviceType}
                    onChange={(e) => {
                      const next = e.target.value as ServiceType;
                      setServiceType(next);
                      if (!isGarbageRemovalService(next)) setCrowdfundingMode(false);
                    }}
                    className={`w-full ${PROFILE_GLASS_PANEL} px-4 py-2.5 text-sm text-white bg-black/20 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500`}
                  >
                    {formSectorServices.map((s) => (
                      <option key={s.id} value={s.id} className="bg-slate-950">
                        {t(s.labelKey)}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-[10px] text-slate-500 leading-relaxed">
                    {t('pinPlacementBaseRule')}
                  </p>
                  {isGarbageRemovalService(serviceType) && (
                    <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={crowdfundingMode}
                        onChange={(e) => setCrowdfundingMode(e.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-400/50 bg-black/40 text-amber-400 focus:ring-amber-500/40"
                      />
                      <span className="min-w-0">
                        <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-amber-200">
                          {t('crowdfundingModeLabel')}
                        </span>
                        <span className="mt-1 block text-[11px] leading-snug text-slate-400">
                          {t('crowdfundingModeHint')}
                        </span>
                      </span>
                    </label>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                    {t('missionShortDescriptionLabel')}
                  </label>
                  <textarea
                    value={orderDescription}
                    onChange={(e) =>
                      setOrderDescription(e.target.value.slice(0, MISSION_SHORT_DESCRIPTION_MAX))
                    }
                    maxLength={MISSION_SHORT_DESCRIPTION_MAX}
                    rows={3}
                    placeholder={t('missionShortDescriptionPlaceholder')}
                    className={`w-full min-h-[4.5rem] ${PROFILE_GLASS_PANEL} px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500 resize-none ${
                      textWarning ? 'border-b-2 border-dashed border-[#ea580c]' : ''
                    }`}
                  />
                  <p className="mt-2 text-[10px] text-slate-500 leading-relaxed">
                    {t('missionShortDescriptionHint')}
                  </p>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                    {t('missionWorkBudgetLabel')}
                  </label>
                  <input
                    type="number"
                    min={taskType === 'home' ? HOME_MIN_PRICE : CITY_MIN_PRICE}
                    max={taskType === 'home' ? HOME_MAX_PRICE : CITY_MAX_PRICE}
                    step={1}
                    inputMode="numeric"
                    required
                    value={workBudget}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        setWorkBudget('');
                        return;
                      }
                      const n = Math.floor(Number(raw));
                      setWorkBudget(Number.isFinite(n) && n >= 0 ? n : '');
                    }}
                    placeholder={
                      taskType === 'home'
                        ? t('missionWorkBudgetPlaceholderHome', {
                            min: HOME_MIN_PRICE,
                            max: HOME_MAX_PRICE,
                          })
                        : t('missionWorkBudgetPlaceholderCity', {
                            min: CITY_MIN_PRICE,
                            max: CITY_MAX_PRICE,
                          })
                    }
                    className={`w-full ${PROFILE_GLASS_PANEL} px-4 py-2.5 text-sm text-white bg-black/20 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500`}
                  />
                  <p className="mt-2 text-[10px] text-slate-500 leading-relaxed">
                    {t('missionWorkBudgetHint')}
                  </p>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                    {t('missionTokenBidLabel')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={tokenBid}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        setTokenBid(1);
                        return;
                      }
                      const n = Math.floor(Number(raw));
                      setTokenBid(Number.isFinite(n) && n >= 1 ? n : 1);
                    }}
                    className={`w-full ${PROFILE_GLASS_PANEL} px-4 py-2.5 text-sm text-white bg-black/20 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500`}
                  />
                  <p className="mt-2 text-[10px] text-slate-500 leading-relaxed">
                    {t('missionTokenBidHint')}
                  </p>
                  <p className="mt-1 text-xs font-bold text-cyan-300">
                    {t('missionPlacementCost', { count: Math.max(1, Math.floor(Number(tokenBid) || 1)) })}
                  </p>
                </div>
              </div>

              {textWarning && (
                <div
                  className="mt-3 mb-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-sm leading-snug text-yellow-200"
                  role="alert"
                >
                  {textWarning}
                </div>
              )}

              <CreateMission
                taskType={taskType}
                orderDescription={orderDescription}
                setOrderDescription={setOrderDescription}
                orderPhotos={orderPhotos}
                setOrderPhotos={setOrderPhotos}
                onModerationBusy={setPhotoModerationBusy}
                onDescriptionPolicyError={setDescriptionPolicyError}
                onTextWarning={(w) => setTextWarning(w ?? null)}
                hasTextWarning={!!textWarning}
                showDescription={false}
              />

              {(orderError || descriptionPolicyError) && (
                <p className="text-xs text-red-400 font-medium">
                  {orderError || descriptionPolicyError}
                </p>
              )}
              {orderSuccess && (
                <p className="text-xs text-emerald-400 font-medium">{orderSuccess}</p>
              )}
              </div>

              <div className="relative z-20 shrink-0 bg-transparent px-2 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <button
                  type="submit"
                  disabled={orderSubmitting || uploadingProof || photoModerationBusy}
                  className="flex min-h-[52px] w-full touch-manipulation items-center justify-center rounded-2xl border border-cyan-400/35 bg-cyan-600/90 px-4 text-center text-[11px] font-bold uppercase tracking-[0.18em] text-white shadow-[0_4px_20px_rgba(34,211,238,0.35),inset_0_1px_0_0_rgba(255,255,255,0.12)] transition-all hover:border-cyan-300/50 hover:bg-cyan-500/95 active:scale-[0.98] active:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
                >
                  {uploadingProof || orderSubmitting
                    ? t('processing')
                    : t('payAndPlacePin')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      {selectedMission && (
        <MissionBriefing
          mission={selectedMission}
          booting={missionBriefingBooting}
          sheetDragY={sheetDragY}
          currentUserId={currentUserId}
          activeBidCount={activeBidCounts[selectedMission.id] || 0}
          serviceLabel={serviceLabelFromId(serviceTypeForMission(selectedMission))}
          missionBids={missionBids}
          bidsLoading={missionBidsLoading}
          bidsError={missionBidsError}
          isMissionCreator={
            !!currentUserId && !!selectedMission.creator_id && currentUserId === selectedMission.creator_id
          }
          canPlaceBid={
            !!currentUserId &&
            currentUserId !== selectedMission.creator_id &&
            !isCrowdfundingOpen(selectedMission) &&
            OPEN_BID_MISSION_STATUSES.has(String(selectedMission.status || ''))
          }
          bidSubmitting={briefingBidSubmitting}
          onAcceptBid={handleBriefingAcceptBid}
          onDeclineBid={handleBriefingDeclineBid}
          onPlaceBid={handleBriefingPlaceBid}
          canContribute={
            !!currentUserId &&
            currentUserId !== selectedMission.creator_id &&
            isCrowdfundingOpen(selectedMission)
          }
          contributeSubmitting={briefingBidSubmitting}
          onContribute={handleBriefingContribute}
          assignedWorker={assignedWorker}
          gpsDistanceMeters={gpsDistanceMeters}
          gpsDistanceError={gpsDistanceError}
          isExecutorViewer={isExecutorViewer}
          workerHasActiveSubscription={workerHasActiveSubscription}
          leadPhoneVisible={leadPhoneVisible}
          unlockedLeadPhone={unlockedLeadPhone}
          unlockLeadLoading={unlockLeadLoading}
          reviewedMissions={reviewedMissions}
          selectedRating={selectedRating}
          isSubmittingReview={isSubmittingReview}
          onClose={handleCloseMissionBriefing}
          onSheetTouchStart={(e) => {
            sheetTouchStartYRef.current = e.touches?.[0]?.clientY ?? null;
            sheetTouchStartTimeRef.current = Date.now();
          }}
          onSheetTouchMove={(e) => {
            const start = sheetTouchStartYRef.current;
            const y = e.touches?.[0]?.clientY;
            if (start == null || y == null) return;
            const dy = y - start;
            setSheetDragY(dy > 0 ? Math.min(220, dy) : 0);
          }}
          onSheetTouchEnd={() => {
            const dy = sheetDragY;
            const dt =
              (sheetTouchStartTimeRef.current
                ? Date.now() - sheetTouchStartTimeRef.current
                : 0) || 0;
            const shouldClose = dy > 110 || (dy > 70 && dt < 220);
            setSheetDragY(0);
            sheetTouchStartYRef.current = null;
            sheetTouchStartTimeRef.current = null;
            if (shouldClose) handleCloseMissionBriefing();
          }}
          onViewPhotos={() => setHallOfFameMission(selectedMission)}
          onStartWork={() => {
            toast.success(t('mapToastMissionAcceptedProfile'));
            handleCloseMissionBriefing();
            onAvatarClick?.();
          }}
          onUnlockLead={() => void handleUnlockLead()}
          onSubscribe={() => setShowWorkerSubscriptionGate(true)}
          onSubmitReview={handleSubmitReview}
          onSelectRating={setSelectedRating}
          isPlatformAdmin={isPlatformAdminViewer}
          adminDeleteSubmitting={adminDeleteMissionId === selectedMission.id}
          onAdminDeleteMission={() => void handleAdminDeleteMission()}
        />
      )}


      {/* Hall of Fame modal for completed missions */}
      {hallOfFameMission && (
        <div
          className="absolute inset-0 z-[9999] flex items-center justify-center pt-[env(safe-area-inset-top)] isolate"
          aria-hidden="false"
        >
          <div
            className="absolute inset-0 bg-black/85 backdrop-blur-md"
            onClick={handleCloseHallOfFame}
            aria-hidden="true"
          />
          <div
            className="relative w-full max-w-2xl mx-4 rounded-3xl bg-[#020617]/98 backdrop-blur-2xl border border-white/10 shadow-2xl p-6 sm:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <button
                type="button"
                onClick={handleCloseHallOfFame}
                className="p-2 -m-2 mr-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                aria-label="Close"
              >
                ✕
              </button>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-300/80">
                  {t('hallOfFame')}
                </p>
                <h2 className="mt-2 text-lg sm:text-2xl font-extrabold tracking-tight text-white">
                  This place was cleaned by{' '}
                  <span className="text-amber-300">
                    {hallOfFameCleanerName || 'an Eco-Hero'}
                  </span>
                  !
                </h2>
              </div>
            </div>

            {/* Before / After slider */}
            <HallOfFameSlider mission={hallOfFameMission} />

            {/* Eco-Heroes list */}
            <div className="mt-6">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
                Eco-Heroes
              </p>
              {hallOfFameHeroes.length === 0 ? (
                <p className="text-xs text-slate-400">
                  Donations data for this mission will appear here once connected. For now,
                  consider everyone who supported this cleanup an Eco-Hero.
                </p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {hallOfFameHeroes.map((name) => (
                    <li
                      key={name}
                      className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-400/40 text-[11px] text-emerald-300 font-semibold"
                    >
                      {name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {mapToast && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[10000] pointer-events-none max-w-[min(92vw,24rem)]">
          <div
            className={`rounded-xl border px-4 py-2 text-xs font-bold shadow-xl backdrop-blur-sm ${
              mapToast.variant === 'success'
                ? 'border-emerald-400/35 bg-emerald-600/90 text-white'
                : mapToast.variant === 'notice'
                  ? 'border-amber-400/40 bg-amber-950/90 text-amber-100'
                  : 'border-red-300/30 bg-red-500/85 text-white'
            }`}
          >
            {mapToast.message}
          </div>
        </div>
      )}

      <LiveMarketFeed
        open={showLiveMarketFeed}
        onClose={() => setShowLiveMarketFeed(false)}
        onSelectMission={openLiveMarketMission}
        currentUserId={currentUserId}
      />
      <MyOrdersPanel
        open={showMyOrdersPanel}
        onClose={() => setShowMyOrdersPanel(false)}
        missions={myOrdersMissions}
        onSelectMission={openMyOrderMission}
        isLoggedIn={!!currentUserId}
        onRequestAuth={onRequestAuth}
      />
      <ProofUploadModal
        open={!!proofUploadMission}
        mission={proofUploadMission}
        onClose={() => setProofUploadMission(null)}
        onSuccess={async () => {
          await fetchMissions();
          setProofUploadMission(null);
        }}
        toast={toast}
      />

    </div>
  );
};

export default MapPicker;
