import React, { useState, useCallback, useEffect, useMemo } from 'react';
import Map, { NavigationControl, GeolocateControl, MapRef, Source, Layer } from 'react-map-gl';
import type { GeoJSONSource, MapMouseEvent, PointLike } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import imageCompression from 'browser-image-compression';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabaseClient';
import TrustDepositInfoModal from './TrustDepositInfoModal';
import {
  workerCanSecureMissionDeposit,
  isSecurityDepositFailure,
  checkHomeMissionWorkerVerification,
} from '../src/lib/trustDeposit';
import CreateMission from './CreateMission';
import type { PhotoVerificationState } from './CreateMission';
import { validateMissionDescription } from '../src/lib/missionContentPolicy';
import {
  PROFILE_GLASS_PANEL,
  HOME_MIN_PRICE,
  HOME_MAX_PRICE,
  CITY_MIN_PRICE,
  CITY_MAX_PRICE,
  USD_TO_EGP_RATE,
  SCOUT_STAKE_FEE_EGP,
} from '../constants';
import { formatEgp, formatEgpDigits } from '../src/lib/formatMoney';
import { usdInputToEgp } from '../src/lib/walletCredit';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const EGYPT_MAX_BOUNDS: [[number, number], [number, number]] = [[24.0, 21.0], [38.0, 32.5]];

const isInsideEgyptBounds = (lng: number, lat: number) =>
  lng >= EGYPT_MAX_BOUNDS[0][0] &&
  lng <= EGYPT_MAX_BOUNDS[1][0] &&
  lat >= EGYPT_MAX_BOUNDS[0][1] &&
  lat <= EGYPT_MAX_BOUNDS[1][1];

type TaskType = 'city' | 'home';

interface JobOnMap {
  id: string;
  category: 'public' | 'home' | 'office' | string;
  amount_target: number;
  current_funding?: number | null;
  location_lat: number;
  location_lng: number;
  status: string;
  cleaner_id?: string | null;
  creator_id?: string | null;
  description?: string | null;
  photo_urls?: string[] | null;
  after_photo_urls?: string[] | null;
  created_at?: string | null;
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

/** Small square footprint (meters half-edge) for fill-extrusion towers from a point. */
function footprintSquareRing(lng: number, lat: number, halfMeters = 6): [number, number][] {
  const cos = Math.cos((lat * Math.PI) / 180);
  const dLat = halfMeters / 111320;
  const dLng = halfMeters / (111320 * Math.max(0.25, cos));
  return [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat + dLat],
    [lng - dLng, lat - dLat],
  ];
}

