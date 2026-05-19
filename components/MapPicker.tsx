import React, { useState, useCallback, useEffect, useMemo } from 'react';
import MapGL, { NavigationControl, GeolocateControl, MapRef, Source, Layer, Popup } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import imageCompression from 'browser-image-compression';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import SunCalc from 'suncalc';
import { supabase } from '../services/supabase';
import { Recycle, Navigation, Camera, X, Clock } from 'lucide-react';
import TrustDepositInfoModal from './TrustDepositInfoModal';
import LiveMarketFeed, { type LiveMarketMission } from './LiveMarketFeed';
import {
  workerCanSecureMissionDeposit,
  isSecurityDepositFailure,
  checkHomeMissionWorkerVerification,
} from '../src/lib/trustDeposit';
import CreateMission from './CreateMission';
import type { PhotoVerificationState } from './CreateMission';
import {
  validateMissionDescription,
  filterMissionDescription,
} from '../src/lib/missionContentPolicy';
import {
  PROFILE_GLASS_PANEL,
  HOME_MIN_PRICE,
  HOME_MAX_PRICE,
  CITY_MIN_PRICE,
  CITY_MAX_PRICE,
  SCOUT_STAKE_FEE_EGP,
} from '../constants';
import { formatEgp, formatEgpDigits } from '../src/lib/formatMoney';
import { profileWalletBalanceEgp } from '../src/lib/walletCredit';
import { floorEgp, parseIntegerEgpFromInput, sanitizeIntegerEgpDigits } from '../src/lib/integerEgpInput';
import { fetchUsdToEgpRate } from '../src/lib/platformSettings';
import ModeratedMissionPhoto from './ModeratedMissionPhoto';
import TokenPackModal from '../src/components/TokenPackModal';
import SubscriptionModal from '../src/components/SubscriptionModal';

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

type TaskType = 'city' | 'home';

type ServiceType =
  | 'home_office'
  | 'ac_cleaning'
  | 'pool_maintenance'
  | 'pest_control'
  | 'windows_facades'
  | 'terrace_garden'
  | 'car_detailing'
  | 'yacht_boat_cleaning'
  | 'solar_panels'
  | 'ultrasound_cleaning'
  | 'carpets_mattresses'
  | 'kitchen_hoods_grease'
  | 'laundry_ironing'
  | 'water_tank_cleaning'
  | 'junk_removal';

const CLEAN_WHEEL_SERVICES: { id: ServiceType; labelKey: string }[] = [
  { id: 'home_office', labelKey: 'serviceHomeOffice' },
  { id: 'ac_cleaning', labelKey: 'serviceAcCleaning' },
  { id: 'pool_maintenance', labelKey: 'servicePoolMaintenance' },
  { id: 'pest_control', labelKey: 'servicePestControl' },
  { id: 'windows_facades', labelKey: 'serviceWindowsFacades' },
  { id: 'terrace_garden', labelKey: 'serviceTerraceGarden' },
  { id: 'car_detailing', labelKey: 'serviceCarDetailing' },
  { id: 'yacht_boat_cleaning', labelKey: 'serviceYachtBoatCleaning' },
  { id: 'solar_panels', labelKey: 'serviceSolarPanels' },
  { id: 'ultrasound_cleaning', labelKey: 'serviceUltrasoundCleaning' },
  { id: 'carpets_mattresses', labelKey: 'serviceCarpetsMattresses' },
  { id: 'kitchen_hoods_grease', labelKey: 'serviceKitchenHoodsGrease' },
  { id: 'laundry_ironing', labelKey: 'serviceLaundryIroning' },
  { id: 'water_tank_cleaning', labelKey: 'serviceWaterTankCleaning' },
  { id: 'junk_removal', labelKey: 'serviceJunkRemoval' },
];

interface JobOnMap {
  id: string;
  category: 'public' | 'home' | 'office' | string;
  amount_target: number;
  current_funding?: number | null;
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

interface MissionTransactionRow {
  id: string;
  user_id: string | null;
  mission_id?: string | null;
  amount: number;
  type: string;
  gateway?: string | null;
  created_at: string;
}

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
          {formatEgp(Number(mission.amount_target ?? 0))}
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

function CreatorMissionWidget({
  mission,
  onClose,
}: {
  mission: JobOnMap;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const started = mission.started_at ? new Date(mission.started_at).getTime() : NaN;
  const created = mission.created_at ? new Date(mission.created_at).getTime() : NaN;
  const anchor = Number.isFinite(started) ? started : created;
  const endAt = Number.isFinite(anchor) ? anchor + 2 * 60 * 60 * 1000 : NaN;
  const msLeft = Number.isFinite(endAt) ? Math.max(0, endAt - now) : 0;
  const mins = Math.floor(msLeft / 60000);
  const secs = Math.floor((msLeft % 60000) / 1000);

  return (
    <motion.div
      initial={{ y: 28, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 20, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      className={`pointer-events-auto relative w-full max-w-xl rounded-3xl p-4 ${PROFILE_GLASS_PANEL} border border-orange-500/35 shadow-[0_0_28px_rgba(249,115,22,0.2)]`}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute -right-1 -top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-white/15 bg-black/50 text-[10px] font-bold leading-none text-slate-400 shadow-sm hover:border-cyan-500/45 hover:text-cyan-200 hover:shadow-[0_0_10px_rgba(34,211,238,0.35)] transition-all"
        aria-label="Dismiss"
      >
        ✕
      </button>
      <div className="flex items-center justify-between gap-3">
        <p className="text-lg font-black text-orange-300 tabular-nums">
          {formatEgp(Number(mission.amount_target ?? 0))}
        </p>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-300 tabular-nums">
          {`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`}
        </p>
        <div
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-cyan-500/55 bg-cyan-500/10 text-cyan-300 shadow-[0_0_14px_rgba(34,211,238,0.4)]"
          role="img"
          aria-label={t('waiting')}
        >
          <Clock className="h-4 w-4" strokeWidth={2.25} />
        </div>
      </div>
      <div className="mt-3 w-full rounded-full px-6 py-3 text-center text-sm font-black uppercase tracking-[0.2em] text-orange-200 border border-orange-500/60 bg-orange-500/15 hover:bg-orange-500/25 hover:shadow-[0_0_20px_rgba(249,115,22,0.35)] transition-all">
        {t('orderNumber')} {mission.id.slice(0, 8)} - {t('status')}: {t('waiting')} / {t('accepted')}
      </div>
    </motion.div>
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
      toast.error('Please add at least one after photo.');
      return;
    }
    setSubmitting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        toast.error('Please sign in first.');
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

      const { error: updateError } = await supabase
        .from('missions')
        .update({
          after_photo_urls: uploadedUrls,
          status: 'review',
          report_submitted_at: new Date().toISOString(),
        })
        .eq('id', mission.id)
        .eq('cleaner_id', session.user.id)
        .eq('status', 'in_progress');
      if (updateError) throw updateError;

      toast.success('Proof uploaded! Tokens will be credited after quick review.');
      await onSuccess();
      onClose();
      setFiles([]);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to upload proof. Try again.');
    } finally {
      setSubmitting(false);
    }
  }, [files, mission, onClose, onSuccess, toast]);

  return (
    <AnimatePresence>
      {open && mission && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[150] bg-black/85 backdrop-blur-md pointer-events-auto"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 28, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
            className={`absolute inset-x-3 bottom-3 mx-auto max-w-2xl rounded-3xl p-5 ${PROFILE_GLASS_PANEL}`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-2xl sm:text-3xl font-black uppercase tracking-[0.12em] text-orange-300">
                MISSION ACCOMPLISHED?
              </h3>
              <button
                type="button"
                onClick={onClose}
                className="h-8 w-8 rounded-full border border-white/20 text-slate-300 hover:text-white"
              >
                ✕
              </button>
            </div>

            <label className="mt-4 block w-full cursor-pointer rounded-2xl border-2 border-dashed border-cyan-400/65 bg-cyan-500/5 p-8 text-center hover:bg-cyan-500/10 transition-all">
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
                <p className="mt-3 text-xs text-emerald-300 font-semibold">{files.length} photo(s) selected</p>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {previewUrls.map((url, idx) => (
                    <div
                      key={`${url}-${idx}`}
                      className="relative overflow-hidden rounded-xl border border-cyan-500/35 bg-black/50 shadow-[0_0_12px_rgba(34,211,238,0.15)]"
                    >
                      <img src={url} alt={`Proof ${idx + 1}`} className="h-28 w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeFileAt(idx)}
                        className="absolute top-1.5 right-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full border border-red-400/70 bg-red-500/25 text-red-100 hover:bg-red-500/35 hover:shadow-[0_0_12px_rgba(248,113,113,0.55)] transition-all"
                        aria-label="Remove image"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            <button
              type="button"
              onClick={submitProof}
              disabled={submitting || files.length === 0}
              className="mt-5 w-full rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.2em] text-orange-100 border border-orange-500/70 bg-orange-500/20 hover:bg-orange-500/30 hover:shadow-[0_0_24px_rgba(249,115,22,0.45)] disabled:opacity-60"
            >
              {submitting ? 'SUBMITTING...' : 'SUBMIT PROOF & GET PAID'}
            </button>
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
        'line-color': '#ffffff',
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          0.4,
          16,
          2.5,
        ],
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

  /** When true, next home submit uses wallet instead of card checkout. */
  const orderFormWalletPayRef = React.useRef(false);
  /** Creator wallet (tokens) for legacy flows. */
  const [creatorWalletEgp, setCreatorWalletEgp] = useState<number | null>(null);
  const [viewState, setViewState] = useState({
    latitude: 27.2579,
    longitude: 33.8116,
    zoom: 12,
    pitch: 60,
    bearing: -20,
  });

  const [jobs, setJobs] = useState<JobOnMap[]>([]);

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
  // SaaS lead-gen: no 3D funding towers.

  const [selectedLocation, setSelectedLocation] = useState<
    { lat: number; lng: number } | null
  >(selectedCoords || null);

  // Adaptive UI: task type selected = show form overlay
  const [taskTypeSelected, setTaskTypeSelected] = useState<TaskType | null>(null);
  const [dashboardExpanded, setDashboardExpanded] = useState(false);
  const [showLiveMarketFeed, setShowLiveMarketFeed] = useState(false);
  const [showCreatorStatusPanel, setShowCreatorStatusPanel] = useState(false);
  const [proofUploadMission, setProofUploadMission] = useState<JobOnMap | null>(null);
  const [taskType, setTaskType] = useState<TaskType>('city');
  const [orderAmount, setOrderAmount] = useState('');
  const [serviceType, setServiceType] = useState<ServiceType>('home_office');
  const [pinPlacementFeeEgp, setPinPlacementFeeEgp] = useState<number>(floorEgp(55));
  const [orderDescription, setOrderDescription] = useState('');
  const [orderPhotos, setOrderPhotos] = useState<File[]>([]);
  const [descriptionPolicyError, setDescriptionPolicyError] = useState<string | null>(null);
  const [photoVerification, setPhotoVerification] = useState<PhotoVerificationState>({
    verifying: false,
    allApproved: true,
    hasRejected: false,
  });
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

  // SaaS lead-gen: fixed pin placement fee ($1) converted to tokens using platform rate.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const rate = await fetchUsdToEgpRate(supabase);
      const tokens = floorEgp(rate * 1);
      if (!cancelled) setPinPlacementFeeEgp(tokens > 0 ? tokens : floorEgp(55));
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectTaskType = useCallback((type: TaskType) => {
    setDashboardExpanded(false);
    setShowLiveMarketFeed(false);
    setShowCreatorStatusPanel(false);
    setProofUploadMission(null);
    setTaskType(type);
    setTaskTypeSelected(type);
    setOrderError(null);
    setOrderSuccess(null);
    setDescriptionPolicyError(null);
  }, []);

  const closeFormOverlay = useCallback(() => {
    if (!orderSubmitting) {
      setTaskTypeSelected(null);
      setOrderError(null);
      setOrderSuccess(null);
      setDescriptionPolicyError(null);
    }
  }, [orderSubmitting]);

  useEffect(() => {
    if (!taskTypeSelected) return;
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        if (!cancelled) setCreatorWalletEgp(null);
        return;
      }
      const { data: p } = await supabase
        .from('profiles')
        .select('wallet_balance')
        .eq('id', session.user.id)
        .maybeSingle();
      if (!cancelled) setCreatorWalletEgp(profileWalletBalanceEgp(p?.wallet_balance));
    })();
    return () => {
      cancelled = true;
    };
  }, [taskTypeSelected]);

  // Bidding modal state
  const [bidJob, setBidJob] = useState<JobOnMap | null>(null);
  const [bidAmount, setBidAmount] = useState('');
  const [bidSubmitting, setBidSubmitting] = useState(false);
  const [bidError, setBidError] = useState<string | null>(null);
  const [bidSuccess, setBidSuccess] = useState<string | null>(null);

  // SaaS lead-gen: bid/close-deal previews are deprecated; keep null to avoid TS errors in disabled legacy blocks.
  const bidModalFundingGapPreview: any = null;
  const missionBidFundingGapPreview: any = null;

  const [activeBidCounts, setActiveBidCounts] = useState<Record<string, number>>({});

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [viewerProfile, setViewerProfile] = useState<{
    full_name?: string | null;
    telegram_username?: string | null;
    role?: string | null;
    token_balance?: number | null;
    subscription_expires_at?: string | null;
  } | null>(null);
  const [executorSubscribed, setExecutorSubscribed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('leadgen_subscribed') === '1';
    } catch {
      return false;
    }
  });
  const [leadPhoneVisible, setLeadPhoneVisible] = useState(false);
  const [showTokenPackModal, setShowTokenPackModal] = useState(false);
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);