/** Values must match fill-extrusion `match` paint (open / bidded / completed). */
function towerStatusForJob(job: JobOnMap, bidCount: number): 'open' | 'bidded' | 'completed' {
  if (job.status === 'completed') return 'completed';
  if (job.status === 'in_progress') return 'bidded';
  if (bidCount > 0) return 'bidded';
  return 'open';
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
      id: 'water',
      type: 'fill',
      source: 'composite',
      'source-layer': 'water',
      paint: {
        'fill-color': '#808080',
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
  const mapRef = React.useRef<MapRef>(null);
  const [viewState, setViewState] = useState({
    latitude: 27.2579,
    longitude: 33.8116,
    zoom: 12,
    pitch: 45,
    bearing: 0,
  });

  const [jobs, setJobs] = useState<JobOnMap[]>([]);
  /** 3D tower hover (GeoJSON mission_id). */
  const [hoveredTowerMissionId, setHoveredTowerMissionId] = useState<string | null>(null);

  const [selectedLocation, setSelectedLocation] = useState<
    { lat: number; lng: number } | null
  >(selectedCoords || null);

  // Adaptive UI: task type selected = show form overlay
  const [taskTypeSelected, setTaskTypeSelected] = useState<TaskType | null>(null);
  const [taskType, setTaskType] = useState<TaskType>('city');
  const [orderAmount, setOrderAmount] = useState('');
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
  const [mapToast, setMapToast] = useState<string | null>(null);

  const toast = {
    error: (message: string) => {
      setMapToast(message);
      window.setTimeout(() => setMapToast(null), 2600);
    },
  };

  const selectTaskType = useCallback((type: TaskType) => {
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

  // Bidding modal state
  const [bidJob, setBidJob] = useState<JobOnMap | null>(null);
  const [bidAmount, setBidAmount] = useState('');
  /** Bid modal: raw input is interpreted as EGP or USD (converted at {@link USD_TO_EGP_RATE}). */
  const [bidInputCurrency, setBidInputCurrency] = useState<'EGP' | 'USD'>('EGP');
  const [bidSubmitting, setBidSubmitting] = useState(false);
  const [bidError, setBidError] = useState<string | null>(null);
  const [bidSuccess, setBidSuccess] = useState<string | null>(null);

  const [activeBidCounts, setActiveBidCounts] = useState<Record<string, number>>({});

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) =>
      setCurrentUserId(session?.user?.id ?? null)
    );
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUserId(session?.user?.id ?? null);
    });
    return () => subscription.unsubscribe();
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
        cleaner_id,
        creator_id,
        description,
        photo_urls,
        after_photo_urls,
        created_at,
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

    const list: JobOnMap[] = (data || []).filter(
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

  const executePaymentFlow = useCallback(
    async (payload: {
      amount: number;
      taskType: TaskType;
      location: { lat: number; lng: number };
      description: string;
      creatorPhotos?: string[];
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) return;

      const res = await fetch('/api/paymob-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'mission_creation',
          category: payload.taskType === 'city' ? 'public' : 'home',
          amount_target: payload.amount,
          userId: session.user.id,
          location_lat: payload.location.lat,
          location_lng: payload.location.lng,
          description: payload.description || undefined,
          creator_photos:
            payload.creatorPhotos && payload.creatorPhotos.length > 0
              ? payload.creatorPhotos
              : undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Payment init failed (${res.status})`);
      }

      const data = (await res.json()) as {
        paymentUrl?: string;
        paymentToken?: string;
      };

      if (data.paymentUrl) {
        sessionStorage.setItem('paymentReturnType', 'mission_creation');
        window.location.assign(data.paymentUrl);
        return;
      }
      if (data.paymentToken) {
        sessionStorage.setItem('paymentReturnType', 'mission_creation');
        const iframeId =
          (import.meta.env.VITE_PAYMOB_IFRAME_ID as string | undefined) || '1007120';
        const url = `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${data.paymentToken}`;
        window.location.assign(url);
      } else {
        throw new Error('No payment URL or token received.');
      }
    },
    []
  );

  useEffect(() => {
    const run = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) return;

      const raw = localStorage.getItem(PENDING_SUBMIT_KEY);
      if (!raw) return;

      try {
        const saved = JSON.parse(raw) as {
          taskType?: TaskType;
          amount?: string | number;
          location_lat?: number;
          location_lng?: number;
          description?: string;
        };
        const amount = typeof saved.amount === 'number' ? saved.amount : parseFloat(String(saved.amount || '0').replace(',', '.'));
        if (isNaN(amount) || amount <= 0) {
          localStorage.removeItem(PENDING_SUBMIT_KEY);
          return;
        }
        if (typeof saved.location_lat !== 'number' || typeof saved.location_lng !== 'number') {
          localStorage.removeItem(PENDING_SUBMIT_KEY);
          return;
        }

        localStorage.removeItem(PENDING_SUBMIT_KEY);

        setTaskType(saved.taskType || 'city');
        setTaskTypeSelected(saved.taskType || 'city');
        setOrderAmount(String(amount));
        setSelectedLocation({ lat: saved.location_lat, lng: saved.location_lng });
        setOrderDescription(saved.description || '');
        setOrderError(null);
        setOrderSuccess(null);

        await executePaymentFlow({
          amount,
          taskType: (saved.taskType as TaskType) || 'city',
          location: { lat: saved.location_lat, lng: saved.location_lng },
          description: saved.description || '',
        });
      } catch (e) {
        console.error('Pending submit restore error:', e);
        localStorage.removeItem(PENDING_SUBMIT_KEY);
      }
    };
    run();
  }, [executePaymentFlow]);

  const handleMapClick = useCallback(
    (event: any) => {
      if (!event?.lngLat) return;
      const { lng, lat } = event.lngLat;
      if (!isInsideEgyptBounds(lng, lat)) {
        toast.error(t('geofenceEgyptShelf'));
        return;
      }

      setSelectedLocation({ lat, lng });
      onLocationSelect(lat, lng);
    },
    [onLocationSelect, t]
  );

  const [selectedMission, setSelectedMission] = useState<JobOnMap | null>(null);
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [isTranslationLoading, setIsTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [showTranslateAction, setShowTranslateAction] = useState(false);
  const [hallOfFameMission, setHallOfFameMission] = useState<JobOnMap | null>(null);
  const [hallOfFameCleanerName, setHallOfFameCleanerName] = useState<string | null>(null);
  const [hallOfFameHeroes, setHallOfFameHeroes] = useState<string[]>([]);
  const [isAccepting, setIsAccepting] = useState(false);
  /** Worker wallet + frozen (EGP) for security deposit checks on the selected mission. */
  const [workerTrustSnapshot, setWorkerTrustSnapshot] = useState<{
    wallet: number;
    frozen: number;
    isVerified: boolean;
  } | null>(null);
  const [showBidInput, setShowBidInput] = useState(false);
  const [missionBidAmount, setMissionBidAmount] = useState<string>('');
  const [missionBidCurrency, setMissionBidCurrency] = useState<'EGP' | 'USD'>('EGP');
  const [showCrowdfundConfirm, setShowCrowdfundConfirm] = useState(false);
  const [crowdfundBidAmount, setCrowdfundBidAmount] = useState<number | null>(null);
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
          .select('id, user_id, mission_id, amount, type, gateway, created_at')
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

  const handleMarkerClick = useCallback((job: JobOnMap) => {
    setSelectedMission(job);
    setShowBidInput(false);
    setMissionBidAmount(String(job.amount_target ?? ''));
    setMissionBidCurrency('EGP');
  }, []);

  const handleMapClickWithTowers = useCallback(
    (event: any) => {
      const f = event?.features?.find(
        (x: { layer?: { id?: string } }) =>
          x.layer?.id === 'mission-towers' || x.layer?.id === 'mission-towers-hover'
      );
      const mid = f?.properties?.mission_id;
      if (mid != null) {
        const job = jobs.find((j) => j.id === String(mid));
        if (job) {
          handleMarkerClick(job);
          return;
        }
      }
      handleMapClick(event);
    },
    [jobs, handleMarkerClick, handleMapClick]
  );

  const handleCloseMissionBriefing = useCallback(() => {
    setSelectedMission(null);
    setTranslatedText(null);
    setIsTranslationLoading(false);
    setTranslationError(null);
    setShowTranslateAction(false);
    setShowBidInput(false);
    setMissionBidAmount('');
    setMissionBidCurrency('EGP');
    setShowDonate(false);
    setDonateAmount('');
    setSelectedRating(0);
  }, []);

  const closeCrowdfundConfirm = useCallback(() => {
    setShowCrowdfundConfirm(false);
    setCrowdfundBidAmount(null);
  }, []);

  const handleCoFundMission = useCallback(
    async (missionId: string, bidAmount: number) => {
      const { error } = await supabase.rpc('co_fund_and_accept_mission', {
        p_mission_id: missionId,
        p_bid_amount: bidAmount,
      });
      if (error) throw error;
    },
    []
  );

  const handleDonate = useCallback(
    async (amount: number) => {
      if (!selectedMission) return;
      const value = Number(amount);
      if (!Number.isFinite(value) || value <= 0) {
        alert(t('enterPositiveEgpAmount'));
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
          alert(error.message || 'Failed to process donation. Please try again.');
          return;
        }
        // Optimistically update local mission funding so UI reflects change immediately
        setSelectedMission((prev) =>
          prev
            ? {
                ...prev,
                current_funding: Number(prev.current_funding || 0) + value,
              }
            : prev
        );
        alert('Thank you for your donation!');
        setShowDonate(false);
        setDonateAmount('');
        await fetchMissions();
      } catch (e: any) {
        alert(e?.message || 'Failed to process donation. Please try again.');
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
        alert('Please select a rating between 1 and 5 stars.');
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
          alert(error.message || 'Failed to submit rating. Please try again.');
          return;
        }

        alert('Thank you for rating the cleaner!');
        setReviewedMissions((prev) => {
          const next = new Set(prev);
          next.add(selectedMission.id);
          return next;
        });
        setSelectedRating(0);
      } catch (e: any) {
        alert(e?.message || 'Failed to submit rating. Please try again.');
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
        bid_amount: bidAmount,
        status: 'pending',
      });
      if (error) {
        throw error;
      }
    },
    [onRequestAuth]
  );

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
        alert('You cannot bid on your own job.');
        return;
      }
      const raw = parseFloat((missionBidAmount || '').replace(',', '.'));
      if (isNaN(raw) || raw <= 0) {
        alert(t('enterPositiveEgpAmount'));
        return;
      }
      const amtEgp =
        missionBidCurrency === 'USD'
          ? usdInputToEgp(raw, USD_TO_EGP_RATE)
          : Math.round(raw * 100) / 100;
      if (amtEgp <= 0) {
        alert(t('enterPositiveEgpAmount'));
        return;
      }

      // Crowdfunding logic for public missions (amounts in EGP):
      if (selectedMission.category === 'public') {
        const currentFunding = Number(selectedMission.current_funding ?? 0);
        if (Number.isFinite(currentFunding) && amtEgp > currentFunding) {
          setCrowdfundBidAmount(amtEgp);
          setShowCrowdfundConfirm(true);
          return;
        }
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
          alert(t('verificationPromptOnlyVerified'));
          return;
        }
        const wb = Number(profile?.wallet_balance ?? 0);
        const fr = Number(profile?.frozen_balance ?? 0);
        const target = Number(selectedMission.amount_target ?? amtEgp);
        const sec = workerCanSecureMissionDeposit(wb, fr, selectedMission.category, target);
        if (isSecurityDepositFailure(sec)) {
          if (sec.reason === 'insufficient_funds' && sec.shortfallEgp != null && sec.shortfallEgp > 0) {
            alert(t('needDepositEgp', { amount: formatEgp(sec.shortfallEgp) }));
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
          alert(
            'Tip: Add your WhatsApp number in your Profile so we can notify you about mission updates.'
          );
        }
      }

      // Default behavior: place a pending bid (EGP)
      await placePendingBid(selectedMission.id, amtEgp);

      await fetchMissions();
      handleCloseMissionBriefing();
    } catch (err: any) {
      alert(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsAccepting(false);
    }
  }, [
    fetchMissions,
    handleCloseMissionBriefing,
    missionBidAmount,
    missionBidCurrency,
    onRequestAuth,
    placePendingBid,
    selectedMission,
    t,
  ]);

  const handleCloseBidModal = useCallback(() => {
    if (!bidSubmitting) {
      setBidJob(null);
      setBidAmount('');
      setBidInputCurrency('EGP');
      setBidError(null);
      setBidSuccess(null);
    }
  }, [bidSubmitting]);

  const handlePlaceBid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bidJob) return;
    setBidError(null);
    setBidSuccess(null);

    const raw = parseFloat(bidAmount.replace(',', '.'));
    if (isNaN(raw) || raw <= 0) {
      setBidError(t('enterPositiveEgpAmount'));
      return;
    }
    const bidEgp =
      bidInputCurrency === 'USD'
        ? usdInputToEgp(raw, USD_TO_EGP_RATE)
        : Math.round(raw * 100) / 100;
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
        setBidError('You must be signed in to place a bid.');
        return;
      }
      const userId = session.user.id;

      // Crowdfunding logic for public missions (bid modal) — compare EGP to EGP
      if (bidJob.category === 'public') {
        const currentFunding = Number(bidJob.current_funding ?? 0);
        if (Number.isFinite(currentFunding) && bidEgp > currentFunding) {
          setCrowdfundBidAmount(bidEgp);
          setSelectedMission(bidJob);
          setShowCrowdfundConfirm(true);
          return;
        }
      }

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
          setBidError(
            'Tip: Add your WhatsApp number in your Profile so we can notify you about mission updates.'
          );
          return;
        }
      }

      await placePendingBid(bidJob.id, bidEgp);

      setBidSuccess('Bid placed successfully.');
      setBidAmount('');
      await fetchMissions();
      setTimeout(() => {
        handleCloseBidModal();
      }, 1200);
    } catch (err) {
      console.error('Bid exception:', err);
      setBidError('Unexpected error. Please try again.');
    } finally {
      setBidSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrderError(null);
    setOrderSuccess(null);

    const amount = parseFloat(orderAmount.replace(',', '.'));
    if (isNaN(amount) || amount <= 0) {
      setOrderError(t('enterPositiveEgpAmount'));
      return;
    }
    if (taskType === 'home') {
      if (amount < HOME_MIN_PRICE || amount > HOME_MAX_PRICE) {
        setOrderError(t('homePriceRangeEgp', { min: HOME_MIN_PRICE, max: HOME_MAX_PRICE }));
        return;
      }
    } else {
      if (amount < CITY_MIN_PRICE || amount > CITY_MAX_PRICE) {
        setOrderError(t('cityPriceRangeEgp', { min: CITY_MIN_PRICE, max: CITY_MAX_PRICE }));
        return;
      }
    }
    if (!selectedLocation) {
      setOrderError('Tap on the map to choose a location.');
      return;
    }
    if ((orderDescription || '').trim().length < 20) {
      setOrderError('Please provide a detailed description so the worker and AI know exactly what to do.');
      return;
    }
    const policy = validateMissionDescription(orderDescription);
    if (!policy.ok) {
      setOrderError('error' in policy ? policy.error : 'Invalid description.');
      return;
    }
    if (orderPhotos.length > 0) {
      if (photoVerification.verifying) {
        setOrderError(t('waitForAiVerification'));
        return;
      }
      if (!photoVerification.allApproved) {
        setOrderError(t('missionPhotoRejected'));
        return;
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
            amount,
            location_lat: selectedLocation.lat,
            location_lng: selectedLocation.lng,
            description: orderDescription || '',
          })
        );
        setOrderSubmitting(false);
        onRequestAuth?.();
        return;
      }

      // For City (public) missions, confirm Scout Stake before proceeding
      if (taskType === 'city') {
        const confirmed = window.confirm(
          t('cityPinScoutStakeConfirm', { amount: formatEgp(CITY_MIN_PRICE) })
        );
        if (!confirmed) {
          setOrderSubmitting(false);
          return;
        }
      }

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

      // 2) For City (public) missions, create mission via RPC (Scout Stake fee in EGP in DB)
      if (taskType === 'city') {
        const { error } = await supabase.rpc('create_public_mission_with_fee', {
          p_title: orderDescription || 'City Mission',
          p_description: orderDescription || null,
          p_amount_target: amount,
          p_location_lat: selectedLocation.lat,
          p_location_lng: selectedLocation.lng,
          p_photo_urls: creatorPhotoUrls || [],
        });

        if (error) {
          console.error('Create public mission error:', error);
          setOrderError(
            error.message ||
              t('cityMissionWalletHint', { amount: formatEgp(CITY_MIN_PRICE) })
          );
          return;
        }

        // Telegram notification (non-blocking)
        try {
          const botToken = import.meta.env.VITE_TELEGRAM_BOT_TOKEN as string | undefined;
          const chatId = import.meta.env.VITE_TELEGRAM_ADMIN_CHAT_ID as string | undefined;
          const photoUrls = creatorPhotoUrls || [];
          const hasPhoto = photoUrls.length > 0;
          const caption = `🚨 *NEW MISSION* 🚨\n💰 Reward: ${formatEgp(Number(amount))}\n📝 Task: ${orderDescription || t('cityCleaning')}`;

          if (botToken && chatId) {
            if (hasPhoto) {
              fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: chatId,
                  photo: photoUrls[0],
                  caption,
                  parse_mode: 'Markdown',
                }),
              }).catch((err) => console.error('Telegram sendPhoto failed:', err));
            } else {
              fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: chatId,
                  text: caption,
                  parse_mode: 'Markdown',
                }),
              }).catch((err) => console.error('Telegram sendMessage failed:', err));
            }
          }
        } catch (err) {
          console.error('Telegram notification error:', err);
        }

        setOrderSuccess(t('cityMissionCreatedScout', { amount: formatEgp(CITY_MIN_PRICE) }));
        setOrderAmount('');
        setOrderDescription('');
        setOrderPhotos([]);
        setDescriptionPolicyError(null);
        setPhotoVerification({ verifying: false, allApproved: true, hasRejected: false });
        setSelectedLocation(null);
        await fetchMissions();
        return;
      }

      // 3) For Home missions, keep existing Paymob flow with creator photos
      await executePaymentFlow({
        amount,
        taskType,
        location: selectedLocation,
        description: orderDescription || '',
        creatorPhotos: creatorPhotoUrls,
      });
    } catch (err) {
      console.error('Job submit exception:', err);
      setOrderError(
        err instanceof Error ? err.message : 'Unexpected error. Please try again.'
      );
    } finally {
      setUploadingProof(false);
      setOrderSubmitting(false);
    }
  };

  const missionTrustBlocked = useMemo(() => {
    if (!showBidInput || !selectedMission || workerTrustSnapshot === null) return false;
    const homeOk = checkHomeMissionWorkerVerification(
      selectedMission.category,
      workerTrustSnapshot.isVerified
    );
    if (!homeOk.ok) return true;
    return !workerCanSecureMissionDeposit(
      workerTrustSnapshot.wallet,
      workerTrustSnapshot.frozen,
      selectedMission.category,
      Number(selectedMission.amount_target ?? 0)
    ).ok;
  }, [showBidInput, selectedMission, workerTrustSnapshot]);

  const missionsHeatmapGeoJSON = useMemo(() => {
    const features = (jobs || [])
      .filter(missionEligibleForMapPin)
      .filter(
        (j) =>
          Number.isFinite(j.location_lat) &&
          Number.isFinite(j.location_lng)
      )
      .map((j) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [j.location_lng, j.location_lat],
        },
        properties: {
          funding: Math.max(
            0,
            Number(j.current_funding ?? j.amount_target ?? 0)
          ),
        },
      }));
    return { type: 'FeatureCollection' as const, features };
  }, [jobs]);

  /** Polygon footprints + funding/status for 3D funding towers (same missions as heatmap). */
  const missionTowersGeoJSON = useMemo(() => {
    const features = (jobs || [])
      .filter(missionEligibleForMapPin)
      .filter((j) => Number.isFinite(j.location_lat) && Number.isFinite(j.location_lng))
      .map((j) => {
        const fundingEgp = Math.round(Math.max(0, Number(j.current_funding ?? 0)));
        const bids = activeBidCounts[j.id] || 0;
        return {
          type: 'Feature' as const,
          geometry: {
            type: 'Polygon' as const,
            coordinates: [footprintSquareRing(j.location_lng, j.location_lat, 6)],
          },
          properties: {
            mission_id: j.id,
            funding_egp: fundingEgp,
            status: towerStatusForJob(j, bids),
          },
        };
      });
    return { type: 'FeatureCollection' as const, features };
  }, [jobs, activeBidCounts]);

  /** Point centers for ground glow (same missions as towers). */
  const missionTowersPointsGeoJSON = useMemo(() => {
    const features = (jobs || [])
      .filter(missionEligibleForMapPin)
      .filter((j) => Number.isFinite(j.location_lat) && Number.isFinite(j.location_lng))
      .map((j) => {
        const fundingEgp = Math.round(Math.max(0, Number(j.current_funding ?? 0)));
        const bids = activeBidCounts[j.id] || 0;
        return {
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [j.location_lng, j.location_lat],
          },
          properties: {
            mission_id: j.id,
            funding_egp: fundingEgp,
            status: towerStatusForJob(j, bids),
          },
        };
      });
    return { type: 'FeatureCollection' as const, features };
  }, [jobs, activeBidCounts]);

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

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map?.isStyleLoaded()) return;
    const src = map.getSource('missions-heatmap') as GeoJSONSource | undefined;
    if (src?.setData) {
      src.setData(missionsHeatmapGeoJSON as Parameters<GeoJSONSource['setData']>[0]);
    }
  }, [missionsHeatmapGeoJSON]);

  /** Hover highlight + cursor for funding towers. */
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    const onMove = (e: MapMouseEvent) => {
      if (mapMarkerLayerSuppressed) {
        map.getCanvas().style.cursor = '';
        setHoveredTowerMissionId(null);
        return;
      }
      const feats = map.queryRenderedFeatures(e.point as PointLike, {
        layers: ['mission-towers'],
      });
      if (feats.length > 0) {
        map.getCanvas().style.cursor = 'pointer';
        const id = feats[0].properties?.mission_id;
        if (id != null) setHoveredTowerMissionId(String(id));
      } else {
        map.getCanvas().style.cursor = '';
        setHoveredTowerMissionId(null);
      }
    };

    map.on('mousemove', onMove);
    return () => {
      map.off('mousemove', onMove);
      map.getCanvas().style.cursor = '';
    };
  }, [mapMarkerLayerSuppressed, missionTowersGeoJSON]);

  return (
    <div className="w-full h-screen relative bg-black overflow-hidden">
      {/* Full-screen 3D map — no blocking overlays */}
      <Map
        ref={mapRef}
        {...viewState}
        antialias
        onMove={(evt) => setViewState(evt.viewState)}
        interactiveLayerIds={['mission-towers', 'mission-towers-hover']}
        onClick={handleMapClickWithTowers}
        maxBounds={EGYPT_MAX_BOUNDS}
        onLoad={(e: any) => {
          const map = e?.target;
          if (!map) return;

          map.setFog({
            range: [0.8, 8],
            color: '#1a1f35',
            'horizon-blend': 0.5,
            'high-color': '#000000',
            'space-color': '#000000',
            'star-intensity': 0.8,
          });

          const hour = new Date().getHours();
          const isNight = hour >= 18 || hour < 6;
          try {
            map.setConfigProperty?.('basemap', 'lightPreset', isNight ? 'night' : 'day');
          } catch {
            /* Custom vector style may not expose Standard basemap config */
          }

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
                  'fill-extrusion-color': '#222',
                  'fill-extrusion-height': ['get', 'height'],
                  'fill-extrusion-base': ['get', 'min_height'],
                  'fill-extrusion-opacity': 0.8,
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

        {/* Soft ground glow (cyan / yellow / green) — only with 3D towers (zoom > 12). */}
        <Source id="mission-towers-points" type="geojson" data={missionTowersPointsGeoJSON}>
          <Layer
            id="mission-towers-glow"
            type="circle"
            minzoom={13}
            paint={{
              'circle-radius': 22,
              'circle-blur': 0.85,
              'circle-opacity': mapMarkerLayerSuppressed ? 0.04 : 0.55,
              'circle-color': [
                'match',
                ['get', 'status'],
                'open',
                '#00FFFF',
                'bidded',
                '#FFFF00',
                'completed',
                '#00FF00',
                '#00FFFF',
              ],
            }}
          />
        </Source>

        {/* 3D funding towers — native fill-extrusion only at zoom > 12 (minzoom 13). */}
        <Source id="mission-towers" type="geojson" data={missionTowersGeoJSON}>
          <Layer
            id="mission-towers"
            type="fill-extrusion"
            minzoom={13}
            paint={{
              'fill-extrusion-height': [
                'interpolate',
                ['linear'],
                ['coalesce', ['get', 'funding_egp'], 0],
                0,
                0,
                100,
                10,
                1000,
                50,
                10000,
                200,
              ],
              'fill-extrusion-base': 0,
              'fill-extrusion-color': [
                'match',
                ['get', 'status'],
                'open',
                '#00FFFF',
                'bidded',
                '#FFFF00',
                'completed',
                '#00FF00',
                '#00FFFF',
              ],
              'fill-extrusion-opacity': mapMarkerLayerSuppressed ? 0.06 : 0.8,
            }}
          />
          <Layer
            id="mission-towers-hover"
            type="fill-extrusion"
            minzoom={13}
            filter={
              hoveredTowerMissionId
                ? (['==', ['get', 'mission_id'], hoveredTowerMissionId] as any)
                : (['==', ['literal', 1], ['literal', 0]] as any)
            }
            paint={{
              'fill-extrusion-height': [
                'interpolate',
                ['linear'],
                ['coalesce', ['get', 'funding_egp'], 0],
                0,
                0,
                100,
                10,
                1000,
                50,
                10000,
                200,
              ],
              'fill-extrusion-base': 0,
              'fill-extrusion-color': '#00FFFF',
              'fill-extrusion-opacity': mapMarkerLayerSuppressed ? 0 : 1,
            }}
          />
          <Layer
            id="mission-towers-labels"
            type="symbol"
            minzoom={13}
            layout={{
              'text-field': ['to-string', ['round', ['coalesce', ['get', 'funding_egp'], 0]]],
              'text-size': 13,
              'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
              'text-anchor': 'bottom',
              'text-offset': [0, 0],
              'text-allow-overlap': true,
            }}
            paint={{
              'text-color': '#ffffff',
              'text-halo-color': '#0a0a0a',
              'text-halo-width': 2.2,
              'text-halo-blur': 0.3,
              'text-opacity': mapMarkerLayerSuppressed ? 0.06 : 1,
            }}
          />
        </Source>
      </Map>

      {/* Minimalist overlays — wrapper is pointer-events-none so map stays interactive */}
      <div className="absolute inset-0 pointer-events-none z-[80] flex flex-col">
        {/* Header: CleanEgypt.co (non-interactive) + profile avatar (clickable) */}
        <header className="flex items-center justify-between px-5 pt-5">
          <h1 className="text-sm font-medium tracking-wide text-white pointer-events-none">
            CleanEgypt.co
          </h1>
          <button
            type="button"
            onClick={onAvatarClick}
            className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white hover:border-emerald-400/50 hover:shadow-[0_0_16px_rgba(16,185,129,0.3)] transition-all"
          >
            👤
          </button>
        </header>

        {/* Upper center: heading is non-interactive; only pill buttons capture clicks */}
        {!taskTypeSelected && (
          <div className="flex-1 flex flex-col items-center pt-[18vh] px-6">
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-10 text-center tracking-tight pointer-events-none">
              {t('whatNeedsCleaning')}
            </h2>
            <div className="flex flex-col sm:flex-row gap-4 w-full max-w-sm justify-center pointer-events-auto">
              <button
                type="button"
                onClick={() => selectTaskType('city')}
                className="rounded-full px-6 py-3.5 bg-black/60 backdrop-blur-md border-2 border-emerald-400/60 text-white font-medium text-sm shadow-[0_0_28px_rgba(52,211,153,0.5)] hover:shadow-[0_0_36px_rgba(52,211,153,0.6)] hover:border-emerald-400 transition-all active:scale-[0.98]"
              >
                {t('cleanCityArea')}
              </button>
              <button
                type="button"
                onClick={() => selectTaskType('home')}
                className="rounded-full px-6 py-3.5 bg-black/60 backdrop-blur-md border-2 border-amber-400/60 text-white font-medium text-sm shadow-[0_0_28px_rgba(251,191,36,0.5)] hover:shadow-[0_0_36px_rgba(251,191,36,0.6)] hover:border-amber-400 transition-all active:scale-[0.98]"
              >
                {t('cleanYourHomeOffice')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Adaptive form — slides up from bottom only after City or Home selected */}
      {taskTypeSelected && (
        <div
          className="absolute inset-0 z-[9999] flex items-end justify-center p-4 pt-[env(safe-area-inset-top)] pointer-events-none isolate"
          aria-hidden="false"
        >
          <div
            className="absolute inset-0 bg-black/55 backdrop-blur-md pointer-events-none"
            aria-hidden
          />
          <div className={`pointer-events-auto relative z-[1] w-full max-w-xl space-y-4 animate-slide-up p-5 shadow-2xl ${PROFILE_GLASS_PANEL}`}>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-center justify-between mb-2">
                <button
                  type="button"
                  onClick={closeFormOverlay}
                  disabled={orderSubmitting}
                  className="text-slate-500 hover:text-white text-lg font-bold disabled:opacity-40 mr-2"
                >
                  ✕
                </button>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                  {taskType === 'city' ? t('cleanCityArea') : t('cleanYourHomeOffice')}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                    {taskType === 'city'
                      ? isRu
                        ? 'Цель сбора (Предполагаемая стоимость)'
                        : 'Collection Target (Goal)'
                      : t('amountUsd')}
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={orderAmount}
                    onChange={(e) => setOrderAmount(e.target.value)}
                    placeholder={
                      taskType === 'city'
                        ? isRu
                          ? 'Цель сбора (Предполагаемая стоимость)'
                          : 'Collection Target (Goal)'
                        : t('anyAmount')
                    }
                    className={`w-full ${PROFILE_GLASS_PANEL} px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500`}
                  />
                  {taskType === 'city' && (
                    <p className="mt-2 text-[10px] text-slate-500 leading-relaxed">
                      {t('cityPinScoutStakeFormHint', { amount: formatEgp(SCOUT_STAKE_FEE_EGP) })}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                    {t('location')}
                  </label>
                  <div className={`relative flex items-center gap-2 ${PROFILE_GLASS_PANEL} px-3 py-2.5`}>
                    <input
                      type="text"
                      value={
                        selectedLocation
                          ? `${selectedLocation.lat.toFixed(6)}, ${selectedLocation.lng.toFixed(6)}`
                          : ''
                      }
                      onChange={(e) => {
                        const value = e.target.value;
                        // allow manual editing; if looks like "lat, lng" try to parse
                        if (value.includes(',')) {
                          const [latStr, lngStr] = value.split(',').map((s) => s.trim());
                          const latNum = parseFloat(latStr);
                          const lngNum = parseFloat(lngStr);
                          if (
                            Number.isFinite(latNum) &&
                            Number.isFinite(lngNum) &&
                            latNum >= -90 &&
                            latNum <= 90 &&
                            lngNum >= -180 &&
                            lngNum <= 180
                          ) {
                            if (!isInsideEgyptBounds(lngNum, latNum)) {
                              toast.error(t('geofenceEgyptShelf'));
                              return;
                            }
                            setSelectedLocation({ lat: latNum, lng: lngNum });
                            mapRef.current?.flyTo({
                              center: [lngNum, latNum],
                              zoom: 16,
                              essential: true,
                              duration: 1500,
                            });
                            return;
                          }
                        }
                      }}
                      onPaste={(e: React.ClipboardEvent<HTMLInputElement>) => {
                        const text = e.clipboardData.getData('text');
                        if (text && text.includes(',')) {
                          e.preventDefault();
                          const [latStr, lngStr] = text.split(',').map((s) => s.trim());
                          const latNum = parseFloat(latStr);
                          const lngNum = parseFloat(lngStr);
                          if (
                            Number.isFinite(latNum) &&
                            Number.isFinite(lngNum) &&
                            latNum >= -90 &&
                            latNum <= 90 &&
                            lngNum >= -180 &&
                            lngNum <= 180
                          ) {
                            if (!isInsideEgyptBounds(lngNum, latNum)) {
                              toast.error(t('geofenceEgyptShelf'));
                              return;
                            }
                            setSelectedLocation({ lat: latNum, lng: lngNum });
                            mapRef.current?.flyTo({
                              center: [lngNum, latNum],
                              zoom: 16,
                              essential: true,
                              duration: 1500,
                            });
                          }
                        }
                      }}
                      placeholder="Tap map or paste '27.320282, 33.708599'"
                      className="flex-1 bg-transparent border-0 outline-none text-xs text-slate-300 placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!navigator.geolocation) return;
                        navigator.geolocation.getCurrentPosition(
                          (pos) => {
                            const { latitude, longitude } = pos.coords;
                            if (!isInsideEgyptBounds(longitude, latitude)) {
                              toast.error(t('geofenceEgyptShelf'));
                              return;
                            }
                            setSelectedLocation({ lat: latitude, lng: longitude });
                            mapRef.current?.flyTo({
                              center: [longitude, latitude],
                              zoom: 16,
                              essential: true,
                              duration: 1500,
                            });
                          },
                          () => {
                            // silently ignore errors; user can still tap map manually
                          }
                        );
                      }}
                      className="absolute right-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-orange-500/60 text-orange-400 bg-orange-500/10 hover:bg-orange-500/20 hover:shadow-[0_0_8px_rgba(249,115,22,0.4)] text-[11px] transition-all"
                      aria-label="Use current location"
                    >
                      ◎
                    </button>
                  </div>
                  {!selectedLocation && (
                    <p className="mt-1 text-[10px] text-amber-300 uppercase tracking-[0.18em]">
                      {t('tapMapToSetLocation')}
                    </p>
                  )}
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
              />

              {(orderError || descriptionPolicyError) && (
                <p className="text-xs text-red-400 font-medium">
                  {orderError || descriptionPolicyError}
                </p>
              )}
              {orderSuccess && (
                <p className="text-xs text-emerald-400 font-medium">{orderSuccess}</p>
              )}

              <div
                className={`w-full mt-1 rounded-full ${taskType === 'city' ? 'animated-border-city' : 'animated-border-home'} ${
                  orderSubmitting ||
                  uploadingProof ||
                  !selectedLocation ||
                  !!descriptionPolicyError ||
                  (orderPhotos.length > 0 &&
                    (!photoVerification.allApproved || photoVerification.verifying))
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
                      (!photoVerification.allApproved || photoVerification.verifying))
                  }
                  className="animated-border-inner w-full rounded-full px-6 py-2 text-sm font-black uppercase tracking-[0.24em] transition-all text-orange-400 border border-orange-500/50 bg-orange-500/10 hover:bg-orange-500/20 hover:shadow-[0_0_15px_rgba(249,115,22,0.3)] disabled:cursor-not-allowed active:scale-[0.98]"
                >
                  {uploadingProof || orderSubmitting
                    ? t('processing')
                    : t('submitTaskAndPay')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bidding modal — dark glassmorphism */}
      {bidJob && (
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
                <div className="flex items-center justify-between gap-2 mb-2">
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                    {bidInputCurrency === 'USD' ? t('bidAmountLabelUsd') : t('bidAmountLabelEgp')}
                  </label>
                  <div className="flex rounded-full border border-slate-600 p-0.5 bg-slate-900/80">
                    <button
                      type="button"
                      onClick={() => setBidInputCurrency('EGP')}
                      className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                        bidInputCurrency === 'EGP' ? 'bg-emerald-500 text-black' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {t('depositCurrencyEgp')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setBidInputCurrency('USD')}
                      className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                        bidInputCurrency === 'USD' ? 'bg-emerald-500 text-black' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {t('depositCurrencyUsd')}
                    </button>
                  </div>
                </div>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={bidAmount}
                  onChange={(e) => setBidAmount(e.target.value)}
                  placeholder="Enter your bid amount"
                  className={`w-full ${PROFILE_GLASS_PANEL} px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500`}
                />
                {bidInputCurrency === 'USD' && bidAmount && Number(bidAmount) > 0 && (
                  <p className="mt-2 text-[10px] text-amber-200/90">
                    ≈ {formatEgp(usdInputToEgp(Number(bidAmount), USD_TO_EGP_RATE))} — {t('bidUsdToEgpHint', { rate: String(USD_TO_EGP_RATE) })}
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
                  disabled={bidSubmitting}
                  className="animated-border-inner w-full rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.24em] text-white bg-[#020617] hover:brightness-110 transition-all disabled:cursor-wait active:scale-[0.98]"
                >
                  {bidSubmitting ? 'Placing bid...' : 'Place bid'}
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
          className="absolute inset-0 z-[9999] flex items-end justify-center pt-[env(safe-area-inset-top)] isolate"
          aria-hidden="false"
        >
          <div
            className="absolute inset-0 bg-black/85 backdrop-blur-md"
            onClick={handleCloseMissionBriefing}
            aria-hidden="true"
          />
          <div
            className="relative w-full max-w-xl max-h-[100dvh] overflow-y-auto rounded-t-3xl bg-cyan-950/30 backdrop-blur-md border-t border-x border-cyan-500/20 shadow-[0_4px_30px_rgba(6,182,212,0.1)] px-6 pb-16 pt-10 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4 mt-2">
              <button
                type="button"
                onClick={handleCloseMissionBriefing}
                className="p-2 mr-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all"
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
                      <div key={index} className="min-w-full snap-center shrink-0">
                        <img
                          src={url}
                          alt={`Before (work scope) ${index + 1}`}
                          className="w-full h-48 object-cover rounded-xl shadow-md bg-slate-800"
                          onError={(e) => {
                            const el = e.currentTarget;
                            el.onerror = null;
                            el.src = 'data:image/svg+xml,' + encodeURIComponent(
                              '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><rect fill="%23334155" width="400" height="200"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%2394a3b8" font-size="14" font-family="system-ui">Image unavailable</text></svg>'
                            );
                            el.classList.add('object-contain');
                          }}
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
                  {missionTransactions.map((tx) => {
                    const gw = (tx.gateway || '').toLowerCase();
                    const badge =
                      gw.includes('stripe') ? 'Stripe' : gw.includes('paymob') ? 'Paymob' : tx.gateway || null;
                    const isCarding = tx.user_id ? potentialCardingUserIds.has(tx.user_id) : false;
                    return (
                      <div
                        key={tx.id}
                        className={`flex items-center justify-between gap-3 border border-cyan-500/10 px-3 py-2 text-[11px] ${PROFILE_GLASS_PANEL} !rounded-xl`}
                      >
                        <div className="min-w-0">
                          <p className="font-mono text-slate-200 truncate">
                            {tx.type}
                            {badge ? (
                              <span className={`ml-2 inline-flex items-center rounded-full border border-white/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-slate-200 ${PROFILE_GLASS_PANEL} !rounded-full`}>
                                {badge}
                              </span>
                            ) : null}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {new Date(tx.created_at).toLocaleString()}
                          </p>
                        </div>
                        <p
                          className={[
                            'font-mono font-black tabular-nums',
                            isCarding
                              ? 'text-red-300 drop-shadow-[0_0_10px_rgba(239,68,68,0.55)]'
                              : 'text-emerald-300',
                          ].join(' ')}
                          title={isCarding ? 'Potential carding: repeated micro-payments by same user' : undefined}
                        >
                          {formatEgp(Number(tx.amount))}
                        </p>
                      </div>
                    );
                  })}
                  {!missionTxLoading && missionTransactions.length === 0 && (
                    <p className="text-xs text-slate-500 italic py-2">No transactions linked to this mission.</p>
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
                      className="animated-border-inner w-full rounded-full py-4 text-sm font-black uppercase tracking-[0.24em] text-white bg-[#020617] hover:brightness-110 transition-all active:scale-[0.98]"
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
                    alert('Mission accepted! Redirecting to profile...');
                    handleCloseMissionBriefing();
                    onAvatarClick?.();
                  }}
                  className="animated-border-inner w-full rounded-full py-4 text-sm font-black uppercase tracking-[0.24em] text-white bg-[#020617] hover:brightness-110 transition-all active:scale-[0.98]"
                >
                  {t('startWorkUploadProof')}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {showBidInput && (
                  <div className={`px-4 py-3 ${PROFILE_GLASS_PANEL}`}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                        {missionBidCurrency === 'USD' ? t('bidAmountLabelUsd') : t('bidAmountLabelEgp')}
                      </label>
                      <div className="flex rounded-full border border-slate-600 p-0.5 bg-slate-900/80">
                        <button
                          type="button"
                          onClick={() => setMissionBidCurrency('EGP')}
                          className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                            missionBidCurrency === 'EGP' ? 'bg-emerald-500 text-black' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {t('depositCurrencyEgp')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setMissionBidCurrency('USD')}
                          className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                            missionBidCurrency === 'USD' ? 'bg-emerald-500 text-black' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {t('depositCurrencyUsd')}
                        </button>
                      </div>
                    </div>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={missionBidAmount}
                      onChange={(e) => setMissionBidAmount(e.target.value)}
                      className={`w-full ${PROFILE_GLASS_PANEL} px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none ${
                        selectedMission.category === 'public'
                          ? 'focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500'
                          : 'focus:border-amber-500 focus:ring-1 focus:ring-amber-500'
                      }`}
                      placeholder={`Default: ${formatEgp(Number(selectedMission.amount_target))}`}
                    />
                    {missionBidCurrency === 'USD' && missionBidAmount && Number(missionBidAmount) > 0 && (
                      <p className="mt-2 text-[10px] text-amber-200/90">
                        ≈ {formatEgp(usdInputToEgp(Number(missionBidAmount), USD_TO_EGP_RATE))} —{' '}
                        {t('bidUsdToEgpHint', { rate: String(USD_TO_EGP_RATE) })}
                      </p>
                    )}
                  </div>
                )}

                <div
                  className={`w-full rounded-full ${
                    selectedMission.category === 'public' ? 'animated-border-city' : 'animated-border-home'
                  } ${isAccepting ? 'opacity-60' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (!showBidInput) {
                        setShowBidInput(true);
                        if (!missionBidAmount) setMissionBidAmount(String(selectedMission.amount_target ?? ''));
                        return;
                      }
                      handleSubmitMissionBid();
                    }}
                    disabled={isAccepting || missionTrustBlocked}
                    className="animated-border-inner w-full rounded-full px-6 py-2 text-sm font-black uppercase tracking-[0.24em] text-orange-400 border border-orange-500/50 bg-orange-500/10 hover:bg-orange-500/20 hover:shadow-[0_0_15px_rgba(249,115,22,0.3)] transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isAccepting ? t('placing') : showBidInput ? t('placeBid') : t('makeABid')}
                  </button>
                  {missionTrustBlocked && showBidInput && (
                    <div className="mt-2 flex flex-col items-center gap-1.5">
                      <p className="text-center text-[10px] text-amber-300">{t('insufficientTrustDeposit')}</p>
                      <button
                        type="button"
                        onClick={() => setTrustDepositInfoOpen(true)}
                        className="text-[10px] font-bold uppercase tracking-wider text-amber-200/95 underline underline-offset-2 hover:text-amber-50"
                      >
                        {t('trustDepositLearnMore')}
                      </button>
                    </div>
                  )}
                </div>

                {selectedMission.category === 'public' &&
                  (selectedMission.status === 'pending' ||
                    selectedMission.status === 'available' ||
                    selectedMission.status === 'funding') && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowDonate((prev) => !prev);
                        }}
                        className="w-full rounded-full px-6 py-2 text-sm font-black uppercase tracking-[0.24em] border border-orange-500/50 text-orange-400 bg-orange-500/10 hover:bg-orange-500/20 hover:shadow-[0_0_15px_rgba(249,115,22,0.3)] transition-all"
                      >
                        {t('donateToCause')}
                      </button>
                      {showDonate && (
                        <div className={`space-y-2 border border-emerald-500/30 px-4 py-3 ${PROFILE_GLASS_PANEL}`}>
                          <p className="text-[11px] text-slate-300">
                            {t('boostMissionFunding')}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {[1, 5, 10].map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                disabled={donating}
                                onClick={() => handleDonate(preset)}
                                className="px-3 py-1.5 rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-60 disabled:cursor-wait"
                              >
                                {formatEgp(preset)}
                              </button>
                            ))}
                            <div className="flex-1 min-w-[120px] space-y-2">
                              <input
                                type="number"
                                min="0"
                                step="0.5"
                                inputMode="decimal"
                                value={donateAmount}
                                onChange={(e) => setDonateAmount(e.target.value)}
                                className={`w-full ${PROFILE_GLASS_PANEL} px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500`}
                                placeholder={t('customAmount')}
                              />
                              <button
                                type="button"
                                disabled={donating}
                                onClick={() => handleDonate(parseFloat(donateAmount.replace(',', '.')))}
                                className="w-full px-3 py-1.5 rounded-full bg-emerald-500 text-[11px] font-black uppercase tracking-[0.16em] text-black hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-wait mt-1.5"
                              >
                                {donating ? t('sendingDonation') : t('donate')}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Crowdfunding confirm modal (public missions) */}
      {showCrowdfundConfirm && selectedMission && (
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
              const funded = Number(selectedMission.current_funding ?? 0);
              const targetEgp = Number(selectedMission.amount_target ?? 0);
              /** EGP still needed to reach the mission goal (same as co-fund RPC amount). */
              const gapToCloseEgp = Math.max(
                0,
                Math.round((targetEgp - funded) * 100) / 100
              );
              return (
                <>
                  <p className="text-sm text-slate-300">
                    {t('yourBidIs')}{' '}
                    <span className="font-black text-amber-300">{formatEgp(bid)}</span>. {t('currentFundingIs')}{' '}
                    <span className="font-black text-emerald-300">{formatEgp(funded)}</span>.
                  </p>
                  <p className="mt-2 text-[11px] text-slate-500">
                    {t('chooseHowToProceed')}
                  </p>

                  <div className="mt-5 grid grid-cols-1 gap-3">
                    <button
                      type="button"
                      disabled={isAccepting || gapToCloseEgp <= 0}
                      onClick={async () => {
                        if (!selectedMission) return;
                        if (gapToCloseEgp <= 0) return;
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
                          const wb = Number(p?.wallet_balance ?? 0);
                          const fr = Number(p?.frozen_balance ?? 0);
                          const target = Number(selectedMission.amount_target ?? gapToCloseEgp);
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
                          await handleCoFundMission(selectedMission.id, gapToCloseEgp);
                          alert('Success! You co-funded this mission and closed the deal.');
                          await fetchMissions();
                          closeCrowdfundConfirm();
                          handleCloseMissionBriefing();
                        } catch (e: any) {
                          alert(e?.message || 'Failed to co-fund mission. Please try again.');
                        } finally {
                          setIsAccepting(false);
                        }
                      }}
                      className={`w-full px-4 py-4 text-left transition-all hover:border-amber-400/50 hover:bg-white/10 disabled:cursor-wait disabled:opacity-60 ${PROFILE_GLASS_PANEL}`}
                    >
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-300">
                        {t('addAmountToCloseDeal', { amount: formatEgp(gapToCloseEgp) })}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {t('differenceDeductedFromWallet')}
                      </p>
                    </button>

                    <button
                      type="button"
                      disabled={isAccepting}
                      onClick={async () => {
                        if (!selectedMission) return;
                        if (!crowdfundBidAmount) return;
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
                          const wb = Number(p?.wallet_balance ?? 0);
                          const fr = Number(p?.frozen_balance ?? 0);
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
                          await placePendingBid(selectedMission.id, crowdfundBidAmount);
                          await fetchMissions();
                          closeCrowdfundConfirm();
                          handleCloseMissionBriefing();
                        } catch (e: any) {
                          alert(e?.message || 'Failed to place bid. Please try again.');
                        } finally {
                          setIsAccepting(false);
                        }
                      }}
                      className={`w-full px-4 py-4 text-left transition-all hover:border-sky-400/50 hover:bg-white/10 disabled:cursor-wait disabled:opacity-60 ${PROFILE_GLASS_PANEL}`}
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
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[10000] pointer-events-none">
          <div className="rounded-xl border border-red-300/30 bg-red-500/85 px-4 py-2 text-xs font-bold text-white shadow-xl backdrop-blur-sm">
            {mapToast}
          </div>
        </div>
      )}

    </div>
  );
};

export default MapPicker;