  const availableLeadsCount = useMemo(() => {
    return (jobs || []).filter((j) => j.status === 'available').length;
  }, [jobs]);

  const [onlineExecutors, setOnlineExecutors] = useState<number>(() => {
    return Math.floor(12 + Math.random() * (48 - 12 + 1));
  });

  useEffect(() => {
    const tick = () => setOnlineExecutors(Math.floor(12 + Math.random() * (48 - 12 + 1)));
    const id = window.setInterval(tick, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  const isExecutorViewer = useMemo(() => {
    const role = String(viewerProfile?.role ?? '').toLowerCase();
    if (role === 'cleaner') return true;
    if (role === 'customer') return false;
    // Backward-compatible fallback (older profiles without role populated).
    const n = String(viewerProfile?.full_name ?? '').toLowerCase();
    const u = String(viewerProfile?.telegram_username ?? '').toLowerCase();
    return n.includes('ahmed') || u === 'ahmed';
  }, [viewerProfile?.role, viewerProfile?.full_name, viewerProfile?.telegram_username]);

  const serviceLabelFromId = useCallback(
    (id: string | null | undefined) => {
      const found = CLEAN_WHEEL_SERVICES.find((s) => s.id === id);
      if (found) return t(found.labelKey);
      return id ? String(id) : t('serviceHomeOffice');
    },
    [t]
  );

  const serviceTypeForMission = useCallback((m: any): string => {
    const raw = m?.service_type ?? m?.serviceType ?? null;
    return typeof raw === 'string' && raw.length > 0 ? raw : 'home_office';
  }, []);

  const handleUnlockLead = useCallback(() => {
    if (!currentUserId) {
      onRequestAuth?.();
      return;
    }
    const expRaw = viewerProfile?.subscription_expires_at;
    const exp = expRaw ? new Date(expRaw).getTime() : NaN;
    const active = Number.isFinite(exp) && Date.now() < exp;
    if (!active) {
      setShowSubscriptionModal(true);
      return;
    }
    setLeadPhoneVisible(true);
  }, [currentUserId, onRequestAuth, viewerProfile?.subscription_expires_at]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) =>
      setCurrentUserId(session?.user?.id ?? null)
    );
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUserId(session?.user?.id ?? null);
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
        .select('full_name, telegram_username, role, token_balance, subscription_expires_at')
        .eq('id', currentUserId)
        .maybeSingle();
      if (!cancelled) {
        setViewerProfile({
          full_name: (data as any)?.full_name ?? null,
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

  useEffect(() => {
    const onStorage = () => {
      try {
        setExecutorSubscribed(localStorage.getItem('leadgen_subscribed') === '1');
      } catch {
        // ignore
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Fetch pending and in_progress missions from Supabase
  const fetchMissions = useCallback(async () => {
    const { data, error } = await supabase
      .from('missions')
      .select(`
        id,
        category,
        amount_target,
        current_funding,
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
          phone_number,
          is_verified
        )
      `)
      .in('status', ['pending', 'available', 'funding', 'in_progress', 'completed'])
      .not('status', 'eq', 'pending_payment')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      console.error(
        'Ошибка загрузки jobs с Supabase:',
        error.message,
        (error as any)?.details || ''
      );
      setJobs([]);
      return;
    }

    const list: JobOnMap[] = (data || [])
      .filter((row: any) => row.status !== 'pending_payment')
      .filter(
        (row: any) =>
          typeof row.location_lat === 'number' &&
          typeof row.location_lng === 'number'
      ) as JobOnMap[];

    setJobs(list);

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
  const [mobileTapPulse, setMobileTapPulse] = useState<{ lng: number; lat: number } | null>(null);
  const [sheetDragY, setSheetDragY] = useState(0);
  const sheetTouchStartYRef = React.useRef<number | null>(null);
  const sheetTouchStartTimeRef = React.useRef<number | null>(null);
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [isTranslationLoading, setIsTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [showTranslateAction, setShowTranslateAction] = useState(false);
  const [hoveredPinInfo, setHoveredPinInfo] = useState<{
    lat: number;
    lng: number;
    title: string;
    status: string;
    priceLabel: string;
  } | null>(null);
  const [hallOfFameMission, setHallOfFameMission] = useState<JobOnMap | null>(null);
  const [hallOfFameCleanerName, setHallOfFameCleanerName] = useState<string | null>(null);
  const [hallOfFameHeroes, setHallOfFameHeroes] = useState<string[]>([]);
  const [isAccepting, setIsAccepting] = useState(false);
  /** Worker wallet + frozen (tokens) for security deposit checks on the selected mission. */
  const [workerTrustSnapshot, setWorkerTrustSnapshot] = useState<{
    wallet: number;
    frozen: number;
    isVerified: boolean;
  } | null>(null);
  const [showBidInput, setShowBidInput] = useState(false);
  const [missionBidAmount, setMissionBidAmount] = useState<string>('');
  const [showCrowdfundConfirm, setShowCrowdfundConfirm] = useState(false);
  const [crowdfundBidAmount, setCrowdfundBidAmount] = useState<number | null>(null);
  /** User-entered tokens for "close deal" co-fund (any positive amount, not tied to gap) */
  const [crowdfundCoFundInput, setCrowdfundCoFundInput] = useState('');
  const [showDonate, setShowDonate] = useState(false);
  const [donateAmount, setDonateAmount] = useState<string>('');
  const [donating, setDonating] = useState(false);
  const [trustDepositInfoOpen, setTrustDepositInfoOpen] = useState(false);

  /** Keep WebGL map markers visually below modal stack (z-[9999]); dim when any overlay is open. */
  const mapMarkerLayerSuppressed = useMemo(
    () =>
      Boolean(
        bidJob ||
          selectedMission ||
          showCrowdfundConfirm ||
          hallOfFameMission ||
          taskTypeSelected ||
          trustDepositInfoOpen
      ),
    [
      bidJob,
      selectedMission,
      showCrowdfundConfirm,
      hallOfFameMission,
      taskTypeSelected,
      trustDepositInfoOpen,
    ]
  );

  const detectLikelyLanguage = (text: string): 'ar' | 'ru' | 'en' => {
    if (/[\u0600-\u06FF]/.test(text)) return 'ar';
    if (/[\u0400-\u04FF]/.test(text)) return 'ru';
    return 'en';
  };

  const appLanguage = (i18n.language || 'en').split('-')[0];

  const translateMissionDescription = useCallback(async (text: string) => {
    try {
      setIsTranslationLoading(true);
      setTranslationError(null);
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, targetLanguage: appLanguage }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Translate failed');
      }
      const payload = (await res.json()) as { translation?: string };
      setTranslatedText(payload.translation || null);
    } catch (e) {
      console.error('Mission description translation error:', e);
      setTranslatedText(null);
      setTranslationError('Translation failed. Try again.');
    } finally {
      setIsTranslationLoading(false);
    }
  }, [appLanguage]);

  const [selectedRating, setSelectedRating] = useState<number>(0);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [reviewedMissions, setReviewedMissions] = useState<Set<string>>(new Set());
  const [missionTransactions, setMissionTransactions] = useState<MissionTransactionRow[]>([]);
  const [missionTxLoading, setMissionTxLoading] = useState(false);
  const [missionTxError, setMissionTxError] = useState<string | null>(null);
  const [gpsDistanceMeters, setGpsDistanceMeters] = useState<number | null>(null);
  const [gpsDistanceError, setGpsDistanceError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!selectedMission) {
      setWorkerTrustSnapshot(null);
      return;
    }
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        if (!cancelled) setWorkerTrustSnapshot(null);
        return;
      }
      const { data: p } = await supabase
        .from('profiles')
        .select('wallet_balance, frozen_balance, is_verified')
        .eq('id', session.user.id)
        .maybeSingle();
      if (!cancelled)
        setWorkerTrustSnapshot({
          wallet: Number(p?.wallet_balance ?? 0),
          frozen: Number(p?.frozen_balance ?? 0),
          isVerified: !!p?.is_verified,
        });
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMission?.id]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setMissionTransactions([]);
      setMissionTxError(null);
      setGpsDistanceMeters(null);
      setGpsDistanceError(null);
      if (!selectedMission?.id) return;

      setMissionTxLoading(true);
      try {
        const { data, error } = await supabase
          .from('transactions')
          .select(`
            id, 
            user_id, 
            mission_id, 
            amount, 
            type, 
            gateway, 
            created_at,
            profile:profiles!user_id (
              full_name,
              avatar_url
            )
          `)
          .eq('mission_id', selectedMission.id)
          .order('created_at', { ascending: false })
          .limit(200);
        if (error) throw error;
        if (!cancelled) setMissionTransactions((data || []) as MissionTransactionRow[]);
      } catch (e: any) {
        console.error('Mission transactions fetch error:', e);
        if (!cancelled) setMissionTxError(e?.message || 'Failed to load mission transactions.');
      } finally {
        if (!cancelled) setMissionTxLoading(false);
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
  }, [selectedMission?.id, selectedMission?.location_lat, selectedMission?.location_lng]);

  const potentialCardingUserIds = (() => {
    const SMALL_EGP_MAX = 100;
    const WINDOW_MS = 10 * 60 * 1000;
    const MIN_COUNT = 4;
    const now = Date.now();
    const recent = missionTransactions.filter((tx) => {
      const ts = new Date(tx.created_at).getTime();
      return Number.isFinite(ts) && now - ts <= WINDOW_MS;
    });
    const counts: Record<string, number> = {};
    for (const tx of recent) {
      const uid = tx.user_id || '';
      if (!uid) continue;
      const amt = Number(tx.amount);
      if (!Number.isFinite(amt) || amt <= 0 || amt > SMALL_EGP_MAX) continue;
      counts[uid] = (counts[uid] || 0) + 1;
    }
    return new Set(Object.entries(counts).filter(([, c]) => c >= MIN_COUNT).map(([uid]) => uid));
  })();

  const missionBriefingBooting =
    !!selectedMission &&
    missionTxLoading &&
    missionTransactions.length === 0 &&
    !missionTxError;

  const handleMarkerClick = useCallback((job: JobOnMap) => {
    setSelectedMission(job);
    setShowBidInput(false);
    setMissionBidAmount(String(Math.floor(Number(job.amount_target ?? 0))));
  }, []);

  /** 15px bbox hit-test on mission pin layers (same logic for click + hover). */
  const findMissionPinAtPoint = useCallback((point: { x: number; y: number } | undefined): JobOnMap | null => {
    const map = mapRef.current?.getMap();
    if (!map || !point) return null;

    const pad = 15;
    const bbox: [[number, number], [number, number]] = [
      [point.x - pad, point.y - pad],
      [point.x + pad, point.y + pad],
    ];

    const hits = map.queryRenderedFeatures(bbox, {
      layers: ['mission-pins-core', 'mission-pins-glow'],
    });

    if (hits.length === 0) return null;

    const missionId = hits[0].properties?.mission_id;
    return (jobsRef.current || []).find((j) => String(j.id) === String(missionId)) ?? null;
  }, []);

  const handleMapClick = useCallback(
    (event: any) => {
      // 1. FORGIVING HITBOX DETECTION (15px bbox — shared with hover)
      const job = findMissionPinAtPoint(event?.point);
      if (job) {
        handleMarkerClick(job);
        return;
      }

      // 2. WE CLICKED EMPTY SPACE
      if (!event?.lngLat) return;
      const { lng, lat } = event.lngLat;

      if (!isInsideEgyptBounds(lng, lat)) {
        toast.error(t('geofenceEgyptShelf'));
        return;
      }

      // Drop the blue draft pin
      setSelectedLocation({ lat, lng });
      onLocationSelect(lat, lng);
    },
    [findMissionPinAtPoint, handleMarkerClick, onLocationSelect, t]
  );

  const handleMapMouseMove = useCallback(
    (event: any) => {
      const map = mapRef.current?.getMap();
      const job = findMissionPinAtPoint(event?.point);

      if (job && event?.lngLat) {
        try {
          const canvas = map?.getCanvas();
          if (canvas) canvas.style.cursor = 'pointer';
        } catch {
          /* ignore */
        }
        setHoveredPinInfo({
          lat: event.lngLat.lat,
          lng: event.lngLat.lng,
          title: job.category === 'public' ? 'City Mission' : 'Home Mission',
          status: job.status,
          priceLabel: formatEgp(Number(job.amount_target ?? 0)),
        });
        return;
      }

      try {
        const canvas = map?.getCanvas();
        if (canvas) canvas.style.cursor = '';
      } catch {
        /* ignore */
      }
      setHoveredPinInfo(null);
    },
    [findMissionPinAtPoint]
  );

  const handleMapMouseLeave = useCallback(() => {
    const map = mapRef.current?.getMap();
    try {
      if (map) map.getCanvas().style.cursor = '';
    } catch {
      /* ignore */
    }
    setHoveredPinInfo(null);
  }, []);

  // Click-to-open leads is handled via marker layers (no funding towers).

  const handleCloseMissionBriefing = useCallback(() => {
    setSelectedMission(null);
    setTranslatedText(null);
    setIsTranslationLoading(false);
    setTranslationError(null);
    setShowTranslateAction(false);
    setShowBidInput(false);
    setMissionBidAmount('');
    setShowDonate(false);
    setDonateAmount('');
    setLeadPhoneVisible(false);
    setSelectedRating(0);
  }, []);

  const closeCrowdfundConfirm = useCallback(() => {
    setShowCrowdfundConfirm(false);
    setCrowdfundBidAmount(null);
    setCrowdfundCoFundInput('');
  }, []);

  const handleCoFundMission = useCallback(
    async (missionId: string, bidAmount: number) => {
      const { error } = await supabase.rpc('co_fund_and_accept_mission', {
        p_mission_id: missionId,
        p_bid_amount: floorEgp(bidAmount),
      });
      if (error) throw error;
    },
    []
  );

  const handleDonate = useCallback(
    async (amount: number) => {
      if (!selectedMission) return;
      const value = Math.floor(Number(amount));
      if (!Number.isFinite(value) || value <= 0) {
        toast.error(t('enterPositiveEgpAmount'));
        return;
      }
      try {
        setDonating(true);
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user?.id) {
          onRequestAuth?.();
          return;
        }
        const { error } = await supabase.rpc('donate_to_mission', {
          p_mission_id: selectedMission.id,
          p_amount: value,
        });
        if (error) {
          toast.error(t('mapToastDonationFailed'));
          return;
        }
        // Optimistically update local mission funding so UI reflects change immediately
        setSelectedMission((prev) =>
          prev
            ? {
                ...prev,
                current_funding: Math.floor(Number(prev.current_funding || 0)) + value,
              }
            : prev
        );
        toast.success(t('mapToastDonationThanks'));
        setShowDonate(false);
        setDonateAmount('');
        await fetchMissions();
      } catch (e: any) {
        toast.error(t('mapToastDonationFailed'));
      } finally {
        setDonating(false);
      }
    },
    [fetchMissions, onRequestAuth, selectedMission]
  );

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

      // Place pending bid in mission_bids
      const { error } = await supabase.from('mission_bids').insert({
        mission_id: missionId,
        cleaner_id: user.id,
        bid_amount: floorEgp(bidAmount),
        status: 'pending',
      });
      if (error) {
        throw error;
      }
    },
    [onRequestAuth]
  );

  /** Wallet debit + assign cleaner + in_progress when funding reaches goal (RPC). */
  const completeFundingAndAssign = useCallback(async (missionId: string, bidAmountEgp: number) => {
    const { error } = await supabase.rpc('complete_funding_and_assign', {
      p_mission_id: missionId,
      p_bid_amount: floorEgp(bidAmountEgp),
    });
    if (error) throw error;
  }, []);

  const handleCloseHallOfFame = useCallback(() => {
    setHallOfFameMission(null);
    setHallOfFameCleanerName(null);
    setHallOfFameHeroes([]);
  }, []);

  useEffect(() => {
    if (!selectedMission?.description) {
      setShowTranslateAction(false);
      setTranslatedText(null);
      setTranslationError(null);
      return;
    }
    const detected = detectLikelyLanguage(selectedMission.description);
    const shouldTranslate = detected !== appLanguage;
    setShowTranslateAction(shouldTranslate);
    setTranslatedText(null);
    setTranslationError(null);
    if (shouldTranslate) {
      translateMissionDescription(selectedMission.description);
    }
  }, [selectedMission?.id, selectedMission?.description, appLanguage, translateMissionDescription]);

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
      const amtEgp = parseIntegerEgpFromInput(String(missionBidAmount || ''));
      if (amtEgp <= 0) {
        toast.error(t('enterPositiveEgpAmount'));
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('wallet_balance, frozen_balance, phone_number, is_verified')
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
          toast.error(t('verificationPromptOnlyVerified'));
          return;
        }
        const wb = Number(profile?.wallet_balance ?? 0);
        const fr = Number(profile?.frozen_balance ?? 0);
        const target = Number(selectedMission.amount_target ?? amtEgp);
        const sec = workerCanSecureMissionDeposit(wb, fr, selectedMission.category, target);
        if (isSecurityDepositFailure(sec)) {
          if (sec.reason === 'insufficient_funds' && sec.shortfallEgp != null && sec.shortfallEgp > 0) {
            toast.error(t('needDepositEgp', { amount: formatEgp(sec.shortfallEgp) }));
          } else {
            toast.error(
              sec.reason === 'frozen_exceeds_wallet'
                ? t('walletFrozenInvariantError')
                : t('insufficientSecurityDepositFunds')
            );
          }
          return;
        }

        if (!profile?.phone_number || String(profile.phone_number).trim().length === 0) {
          toast.notice(t('mapToastWhatsAppProfileTip'));
        }
      }

      const funded = Number(selectedMission.current_funding ?? 0);
      const goal = Number(selectedMission.amount_target ?? 0);
      const totalAfterBid = funded + amtEgp;
      const closesAtGoal = goal > 0 && totalAfterBid + 0.01 >= goal;

      if (closesAtGoal) {
        await completeFundingAndAssign(selectedMission.id, amtEgp);
      } else {
        await placePendingBid(selectedMission.id, amtEgp);
      }

      handleCloseMissionBriefing();
      void fetchMissions();
    } catch (err: any) {
      toast.error(t('mapToastBidUnexpectedError'));
    } finally {
      setIsAccepting(false);
    }
  }, [
    completeFundingAndAssign,
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

  const handleCloseBidModal = useCallback(() => {
    if (!bidSubmitting) {
      setBidJob(null);
      setBidAmount('');
      setBidError(null);
      setBidSuccess(null);
    }
  }, [bidSubmitting]);

  const handlePlaceBid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bidJob) return;
    setBidError(null);
    setBidSuccess(null);

    const bidEgp = parseIntegerEgpFromInput(bidAmount);
    if (bidEgp <= 0) {
      setBidError(t('enterPositiveEgpAmount'));
      return;
    }

    try {
      setBidSubmitting(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user?.id) {
        setBidError(t('signInToPlaceBid'));
        return;
      }
      const userId = session.user.id;

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('wallet_balance, frozen_balance, phone_number, is_verified')
        .eq('id', userId)
        .maybeSingle();
      if (profileError) {
        console.error('Profile check failed:', profileError.message);
      } else {
        const homeOk = checkHomeMissionWorkerVerification(bidJob.category, profile?.is_verified);
        if (!homeOk.ok) {
          setBidError(t('verificationPromptOnlyVerified'));
          return;
        }
        const wb = Number(profile?.wallet_balance ?? 0);
        const fr = Number(profile?.frozen_balance ?? 0);
        const target = Number(bidJob.amount_target ?? bidEgp);
        const sec = workerCanSecureMissionDeposit(wb, fr, bidJob.category, target);
        if (isSecurityDepositFailure(sec)) {
          if (sec.reason === 'insufficient_funds' && sec.shortfallEgp != null && sec.shortfallEgp > 0) {
            setBidError(t('needDepositEgp', { amount: formatEgp(sec.shortfallEgp) }));
          } else {
            setBidError(
              sec.reason === 'frozen_exceeds_wallet'
                ? t('walletFrozenInvariantError')
                : t('insufficientSecurityDepositFunds')
            );
          }
          return;
        }

        if (!profile?.phone_number || String(profile.phone_number).trim().length === 0) {
          setBidError(t('mapToastWhatsAppProfileTip'));
          return;
        }
      }

      const funded = Number(bidJob.current_funding ?? 0);
      const goal = Number(bidJob.amount_target ?? 0);
      const totalAfterBid = funded + bidEgp;
      const closesAtGoal = goal > 0 && totalAfterBid + 0.01 >= goal;

      if (closesAtGoal) {
        await completeFundingAndAssign(bidJob.id, bidEgp);
      } else {
        await placePendingBid(bidJob.id, bidEgp);
      }

      setBidAmount('');
      handleCloseBidModal();
      void fetchMissions();
    } catch (err) {
      console.error('Bid exception:', err);
      setBidError(t('mapToastBidUnexpectedError'));
    } finally {
      setBidSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrderError(null);
    setOrderSuccess(null);

    // Tokens: placing 1 pin costs 1 token (customers only).
    if (viewerProfile?.role === 'customer') {
      const tb = Math.floor(Number(viewerProfile?.token_balance ?? 0));
      if (tb < 1) {
        setShowTokenPackModal(true);
        return;
      }
    }

    const location = selectedLocation;
    if (!location) {
      setOrderError(t('tapMapToSetLocation'));
      return;
    }

    const rawDesc = (orderDescription || '').trim();
    if (rawDesc.length > 0) {
      const policy = validateMissionDescription(rawDesc);
      if (!policy.ok) {
        setOrderError('error' in policy ? policy.error : t('invalidDescription'));
        return;
      }
    }

    const { filteredText } = filterMissionDescription(rawDesc);
    let descriptionToSave = filteredText.trim() || rawDesc;
    const tags = photoVerification.aiTags;
    if (Array.isArray(tags) && tags.length > 0) {
      const tagStr = tags.filter(Boolean).join(', ');
      if (tagStr) descriptionToSave = descriptionToSave ? `${descriptionToSave} [${tagStr}]` : tagStr;
    }
    if (orderPhotos.length > 0 && photoVerification.verifying) {
      setOrderError(t('waitForAiVerification'));
      return;
    }
    if (!descriptionToSave) {
      descriptionToSave = t('leadPinDefaultDescription');
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
            building_id: null,
            building_height_m: null,
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
      const { data: mid, error: leadErr } = await supabase.rpc('create_lead_mission_with_token', {
        p_service_type: serviceType,
        p_location_lat: Number(location.lat),
        p_location_lng: Number(location.lng),
        p_description: descriptionToSave || null,
        p_photo_urls: creatorPhotoUrls || [],
        p_building_id: null,
        p_building_height_m: null,
      });
      if (leadErr) throw leadErr;

      // Optimistic mission insert so the glow/pin appears immediately (no refresh needed).
      // DB function guarantees `category='public'` and `amount_target=1` for lead-gen pins.
      if (mid) {
        const optimistic: JobOnMap = {
          id: String(mid),
          category: 'public',
          amount_target: 1,
          current_funding: 0,
          location_lat: Number(location.lat),
          location_lng: Number(location.lng),
          status: 'available',
          building_id: null,
          cleaner_id: null,
          creator_id: session.user.id,
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
                avatar_url: (viewerProfile as any)?.avatar_url ?? null,
                phone_number: (viewerProfile as any)?.phone_number ?? null,
                is_verified: (viewerProfile as any)?.is_verified ?? null,
              }
            : null,
        };
        setJobs((prev) => [optimistic, ...(prev || [])]);
      }

      // Update local token balance snapshot.
      setViewerProfile((p) =>
        !p
          ? p
          : {
              ...p,
              token_balance:
                Number.isFinite(Number(p.token_balance)) ? Math.max(0, Number(p.token_balance) - 1) : p.token_balance,
            }
      );

      setOrderSuccess(t('pinPlaced'));
      setOrderDescription('');
      setOrderPhotos([]);
      setDescriptionPolicyError(null);
      setPhotoVerification({ verifying: false, allApproved: true, hasRejected: false });
      setSelectedLocation(null);
      await fetchMissions();
      setTaskType(null);
      setTaskTypeSelected(null);
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

  const { missionTrustBlocked, missionTrustShortfallEgp } = useMemo(() => {
    if (!showBidInput || !selectedMission || workerTrustSnapshot === null) {
      return { missionTrustBlocked: false, missionTrustShortfallEgp: 0 };
    }
    const homeOk = checkHomeMissionWorkerVerification(
      selectedMission.category,
      workerTrustSnapshot.isVerified
    );
    if (!homeOk.ok) return { missionTrustBlocked: true, missionTrustShortfallEgp: 0 };
    const sec = workerCanSecureMissionDeposit(
      workerTrustSnapshot.wallet,
      workerTrustSnapshot.frozen,
      selectedMission.category,
      Number(selectedMission.amount_target ?? 0)
    );
    if (sec.ok) return { missionTrustBlocked: false, missionTrustShortfallEgp: 0 };
    const shortfall = isSecurityDepositFailure(sec) ? (sec.shortfallEgp ?? 0) : 0;
    return {
      missionTrustBlocked: true,
      missionTrustShortfallEgp: shortfall,
    };
  }, [showBidInput, selectedMission, workerTrustSnapshot]);

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
        properties: { mission_id: j.id },
      }));
    return { type: 'FeatureCollection' as const, features };
  }, [jobs, currentUserId]);

  /** Red mission dots on the map (always visible in 2D mode). */
  const missionPinsGeoJSON = useMemo(() => {
    const features = (jobs || [])
      .filter(missionEligibleForMapPin)
      .filter((j) => Number.isFinite(j.location_lat) && Number.isFinite(j.location_lng))
      .map((j) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [j.location_lng, j.location_lat],
        },
        properties: {
          mission_id: j.id,
          status: j.status,
        },
      }));
    return { type: 'FeatureCollection' as const, features };
  }, [jobs]);

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

  const activeCreatorMission = useMemo(
    () =>
      (jobs || []).find(
        (j) =>
          !!currentUserId &&
          j.creator_id === currentUserId &&
          (j.status === 'pending' ||
            j.status === 'available' ||
            j.status === 'funding' ||
            j.status === 'in_progress') &&
          Number.isFinite(j.location_lat) &&
          Number.isFinite(j.location_lng)
      ) ?? null,
    [jobs, currentUserId]
  );

  const showWorkerDashboard = !taskTypeSelected && !!activeWorkerMission;
  const showCreatorDashboard =
    !taskTypeSelected && !activeWorkerMission && !!activeCreatorMission && showCreatorStatusPanel;
  const showDefaultDashboard = !taskTypeSelected && !activeWorkerMission && !showCreatorDashboard;

  /** Native Mapbox draft location (replaces HTML MissionMarker). */
  const draftPinGeoJSON = useMemo(() => {
    if (!selectedLocation) return { type: 'FeatureCollection' as const, features: [] };
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [selectedLocation.lng, selectedLocation.lat],
          },
          properties: { kind: 'draft' },
        },
      ],
    };
  }, [selectedLocation]);

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
    setSelectedMission(mission as JobOnMap);
    mapRef.current?.flyTo({
      center: [mission.location_lng, mission.location_lat],
      zoom: 16,
      essential: true,
      duration: 1300,
    });
  }, []);

  const handleDollarAction = useCallback(() => {
    setDashboardExpanded(false);
    if (activeWorkerMission) {
      navigateToActiveMission();
      return;
    }
    if (activeCreatorMission) {
      setShowCreatorStatusPanel(true);
      return;
    }
    setShowCreatorStatusPanel(false);
    setShowLiveMarketFeed(true);
  }, [activeWorkerMission, activeCreatorMission, navigateToActiveMission]);

  return (
    <div className="w-full h-screen relative bg-black overflow-hidden">
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
        .ce-map .mapboxgl-ctrl-bottom-right {
          margin-right: 12px;
          margin-bottom: calc(20px + env(safe-area-inset-bottom));
        }
        @media (min-width: 641px) {
          .ce-map .mapboxgl-ctrl-bottom-right {
            margin-bottom: 24px;
          }
        }
      `}</style>

      {/* Full-screen 3D map — no blocking overlays */}
      <div className="ce-map w-full h-full">
        <MapGL
          ref={mapRef}
          {...viewState}
          projection="globe"
          renderWorldCopies={false}
          antialias
          onMove={(evt) => setViewState(evt.viewState)}
          // 2D mode: pins are interactive, buildings are background only.
          interactiveLayerIds={['mission-pins-core', 'mission-pins-glow']}
          onClick={handleMapClick}
          onMouseMove={handleMapMouseMove}
          onMouseLeave={handleMapMouseLeave}
          onLoad={(e: any) => {
          const map = e?.target;
          if (!map) return;
          mapInstanceRef.current = map;

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
            map.setTerrain({ source: 'mapbox-dem', exaggeration: 2.0 });
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

          if (!map.getSource('missions-heatmap')) {
            map.addSource('missions-heatmap', {
              type: 'geojson',
              data: { type: 'FeatureCollection', features: [] },
            });
            map.addLayer(
              {
                id: 'missions-heat',
                type: 'heatmap',
                source: 'missions-heatmap',
                paint: {
                  'heatmap-weight': [
                    'interpolate',
                    ['linear'],
                    ['coalesce', ['get', 'funding'], 0],
                    0,
                    0,
                    250,
                    1,
                  ],
                  'heatmap-color': [
                    'interpolate',
                    ['linear'],
                    ['heatmap-density'],
                    0,
                    'rgba(0,255,255,0)',
                    0.2,
                    'rgba(0,255,255,0.5)',
                    0.5,
                    'rgba(128,0,255,0.7)',
                    1,
                    'rgba(255,0,128,1)',
                  ],
                  'heatmap-radius': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10,
                    15,
                    15,
                    30,
                  ],
                },
              },
              'place_label'
            );
          }

          if (!map.getLayer('3d-buildings')) {
            map.addLayer(
              {
                id: '3d-buildings',
                source: 'composite',
                'source-layer': 'building',
                filter: ['==', 'extrude', 'true'],
                type: 'fill-extrusion',
                minzoom: 13,
                paint: {
                  // 2D mode: keep buildings as neutral background only.
                  'fill-extrusion-color': '#1f2937',
                  'fill-extrusion-height': ['get', 'height'],
                  'fill-extrusion-base': ['get', 'min_height'],
                  'fill-extrusion-opacity': 0.8,
                  'fill-extrusion-vertical-gradient': true,
                  'fill-extrusion-ambient-occlusion-intensity': 0.8,
                },
              },
              'place_label'
            );
          }
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
              'line-color': '#00ffff',
              'line-width': 3.5,
              'line-opacity': 0.2,
              'line-blur': 1.5,
            }}
          />
          <Layer
            id="neon-roads"
            type="line"
            source-layer="road"
            filter={['in', ['get', 'class'], ['literal', ['motorway', 'primary', 'secondary', 'trunk']]]}
            paint={{
              'line-color': '#00ffff',
              'line-width': 1.5,
              'line-opacity': 0.6,
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

        {/* Main mission pins */}
        <Source id="mission-pins" type="geojson" data={missionPinsGeoJSON}>
          <Layer
            id="mission-pins-glow"
            type="circle"
            paint={{
              'circle-radius': 14,
              'circle-color': 'rgba(0,229,255,0.25)',
              'circle-blur': 0.8,
              'circle-opacity': mapMarkerLayerSuppressed ? 0 : 0.9,
            }}
          />
          <Layer
            id="mission-pins-core"
            type="circle"
            paint={{
              'circle-radius': 6,
              'circle-color': '#ff2d55',
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
              'circle-opacity': mapMarkerLayerSuppressed ? 0.08 : 0.92,
              'circle-stroke-opacity': mapMarkerLayerSuppressed ? 0.08 : 0.95,
            }}
          />
        </Source>

        {/* Draft tap location — native circle only (no HTML markers). */}
        <Source id="draft-pin" type="geojson" data={draftPinGeoJSON}>
          <Layer
            id="draft-pin"
            type="circle"
            filter={['==', ['get', 'kind'], 'draft']}
            paint={{
              'circle-radius': 11,
              'circle-color': '#00ffff',
              'circle-opacity': mapMarkerLayerSuppressed ? 0.08 : 0.92,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-opacity': mapMarkerLayerSuppressed ? 0.08 : 0.95,
            }}
          />
        </Source>

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


          {hoveredPinInfo && (
            <Popup
              longitude={hoveredPinInfo.lng}
              latitude={hoveredPinInfo.lat}
              closeButton={false}
              closeOnClick={false}
              anchor="bottom"
              offset={15}
              className="pointer-events-none z-[10000]"
            >
              <div className="rounded-xl bg-slate-950/90 border border-cyan-500/30 px-3 py-2 text-white shadow-lg pointer-events-none">
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-cyan-300">
                  {hoveredPinInfo.title}
                </p>
                <p className="text-[10px] text-slate-300 mt-1 font-semibold">{hoveredPinInfo.priceLabel}</p>
                <p className="text-[10px] text-slate-400 mt-0.5 capitalize">
                  Status: {hoveredPinInfo.status}
                </p>
              </div>
            </Popup>
          )}
        </MapGL>
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

      <SubscriptionModal
        open={showSubscriptionModal}
        userId={currentUserId}
        onClose={() => setShowSubscriptionModal(false)}
        onSuccess={async () => {
          if (!currentUserId) return;
          const { data } = await supabase
            .from('profiles')
            .select('subscription_expires_at')
            .eq('id', currentUserId)
            .maybeSingle();
          setViewerProfile((p) =>
            !p
              ? p
              : {
                  ...p,
                  subscription_expires_at: (data as any)?.subscription_expires_at ?? p.subscription_expires_at,
                }
          );
        }}
      />

      {/* Minimalist overlays — wrapper is pointer-events-none so map stays interactive */}
      <div className="absolute inset-0 pointer-events-none z-[80] flex flex-col">
        {/* Header: CleanEgypt.co (non-interactive) + profile avatar (clickable) */}
        <header className="flex items-center justify-between px-5 pt-5">
          <div className="pointer-events-none">
            <h1 className="text-sm font-medium tracking-wide text-white">
              CleanEgypt.co
            </h1>
            <div className="mt-2 flex items-center gap-3 md:gap-4">
              <div className="flex items-center gap-2 rounded-2xl bg-slate-950/60 backdrop-blur-md border border-white/10 px-2.5 py-1.5 md:px-3 md:py-2">
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_12px_rgba(16,185,129,0.85)]" />
                <div className="leading-tight">
                  <p className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.22em] text-cyan-400">
                    {t('availableLeads')}
                  </p>
                  <p className="text-[12px] md:text-sm font-black text-white tabular-nums">
                    {availableLeadsCount}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-2xl bg-slate-950/60 backdrop-blur-md border border-white/10 px-2.5 py-1.5 md:px-3 md:py-2">
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_12px_rgba(16,185,129,0.85)]" />
                <div className="leading-tight">
                  <p className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.22em] text-cyan-400">
                    {t('onlineExecutors')}
                  </p>
                  <p className="text-[11px] md:text-[11px] font-black text-white tabular-nums">
                    {t('onlineLabel')} {onlineExecutors}
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="pointer-events-auto flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-2xl bg-slate-950/60 backdrop-blur-md border border-white/10 px-2.5 py-2 sm:px-3">
              <p className="hidden sm:block text-[10px] font-black uppercase tracking-[0.22em] text-lime-500">
                {t('tokens')}:
              </p>
              <p className="text-[11px] sm:text-sm font-black text-white tabular-nums">
                {Math.max(0, Math.floor(Number(viewerProfile?.token_balance ?? 0)))}
              </p>
              <button
                type="button"
                onClick={() => setShowTokenPackModal(true)}
                className="ml-1.5 rounded-full bg-lime-500 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-black hover:bg-lime-400 transition-all"
              >
                {t('topUp')}
              </button>
            </div>
            <button
              type="button"
              onClick={onAvatarClick}
              className="relative z-[10000] flex h-11 w-11 items-center justify-center rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white hover:border-emerald-400/50 hover:shadow-[0_0_16px_rgba(16,185,129,0.3)] transition-all"
            >
              👤
            </button>
          </div>
        </header>

        <div className="mt-auto px-4 pb-[max(16px,env(safe-area-inset-bottom))] flex justify-center">
          <AnimatePresence mode="wait">
            {showWorkerDashboard && activeWorkerMission ? (
              <ActiveMissionWidget
                key="worker-dashboard"
                mission={activeWorkerMission}
                onNavigate={navigateToActiveMission}
                onUploadProof={openActiveMissionProof}
              />
            ) : showCreatorDashboard && activeCreatorMission ? (
              <CreatorMissionWidget
                key="creator-dashboard"
                mission={activeCreatorMission}
                onClose={() => setShowCreatorStatusPanel(false)}
              />
            ) : showDefaultDashboard ? (
              <motion.div
                key="default-dashboard"
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 18, opacity: 0 }}
                className="pointer-events-auto relative h-44 w-44"
              >
                <AnimatePresence>
                  {dashboardExpanded && (
                    <>
                      <motion.button
                        initial={{ scale: 0.4, opacity: 0, x: 0, y: 0 }}
                        animate={{ scale: 1, opacity: 1, x: -72, y: -34 }}
                        exit={{ scale: 0.4, opacity: 0, x: 0, y: 0 }}
                        transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                        type="button"
                        onClick={() => selectTaskType('city')}
                        className="absolute left-1/2 top-1/2 -ml-7 -mt-7 h-14 w-14 rounded-full border border-emerald-400/70 bg-emerald-500/20 text-2xl shadow-[0_0_20px_rgba(34,197,94,0.5)]"
                        aria-label="City mission"
                      >
                        🧹
                      </motion.button>
                      <motion.button
                        initial={{ scale: 0.4, opacity: 0, x: 0, y: 0 }}
                        animate={{ scale: 1, opacity: 1, x: 72, y: -34 }}
                        exit={{ scale: 0.4, opacity: 0, x: 0, y: 0 }}
                        transition={{ type: 'spring', stiffness: 360, damping: 22, delay: 0.03 }}
                        type="button"
                        onClick={() => selectTaskType('home')}
                        className="absolute left-1/2 top-1/2 -ml-7 -mt-7 h-14 w-14 rounded-full border border-amber-400/80 bg-amber-500/20 text-2xl shadow-[0_0_20px_rgba(251,191,36,0.5)]"
                        aria-label="Home mission"
                      >
                        🧽
                      </motion.button>
                      <motion.button
                        initial={{ scale: 0.4, opacity: 0, x: 0, y: 0 }}
                        animate={{ scale: 1, opacity: 1, x: 0, y: -94 }}
                        exit={{ scale: 0.4, opacity: 0, x: 0, y: 0 }}
                        transition={{ type: 'spring', stiffness: 360, damping: 22, delay: 0.06 }}
                        type="button"
                        onClick={handleDollarAction}
                        className="absolute left-1/2 top-1/2 -ml-7 -mt-7 h-14 w-14 rounded-full border border-cyan-400/80 bg-cyan-500/20 text-2xl font-black text-cyan-100 shadow-[0_0_20px_rgba(34,211,238,0.45)]"
                        aria-label={t('serviceMarketplace')}
                      >
                        $
                      </motion.button>
                    </>
                  )}
                </AnimatePresence>
              <motion.button
                  whileTap={{ scale: 0.94 }}
                  type="button"
                  onClick={() => setDashboardExpanded((s) => !s)}
                className="absolute z-[10000] left-1/2 top-1/2 -ml-9 -mt-9 h-[4.5rem] w-[4.5rem] rounded-full border-2 border-cyan-400/70 bg-black/65 backdrop-blur-lg text-cyan-200 shadow-[0_0_34px_rgba(34,211,238,0.35)] flex items-center justify-center"
                  aria-label={isExecutorViewer ? t('myLeads') : t('myOrders')}
                >
                  <div className="flex flex-col items-center justify-center leading-none">
                    <Recycle className="h-7 w-7" />
                    <span className="mt-1 text-[9px] font-black uppercase tracking-[0.22em] text-cyan-200/90">
                      {isExecutorViewer ? t('myLeads') : t('myOrders')}
                    </span>
                  </div>
                </motion.button>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

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
            className={`pointer-events-auto relative z-[1] w-full max-w-xl flex flex-col h-[50dvh] sm:h-auto sm:max-h-[78dvh] animate-slide-up p-4 shadow-2xl ${PROFILE_GLASS_PANEL}`}
            style={{
              marginBottom: isMobile ? 'calc(env(safe-area-inset-bottom) + 0.75rem)' : undefined,
            }}
          >
            <form ref={orderFormRef} onSubmit={handleSubmit} className="flex flex-col h-full">
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-2 pb-8 space-y-4">
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
                  {taskType === 'city' ? t('cleanCityArea') : t('cleanYourHomeOffice')}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                    {t('serviceTypeLabel')}
                  </label>
                  <select
                    value={serviceType}
                    onChange={(e) => setServiceType(e.target.value as ServiceType)}
                    className={`w-full ${PROFILE_GLASS_PANEL} px-4 py-2.5 text-sm text-white bg-black/20 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500`}
                  >
                    {CLEAN_WHEEL_SERVICES.map((s) => (
                      <option key={s.id} value={s.id} className="bg-slate-950">
                        {t(s.labelKey)}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-[10px] text-slate-500 leading-relaxed">
                    {t('pinPlacementPriceHint', { amount: formatEgp(pinPlacementFeeEgp) })}
                  </p>
                </div>
              </div>

              <CreateMission
                taskType={taskType}
                orderDescription={orderDescription}
                setOrderDescription={setOrderDescription}
                orderPhotos={orderPhotos}
                setOrderPhotos={setOrderPhotos}
                onDescriptionPolicyError={setDescriptionPolicyError}
                onPhotoVerificationChange={setPhotoVerification}
                onTextWarning={(w) => {
                  setTextWarning(w ?? null);
                  if (w) toast.notice(w);
                }}
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

              <div className="mt-auto pb-[env(safe-area-inset-bottom)]">
              <div
                className={`w-full mt-1 rounded-full animated-border-home ${
                  orderSubmitting ||
                  uploadingProof ||
                  !selectedLocation ||
                  !!descriptionPolicyError ||
                  (orderPhotos.length > 0 &&
                    photoVerification.verifying)
                    ? 'opacity-60'
                    : ''
                }`}
              >
                <button
                  type="submit"
                  disabled={
                    orderSubmitting ||
                    uploadingProof ||
                    !selectedLocation ||
                    !!descriptionPolicyError ||
                    (orderPhotos.length > 0 &&
                      photoVerification.verifying)
                  }
                  className="animated-border-inner w-full rounded-full px-6 py-2 text-sm font-black uppercase tracking-[0.24em] transition-all text-orange-400 border border-orange-500/50 bg-orange-500/10 hover:bg-orange-500/20 hover:shadow-[0_0_15px_rgba(249,115,22,0.3)] disabled:cursor-not-allowed active:scale-95"
                >
                  {uploadingProof || orderSubmitting
                    ? t('processing')
                    : t('payAndPlacePin')}
                </button>
              </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bidding modal — dark glassmorphism */}
      {false && bidJob && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pt-[env(safe-area-inset-top)] isolate bg-black/80 backdrop-blur-md"
          onClick={handleCloseBidModal}
          aria-hidden="false"
        >
          <div
            className="w-full max-w-md animated-border animated-border-rect rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="animated-border-inner w-full rounded-3xl bg-[#020617]/95 backdrop-blur-xl p-6">
              <div className="flex items-start justify-between mb-4">
                <button
                  type="button"
                  onClick={handleCloseBidModal}
                  disabled={bidSubmitting}
                  className="text-slate-400 hover:text-white text-lg font-bold disabled:opacity-40 transition-colors mr-2"
                >
                  ✕
                </button>
                <h3 className="text-lg font-black uppercase tracking-[0.18em] text-white">
                  Place bid
                </h3>
              </div>

            <div className="space-y-4 mb-6">
              <div className={`px-4 py-3 ${PROFILE_GLASS_PANEL}`}>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1">
                  Target amount
                </p>
                <p className="text-xl font-black text-amber-400">
                  {formatEgp(Number(bidJob.amount_target))}
                </p>
              </div>
              {bidJob.description && (
                <div className={`px-4 py-3 ${PROFILE_GLASS_PANEL}`}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1">
                    Description
                  </p>
                  <p className="text-sm text-slate-300 whitespace-pre-wrap">
                    {bidJob.description}
                  </p>
                </div>
              )}
            </div>

            <form onSubmit={handlePlaceBid} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                  {t('bidAmountLabelEgp')}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  pattern="\d*"
                  value={bidAmount}
                  onChange={(e) => setBidAmount(sanitizeIntegerEgpDigits(e.target.value))}
                  placeholder="Enter your bid amount"
                  className={`w-full ${PROFILE_GLASS_PANEL} px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 tabular-nums`}
                />
                {bidModalFundingGapPreview && (
                  <p className="mt-2 text-[11px] text-cyan-200/95 font-semibold tabular-nums">
                    {t('goalMinusFundedMinusBid')}: {formatEgp(bidModalFundingGapPreview.remainder)}
                    {bidModalFundingGapPreview.remainder <= 0
                      ? ` — ${t('goalMetOrExceededShort')}`
                      : ''}
                  </p>
                )}
              </div>

              {bidError && (
                <p className="text-xs text-red-400 font-medium">{bidError}</p>
              )}
              {bidSuccess && (
                <p className="text-xs text-emerald-400 font-medium">{bidSuccess}</p>
              )}

              <div className={`rounded-full animated-border-home ${bidSubmitting ? 'opacity-60' : ''}`}>
                <button
                  type="submit"
                  disabled={
                    bidSubmitting ||
                    parseIntegerEgpFromInput(bidAmount) <= 0
                  }
                  className="animated-border-inner w-full rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.24em] text-white bg-[#020617] hover:brightness-110 transition-all disabled:cursor-not-allowed disabled:opacity-60 active:scale-95"
                >
                  {bidSubmitting
                    ? 'Placing bid...'
                    : (() => {
                        const tokens = parseIntegerEgpFromInput(bidAmount);
                        return tokens > 0
                          ? `Place bid ${formatEgp(tokens)}`
                          : 'Place bid';
                      })()}
                </button>
              </div>
            </form>
            </div>
          </div>
        </div>
      )}

      {/* Mission Briefing — bottom sheet when active pyramid marker clicked */}
      {selectedMission && (
        <div
          className="absolute inset-0 z-[9999] flex items-end justify-center pt-[env(safe-area-inset-top)] isolate pointer-events-none"
          aria-hidden="false"
        >
          <div
            className="absolute inset-x-0 bottom-0 top-[35%] bg-gradient-to-t from-black/80 via-black/35 to-transparent backdrop-blur-[2px] pointer-events-auto"
            onClick={handleCloseMissionBriefing}
            aria-hidden="true"
          />
          <div
            className="relative w-full max-w-xl max-h-[78dvh] overflow-y-auto rounded-t-3xl bg-slate-950/70 backdrop-blur-xl border-t border-x border-cyan-500/25 shadow-[0_-10px_40px_rgba(0,229,255,0.12)] px-5 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-3 animate-slide-up pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
            style={{ transform: sheetDragY > 0 ? `translateY(${sheetDragY}px)` : undefined }}
          >
            {/* Drag handle + swipe-to-close (mobile) */}
            <div
              className="mx-auto mb-2 h-1.5 w-14 rounded-full bg-white/15 border border-white/10"
              onTouchStart={(e) => {
                sheetTouchStartYRef.current = e.touches?.[0]?.clientY ?? null;
                sheetTouchStartTimeRef.current = Date.now();
              }}
              onTouchMove={(e) => {
                const start = sheetTouchStartYRef.current;
                const y = e.touches?.[0]?.clientY;
                if (start == null || y == null) return;
                const dy = y - start;
                setSheetDragY(dy > 0 ? Math.min(220, dy) : 0);
              }}
              onTouchEnd={() => {
                const dy = sheetDragY;
                const dt = (sheetTouchStartTimeRef.current ? Date.now() - sheetTouchStartTimeRef.current : 0) || 0;
                const shouldClose = dy > 110 || (dy > 70 && dt < 220);
                setSheetDragY(0);
                sheetTouchStartYRef.current = null;
                sheetTouchStartTimeRef.current = null;
                if (shouldClose) handleCloseMissionBriefing();
              }}
              aria-hidden
            />

            <div className="flex items-start justify-between mb-3">
              <button
                type="button"
                onClick={handleCloseMissionBriefing}
                className="mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-200 bg-white/5 border border-white/10 hover:bg-white/10 active:scale-95 transition-all"
                aria-label="Close"
              >
                ✕
              </button>
              <div>
                <h2 className="text-[10px] font-black uppercase tracking-[0.35em] text-slate-500">
                  {t('missionBriefing')}
                </h2>
                {selectedMission.status === 'in_progress' && selectedMission.cleaner_id === currentUserId && (
                  <p className="text-[10px] font-bold uppercase tracking-wider text-sky-400 mt-1">{t('yourActiveMission')}</p>
                )}
              </div>
            </div>

            {missionBriefingBooting ? (
              <div className="py-10 flex flex-col items-center justify-center">
                <div className="h-6 w-6 border-2 border-cyan-500/60 border-t-cyan-200 rounded-full animate-spin" />
                <p className="mt-3 text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
                  Loading…
                </p>
              </div>
            ) : null}

            {!missionBriefingBooting && (
              <div className="space-y-4 mb-6">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{selectedMission.category === 'home' ? '🏠' : '🌆'}</span>
                <div>
                  <p className={`text-[10px] font-bold uppercase tracking-[0.2em] ${selectedMission.category === 'public' ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {selectedMission.category === 'public' ? t('cityCleaning') : t('homeCleaning')}
                  </p>
                  <p className="text-xs text-slate-500 font-mono">
                    {selectedMission.location_lat.toFixed(6)}, {selectedMission.location_lng.toFixed(6)}
                  </p>
                </div>
              </div>

              <div className="py-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1">
                  {selectedMission.category === 'public' ? t('currentFunding') : t('reward')}
                </p>
                <p
                  className={`text-4xl sm:text-5xl font-black tracking-tight ${
                    selectedMission.category === 'public' ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                  style={{
                    textShadow:
                      selectedMission.category === 'public'
                        ? '0 0 24px rgba(52, 211, 153, 0.6)'
                        : '0 0 24px rgba(251, 191, 36, 0.6)',
                  }}
                >
                  {selectedMission.category === 'public'
                    ? formatEgp(Number(selectedMission.current_funding || 0))
                    : formatEgp(Number(selectedMission.amount_target))}
                </p>
                {selectedMission.category === 'public' && (
                  <p className="mt-1 text-[11px] text-slate-400">
                    {t('targetGoal')}: {formatEgp(Number(selectedMission.amount_target))}
                  </p>
                )}
                {(activeBidCounts[selectedMission.id] || 0) > 0 && (
                  <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-sky-400">
                    {t('lockedDeposit')}
                  </p>
                )}
              </div>

              {selectedMission.photo_urls && selectedMission.photo_urls.length > 0 && (
                <div className="mb-3">
                  <div className="flex overflow-x-auto snap-x snap-mandatory gap-2 pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                    {selectedMission.photo_urls.map((url, index) => (
                      <div key={`${url}-${index}`} className="min-w-full snap-center shrink-0">
                        <ModeratedMissionPhoto
                          url={url}
                          alt={`Before (work scope) ${index + 1}`}
                          imgClassName="w-full h-48 object-cover rounded-xl shadow-md bg-slate-800"
                          showSafeBadge
                        />
                      </div>
                    ))}
                  </div>
                  {selectedMission.photo_urls.length > 1 && (
                    <p className="text-[10px] text-slate-400 text-center mt-2 uppercase tracking-wider">
                      {t('swipeForMorePhotos')} • {selectedMission.photo_urls.length} {t('photos')}
                    </p>
                  )}
                </div>
              )}

              {selectedMission.description && (
                <div className="space-y-2">
                  <p className="text-sm text-slate-400">{selectedMission.description}</p>
                  {(showTranslateAction || isTranslationLoading || !!translatedText || !!translationError) && (
                    <div className="space-y-2">
                      {showTranslateAction && (
                        <button
                          type="button"
                          onClick={() => translateMissionDescription(selectedMission.description!)}
                          disabled={isTranslationLoading}
                          className="inline-flex items-center px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.16em] border border-cyan-400/40 text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 transition-all disabled:opacity-60 disabled:cursor-wait"
                        >
                          {isTranslationLoading ? t('translating') : t('translate')}
                        </button>
                      )}
                      {isTranslationLoading && (
                        <div className="h-10 w-full rounded-xl bg-cyan-500/10 border border-cyan-500/20 animate-pulse" />
                      )}
                      {translatedText && !isTranslationLoading && (
                        <p className="text-sm text-cyan-100 rounded-xl border border-cyan-500/30 bg-cyan-950/30 px-3 py-2">
                          {translatedText}
                        </p>
                      )}
                      {translationError && !isTranslationLoading && (
                        <p className="text-sm text-red-300 rounded-xl border border-red-500/30 bg-red-950/30 px-3 py-2">
                          {translationError}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

             {/* Financial Trail */}
             <div className={`border border-cyan-500/20 p-4 ${PROFILE_GLASS_PANEL}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                    Financial Trail
                  </p>
                  {missionTxLoading && (
                    <div className="h-4 w-4 border-2 border-cyan-500/60 border-t-cyan-300 rounded-full animate-spin" />
                  )}
                </div>
                {missionTxError && (
                  <p className="mt-2 text-xs text-red-400">{missionTxError}</p>
                )}
                <div className="mt-3 max-h-48 overflow-y-auto space-y-2 pr-1 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
                  {missionTransactions.map((tx: any) => {
                    const gw = (tx.gateway || '').toLowerCase();
                    const badge =
                      gw.includes('stripe') ? 'Stripe' : tx.gateway || null;
                    
                    // @ts-ignore
                    const isCarding = tx.user_id ? potentialCardingUserIds.has(tx.user_id) : false;

                    // Достаем данные профиля из нашего нового запроса
                    const profile = tx.profile;
                    const displayName = profile?.full_name || 'Eco Hero';
                    const avatarUrl = profile?.avatar_url;

                    return (
                      <div
                        key={tx.id}
                        className={`flex items-center justify-between gap-3 border border-cyan-500/10 px-3 py-2 text-[11px] ${PROFILE_GLASS_PANEL} !rounded-xl transition-all hover:bg-white/5`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {/* АВАТАРКА ГЕРОЯ */}
                          <div className="h-8 w-8 shrink-0 rounded-full border border-white/20 bg-gradient-to-br from-emerald-500/30 to-cyan-500/20 overflow-hidden flex items-center justify-center shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                            {avatarUrl ? (
                              <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-[10px] font-bold text-emerald-300">{(displayName || 'E')[0]}</span>
                            )}
                          </div>

                          <div className="min-w-0">
                            <p className="font-bold text-white truncate">
                              {displayName}
                            </p>
                            <p className="text-[9px] text-slate-500 uppercase tracking-tight">
                              {tx.type}
                              {badge ? <span className="ml-1 opacity-70">• {badge}</span> : null}
                            </p>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <p
                            className={[
                              'font-mono font-black tabular-nums text-xs',
                              isCarding
                                ? 'text-red-300 drop-shadow-[0_0_10px_rgba(239,68,68,0.55)]'
                                : 'text-emerald-300',
                            ].join(' ')}
                          >
                            +{formatEgp(Number(tx.amount))}
                          </p>
                          <p className="text-[8px] text-slate-600">
                             {new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  {!missionTxLoading && missionTransactions.length === 0 && (
                    <p className="text-xs text-slate-500 italic py-4 text-center">No transactions yet. Be the first hero!</p>
                  )}
                </div>
              </div>
              {/* GPS Integrity */}
              <div className={`border border-cyan-500/20 p-4 ${PROFILE_GLASS_PANEL}`}>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  GPS Integrity
                </p>
                <p className="mt-2 text-xs text-slate-300">
                  {typeof selectedMission.completion_distance_meters === 'number'
                    ? `Verification Distance at Completion: ${
                        selectedMission.completion_distance_meters < 1000
                          ? `${Math.round(selectedMission.completion_distance_meters)} m`
                          : `${(selectedMission.completion_distance_meters / 1000).toFixed(2)} km`
                      }`
                    : gpsDistanceMeters != null
                      ? `Current distance to mission: ${
                          gpsDistanceMeters < 1000
                            ? `${Math.round(gpsDistanceMeters)} m`
                            : `${(gpsDistanceMeters / 1000).toFixed(2)} km`
                        }`
                      : gpsDistanceError
                        ? gpsDistanceError
                        : 'Calculating distance...'}
                </p>
                {typeof selectedMission.completion_distance_meters === 'number' &&
                  selectedMission.completion_distance_meters > 500 && (
                    <div className="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 bg-red-500/10 border border-red-400/40 text-[10px] font-black uppercase tracking-[0.2em] text-red-300 shadow-[0_0_14px_rgba(239,68,68,0.35)]">
                      ⚠ Verification distance &gt; 500m
                    </div>
                  )}
              </div>
              </div>
            )}

            {selectedMission.status === 'completed' ? (
              <div className="space-y-5">
                <div className="space-y-3">
                  <p className="text-sm text-amber-200 font-semibold">
                    {t('missionAccomplished')}
                  </p>
                  <div className="w-full rounded-full animated-border-completed">
                    <button
                      type="button"
                      onClick={() => setHallOfFameMission(selectedMission)}
                      className="animated-border-inner w-full rounded-full py-4 text-sm font-black uppercase tracking-[0.24em] text-white bg-[#020617] hover:brightness-110 transition-all active:scale-95"
                    >
                      {t('viewPhotos')}
                    </button>
                  </div>
                </div>

                {selectedMission.creator_id === currentUserId &&
                  !reviewedMissions.has(selectedMission.id) && (
                    <div className={`space-y-3 border border-amber-500/40 p-4 ${PROFILE_GLASS_PANEL}`}>
                      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-300">
                        {t('rateTheCleaner')}
                      </p>
                      <p className="text-[11px] text-slate-300">
                        {t('ratingHelpsReward')}
                      </p>
                      <div className="flex items-center gap-2">
                        {[1, 2, 3, 4, 5].map((star) => {
                          const active = star <= selectedRating;
                          return (
                            <button
                              key={star}
                              type="button"
                              disabled={isSubmittingReview}
                              onClick={() => setSelectedRating(star)}
                              className={`text-2xl transition-transform ${
                                active ? 'text-amber-300' : 'text-slate-600'
                              } ${active ? 'scale-110' : 'scale-100'} hover:scale-110`}
                            >
                              ⭐
                            </button>
                          );
                        })}
                      </div>
                      {selectedRating > 0 && (
                        <button
                          type="button"
                          disabled={isSubmittingReview}
                          onClick={() => handleSubmitReview(selectedRating)}
                          className="mt-2 w-full rounded-full bg-amber-500 text-black text-[11px] font-black uppercase tracking-[0.18em] py-2.5 hover:bg-amber-400 disabled:opacity-60 disabled:cursor-wait transition-all"
                        >
                          {isSubmittingReview ? t('submitting') : t('submitRating')}
                        </button>
                      )}
                    </div>
                  )}
              </div>
            ) : selectedMission.status === 'in_progress' && selectedMission.cleaner_id !== currentUserId ? (
              <div className="space-y-3">
                <p className="text-sm text-sky-200 font-semibold">
                  {t('workInProgress')}
                </p>
              </div>
            ) : selectedMission.status === 'in_progress' && selectedMission.cleaner_id === currentUserId ? (
              <div className="w-full rounded-full animated-border-city">
                <button
                  type="button"
                  onClick={() => {
                    toast.success(t('mapToastMissionAcceptedProfile'));
                    handleCloseMissionBriefing();
                    onAvatarClick?.();
                  }}
                  className="animated-border-inner w-full rounded-full py-4 text-sm font-black uppercase tracking-[0.24em] text-white bg-[#020617] hover:brightness-110 transition-all active:scale-95"
                >
                  {t('startWorkUploadProof')}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className={`${PROFILE_GLASS_PANEL} px-4 py-3`}>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                    {t('serviceRequested')}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {serviceLabelFromId(serviceTypeForMission(selectedMission))}
                  </p>
                  <p className="mt-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                    {t('status')}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-cyan-200">
                    {String(selectedMission.status || '').replace(/_/g, ' ')}
                  </p>
                </div>

                {isExecutorViewer ? (
                  <div className="space-y-2">
                    <div className="w-full rounded-full animated-border-home">
                      <button
                        type="button"
                        onClick={handleUnlockLead}
                        className="animated-border-inner w-full rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.22em] text-orange-200 border border-orange-500/60 bg-orange-500/15 hover:bg-orange-500/25 hover:shadow-[0_0_20px_rgba(249,115,22,0.35)] transition-all active:scale-95"
                      >
                        {t('unlockLead')}
                      </button>
                    </div>

                    {leadPhoneVisible && (
                      <div className={`${PROFILE_GLASS_PANEL} px-4 py-3`}>
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                          {t('contactCustomer')}
                        </p>
                        <p className="mt-1 text-sm font-black text-emerald-300 break-all">
                          {selectedMission.creator?.phone_number || t('contactUnavailable')}
                        </p>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Crowdfunding confirm modal (public missions) */}
      {false && showCrowdfundConfirm && selectedMission && (
        <div className="absolute inset-0 z-[9999] flex items-center justify-center p-4 pt-[env(safe-area-inset-top)] isolate">
          <div
            className="absolute inset-0 bg-black/85 backdrop-blur-md"
            onClick={closeCrowdfundConfirm}
            aria-hidden="true"
          />
          <div
            className="relative w-full max-w-lg rounded-3xl bg-[#020617]/95 backdrop-blur-2xl border border-white/10 shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <button
                type="button"
                onClick={closeCrowdfundConfirm}
                className="p-2 -m-2 mr-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                aria-label="Close"
              >
                ✕
              </button>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.35em] text-slate-500">
                  {t('confirmation')}
                </p>
                <h3 className="mt-2 text-lg font-extrabold text-white">
                  {t('thisIsCrowdfundingMission')}
                </h3>
              </div>
            </div>

            {(() => {
              const bid = Number(crowdfundBidAmount ?? 0);
              const funded = Math.max(0, Number(selectedMission.current_funding ?? 0));
              const targetEgp = Math.max(0, Number(selectedMission.amount_target ?? 0));
              const gapToCloseEgp = Math.max(0, Math.floor(targetEgp - funded));
              return (
                <>
                  <p className="text-sm text-slate-300">
                    {t('yourBidIs')}{' '}
                    <span className="font-black text-amber-300">{formatEgp(bid)}</span>. {t('currentFundingIs')}{' '}
                    <span className="font-black text-emerald-300">{formatEgp(funded)}</span>.
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {t('gapToGoalHint', {
                      goal: formatEgp(targetEgp),
                      gap: formatEgp(gapToCloseEgp),
                    })}
                  </p>
                  <p className="mt-2 text-[11px] text-slate-500">
                    {t('chooseHowToProceed')}
                  </p>

                  <div className="mt-5 grid grid-cols-1 gap-3">
                    <div className={`space-y-2 border border-amber-500/20 rounded-xl px-3 py-3 ${PROFILE_GLASS_PANEL}`}>
                      <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                        {t('bidAmountLabelEgp')} ({t('coFundCustomHint') || 'any amount'})
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        pattern="\d*"
                        value={crowdfundCoFundInput}
                        onChange={(e) => setCrowdfundCoFundInput(sanitizeIntegerEgpDigits(e.target.value))}
                        placeholder={gapToCloseEgp > 0 ? String(gapToCloseEgp) : '10'}
                        className={`w-full ${PROFILE_GLASS_PANEL} px-3 py-2 text-sm text-white tabular-nums`}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={isAccepting || parseIntegerEgpFromInput(crowdfundCoFundInput) <= 0}
                      onClick={async () => {
                        if (!selectedMission) return;
                        const coFundEgp = parseIntegerEgpFromInput(crowdfundCoFundInput);
                        if (coFundEgp <= 0) {
                          toast.error(t('enterPositiveEgpAmount'));
                          return;
                        }
                        try {
                          const {
                            data: { session },
                          } = await supabase.auth.getSession();
                          if (!session?.user?.id) {
                            onRequestAuth?.();
                            return;
                          }
                          const { data: p } = await supabase
                            .from('profiles')
                            .select('wallet_balance, frozen_balance')
                            .eq('id', session.user.id)
                            .maybeSingle();
                          const wb = profileWalletBalanceEgp(p?.wallet_balance);
                          const fr = profileWalletBalanceEgp(p?.frozen_balance);
                          const target = Number(selectedMission.amount_target ?? coFundEgp);
                          const sec = workerCanSecureMissionDeposit(
                            wb,
                            fr,
                            selectedMission.category,
                            target
                          );
                          if (isSecurityDepositFailure(sec)) {
                            toast.error(
                              sec.reason === 'frozen_exceeds_wallet'
                                ? t('walletFrozenInvariantError')
                                : t('insufficientSecurityDepositFunds')
                            );
                            return;
                          }
                          setIsAccepting(true);
                          await handleCoFundMission(selectedMission.id, floorEgp(coFundEgp));
                          toast.success(t('mapToastCoFundSuccess'));
                          await fetchMissions();
                          closeCrowdfundConfirm();
                          handleCloseMissionBriefing();
                        } catch (e: any) {
                          toast.error(t('mapToastCoFundFailed'));
                        } finally {
                          setIsAccepting(false);
                        }
                      }}
                      className={`w-full px-4 py-4 text-left transition-all hover:border-amber-400/50 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 ${PROFILE_GLASS_PANEL}`}
                    >
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-300">
                        {t('addFunds') || 'Add Funds'} / {t('closeDeal') || 'Close deal'}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {t('differenceDeductedFromWallet')}
                      </p>
                    </button>

                    <button
                      type="button"
                      disabled={isAccepting || !(Number(crowdfundBidAmount ?? 0) > 0)}
                      onClick={async () => {
                        if (!selectedMission) return;
                        const amt = floorEgp(crowdfundBidAmount ?? 0);
                        if (!(amt > 0)) return;
                        try {
                          const {
                            data: { session },
                          } = await supabase.auth.getSession();
                          if (!session?.user?.id) {
                            onRequestAuth?.();
                            return;
                          }
                          const { data: p } = await supabase
                            .from('profiles')
                            .select('wallet_balance, frozen_balance')
                            .eq('id', session.user.id)
                            .maybeSingle();
                          const wb = profileWalletBalanceEgp(p?.wallet_balance);
                          const fr = profileWalletBalanceEgp(p?.frozen_balance);
                          const target = Number(selectedMission.amount_target ?? crowdfundBidAmount);
                          const sec = workerCanSecureMissionDeposit(
                            wb,
                            fr,
                            selectedMission.category,
                            target
                          );
                          if (isSecurityDepositFailure(sec)) {
                            toast.error(
                              sec.reason === 'frozen_exceeds_wallet'
                                ? t('walletFrozenInvariantError')
                                : t('insufficientSecurityDepositFunds')
                            );
                            return;
                          }
                          setIsAccepting(true);
                          await placePendingBid(selectedMission.id, amt);
                          await fetchMissions();
                          closeCrowdfundConfirm();
                          handleCloseMissionBriefing();
                        } catch (e: any) {
                          toast.error(t('mapToastPendingBidFailed'));
                        } finally {
                          setIsAccepting(false);
                        }
                      }}
                      className={`w-full px-4 py-4 text-left transition-all hover:border-sky-400/50 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 ${PROFILE_GLASS_PANEL}`}
                    >
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-sky-300">
                        {t('waitUntilFillsUpDonation')}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {t('bidRemainsPending')}
                      </p>
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
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

      <TrustDepositInfoModal open={trustDepositInfoOpen} onClose={() => setTrustDepositInfoOpen(false)} />

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
