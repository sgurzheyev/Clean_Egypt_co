import React, { useState, useCallback, useEffect } from 'react';
import Map, { Marker, NavigationControl, GeolocateControl, MapRef } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import imageCompression from 'browser-image-compression';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabaseClient';
import JobMarker from './JobMarker';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

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
  creator?: {
    avatar_url?: string | null;
    phone_number?: string | null;
  } | null;
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
      id: '3d-buildings',
      type: 'fill-extrusion',
      source: 'composite',
      'source-layer': 'building',
      minzoom: 15,
      paint: {
        'fill-extrusion-color': '#333333',
        'fill-extrusion-height': [
          'interpolate',
          ['linear'],
          ['zoom'],
          15,
          0,
          16,
          ['get', 'height'],
        ],
        'fill-extrusion-base': ['get', 'min_height'],
        'fill-extrusion-opacity': 0.95,
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
  const { t } = useTranslation();
  const mapRef = React.useRef<MapRef>(null);
  const [viewState, setViewState] = useState({
    latitude: 27.2579,
    longitude: 33.8116,
    zoom: 13,
    pitch: 55,
    bearing: -20,
  });

  const [jobs, setJobs] = useState<JobOnMap[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<
    { lat: number; lng: number } | null
  >(selectedCoords || null);

  // Adaptive UI: task type selected = show form overlay
  const [taskTypeSelected, setTaskTypeSelected] = useState<TaskType | null>(null);
  const [taskType, setTaskType] = useState<TaskType>('city');
  const [orderAmount, setOrderAmount] = useState('');
  const [orderDescription, setOrderDescription] = useState('');
  const [orderPhotos, setOrderPhotos] = useState<File[]>([]);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null);

  const selectTaskType = useCallback((type: TaskType) => {
    setTaskType(type);
    setTaskTypeSelected(type);
    setOrderError(null);
    setOrderSuccess(null);
  }, []);

  const closeFormOverlay = useCallback(() => {
    if (!orderSubmitting) {
      setTaskTypeSelected(null);
      setOrderError(null);
      setOrderSuccess(null);
    }
  }, [orderSubmitting]);

  // Bidding modal state
  const [bidJob, setBidJob] = useState<JobOnMap | null>(null);
  const [bidAmount, setBidAmount] = useState('');
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
        creator:profiles!creator_id (
          avatar_url,
          phone_number
        )
      `)
      .in('status', ['pending', 'available', 'funding', 'in_progress', 'completed'])
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

      setSelectedLocation({ lat, lng });
      onLocationSelect(lat, lng);
    },
    [onLocationSelect]
  );

  const [selectedMission, setSelectedMission] = useState<JobOnMap | null>(null);
  const [hallOfFameMission, setHallOfFameMission] = useState<JobOnMap | null>(null);
  const [hallOfFameCleanerName, setHallOfFameCleanerName] = useState<string | null>(null);
  const [hallOfFameHeroes, setHallOfFameHeroes] = useState<string[]>([]);
  const [isAccepting, setIsAccepting] = useState(false);
  const [showBidInput, setShowBidInput] = useState(false);
  const [missionBidAmount, setMissionBidAmount] = useState<string>('');
  const [showCrowdfundConfirm, setShowCrowdfundConfirm] = useState(false);
  const [crowdfundBidAmount, setCrowdfundBidAmount] = useState<number | null>(null);
  const [showDonate, setShowDonate] = useState(false);
  const [donateAmount, setDonateAmount] = useState<string>('');
  const [donating, setDonating] = useState(false);
  const [selectedRating, setSelectedRating] = useState<number>(0);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [reviewedMissions, setReviewedMissions] = useState<Set<string>>(new Set());

  const handleMarkerClick = useCallback((job: JobOnMap) => {
    setSelectedMission(job);
    setShowBidInput(false);
    setMissionBidAmount(String(job.amount_target ?? ''));
  }, []);

  const handleCloseMissionBriefing = useCallback(() => {
    setSelectedMission(null);
    setShowBidInput(false);
    setMissionBidAmount('');
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
        alert('Please enter a positive USD amount to donate.');
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
      const amt = parseFloat((missionBidAmount || '').replace(',', '.'));
      if (isNaN(amt) || amt <= 0) {
        alert('Please enter a positive USD amount.');
        return;
      }

      // Crowdfunding logic for public missions:
      // If bid > current_funding, ask whether to top-up or wait.
      if (selectedMission.category === 'public') {
        const currentFunding = Number(selectedMission.current_funding ?? 0);
        if (Number.isFinite(currentFunding) && amt > currentFunding) {
          setCrowdfundBidAmount(amt);
          setShowCrowdfundConfirm(true);
          return;
        }
      }

      // Check wallet balance: must have at least 50% of bid amount
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('wallet_balance, phone_number')
        .eq('id', user.id)
        .maybeSingle();
      if (profileError) {
        console.error('Balance check failed:', profileError.message);
      } else {
        const balance = (profile?.wallet_balance ?? 0) as number;
        const required = 0.5 * amt;
        if (balance < required) {
          alert(
            `Insufficient wallet balance.\nYou need at least 50% of your bid amount available.\nRequired: $${required.toFixed(
              2
            )}, Current: $${balance.toFixed(2)}.`
          );
          return;
        }

        if (!profile?.phone_number || String(profile.phone_number).trim().length === 0) {
          alert(
            'Tip: Add your WhatsApp number in your Profile so we can notify you about mission updates.'
          );
        }
      }

      // Default behavior: place a pending bid
      await placePendingBid(selectedMission.id, amt);

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
    onRequestAuth,
    placePendingBid,
    selectedMission,
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

    const amount = parseFloat(bidAmount.replace(',', '.'));
    if (isNaN(amount) || amount <= 0) {
      setBidError('Please enter a positive USD amount.');
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

      // Crowdfunding logic for public missions (bid modal)
      if (bidJob.category === 'public') {
        const currentFunding = Number(bidJob.current_funding ?? 0);
        if (Number.isFinite(currentFunding) && amount > currentFunding) {
          setCrowdfundBidAmount(amount);
          setSelectedMission(bidJob);
          setShowCrowdfundConfirm(true);
          return;
        }
      }

      // Check wallet balance before bidding (must have at least 50% of bid amount)
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('wallet_balance, phone_number')
        .eq('id', userId)
        .maybeSingle();
      if (profileError) {
        console.error('Balance check failed:', profileError.message);
      } else {
        const balance = (profile?.wallet_balance ?? 0) as number;
        const required = 0.5 * amount;
        if (balance < required) {
          setBidError(
            `Insufficient wallet balance. You need at least 50% of your bid amount. Required: $${required.toFixed(
              2
            )}, Current: $${balance.toFixed(2)}.`
          );
          return;
        }

        if (!profile?.phone_number || String(profile.phone_number).trim().length === 0) {
          setBidError(
            'Tip: Add your WhatsApp number in your Profile so we can notify you about mission updates.'
          );
          return;
        }
      }

      await placePendingBid(bidJob.id, amount);

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
      setOrderError('Please enter any positive USD value.');
      return;
    }
    if (!selectedLocation) {
      setOrderError('Tap on the map to choose a location.');
      return;
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

      // For City (public) missions, confirm $1 Scout Stake before proceeding
      if (taskType === 'city') {
        const confirmed = window.confirm(
          'Placing a City Pin costs $1 (Scout Stake). You will earn 10% of the collected funds when it is cleaned. Proceed?'
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
          maxSizeMB: 0.8,
          maxWidthOrHeight: 1920,
          useWebWorker: true,
        };
        const compressedFiles: File[] = [];
        for (const file of orderPhotos) {
          try {
            const compressed = await imageCompression(file, compressionOptions);
            compressedFiles.push(compressed);
          } catch (err) {
            console.warn('Compression failed for', file.name, err);
            compressedFiles.push(file);
          }
        }
        for (const file of compressedFiles) {
          const rawExt = file.name.split('.').pop() || 'jpg';
          const fileExt = rawExt.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'jpg';
          const safeFileName = `mission_${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExt}`;
          const { error: uploadError } = await supabase.storage
            .from('order-photos')
            .upload(safeFileName, file, { upsert: false });
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

      // 2) For City (public) missions, create mission via RPC with $1 Scout Stake
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
              'Failed to create City mission. Please ensure you have at least $1 in your wallet and try again.'
          );
          return;
        }

        // Telegram notification (non-blocking)
        try {
          const botToken = import.meta.env.VITE_TELEGRAM_BOT_TOKEN as string | undefined;
          const chatId = import.meta.env.VITE_TELEGRAM_ADMIN_CHAT_ID as string | undefined;
          const photoUrls = creatorPhotoUrls || [];
          const hasPhoto = photoUrls.length > 0;
          const caption = `🚨 *NEW MISSION* 🚨\n💰 Reward: $${amount}\n📝 Task: ${orderDescription || t('cityCleaning')}`;

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

        setOrderSuccess('City mission created! Your $1 Scout Stake has been locked.');
        setOrderAmount('');
        setOrderDescription('');
        setOrderPhotos([]);
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

  return (
    <div className="w-full h-screen relative bg-black overflow-hidden">
      {/* Full-screen 3D map — no blocking overlays */}
      <Map
        ref={mapRef}
        {...viewState}
        onMove={(evt) => setViewState(evt.viewState)}
        onClick={handleMapClick}
        mapStyle={customDarkStyle}
        mapboxAccessToken={MAPBOX_TOKEN}
        style={{ width: '100%', height: '100%' }}
      >
        <GeolocateControl
          position="bottom-right"
          positionOptions={{ enableHighAccuracy: true }}
          trackUserLocation
        />
        <NavigationControl position="bottom-right" showCompass={false} />

        {/* Job markers — luxury pyramids (pending for all; in_progress only for assigned worker; completed as Hall of Fame) */}
        {console.log('Jobs passing filter:', (jobs || []).filter((job) => {
          if (job.status === 'pending') return true;
          if (job.status === 'available') return true;
          if (job.status === 'funding') return true;
          if (job.status === 'in_progress') return true;
          if (job.status === 'completed') {
            const ts = job.created_at;
            if (!ts) return false;
            const completedAt = new Date(ts).getTime();
            if (!Number.isFinite(completedAt)) return false;
            const ageMs = Date.now() - completedAt;
            return ageMs <= 24 * 60 * 60 * 1000;
          }
          return false;
        }).length)}
        {(jobs || [])
          .filter((job) => {
            if (job.status === 'pending') return true;
            if (job.status === 'available') return true;
            if (job.status === 'funding') return true;
            if (job.status === 'in_progress') return true;
            if (job.status === 'completed') {
              const ts = job.created_at;
              if (!ts) return false;
              const completedAt = new Date(ts).getTime();
              if (!Number.isFinite(completedAt)) return false;
              const ageMs = Date.now() - completedAt;
              return ageMs <= 24 * 60 * 60 * 1000;
            }
            return false;
          })
          .map((job) => {
            const isMyActiveMission = job.status === 'in_progress' && job.cleaner_id === currentUserId;
            const bidCount = activeBidCounts[job.id] || 0;
            const orderType = job.category === 'home' ? 'home' : 'city';
            const variant =
              job.status === 'completed'
                ? 'completed'
                : job.status === 'in_progress'
                  ? 'in_progress'
                  : 'default';

            const hasWhatsApp = !!job.creator?.phone_number;
            const avatarUrl = job.creator?.avatar_url || null;
            const vipAvatarUrl = hasWhatsApp && avatarUrl ? avatarUrl : null;

            return (
              <Marker
                key={job.id}
                latitude={job.location_lat}
                longitude={job.location_lng}
                anchor="bottom"
              >
                <JobMarker
                  amount={job.amount_target}
                  orderType={orderType}
                  label={job.status === 'completed' ? 'DONE' : isMyActiveMission ? 'MY MISSION' : undefined}
                  isActive={isMyActiveMission}
                  variant={variant as any}
                  bidCount={job.status === 'pending' ? bidCount : 0}
                  vipAvatarUrl={vipAvatarUrl}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMarkerClick(job);
                  }}
                />
              </Marker>
            );
          })}

        {/* Draft pin — rainbow pyramid when user drops a pin on the map */}
        {selectedLocation && (
          <Marker
            latitude={selectedLocation.lat}
            longitude={selectedLocation.lng}
            anchor="bottom"
          >
            <JobMarker
              amount={0}
              orderType="city"
              isDraft
            />
          </Marker>
        )}
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
          className="absolute inset-0 z-[90] flex items-end justify-center p-4 pointer-events-none"
          aria-hidden="false"
        >
          <div className="pointer-events-auto w-full max-w-xl rounded-2xl bg-black/75 backdrop-blur-xl border border-white/10 shadow-2xl p-5 space-y-4 animate-slide-up">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                  {taskType === 'city' ? t('cleanCityArea') : t('cleanYourHomeOffice')}
                </p>
                <button
                  type="button"
                  onClick={closeFormOverlay}
                  disabled={orderSubmitting}
                  className="text-slate-500 hover:text-white text-lg font-bold disabled:opacity-40"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                    {t('amountUsd')}
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={orderAmount}
                    onChange={(e) => setOrderAmount(e.target.value)}
                    placeholder={t('anyAmount')}
                    className="w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                    {t('location')}
                  </label>
                  <div className="flex items-center gap-2 rounded-2xl bg-black/40 border border-white/10 px-3 py-2.5">
                    <span className="text-slate-400 text-sm">📍</span>
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
                  </div>
                  {!selectedLocation && (
                    <p className="mt-1 text-[10px] text-amber-300 uppercase tracking-[0.18em]">
                      {t('tapMapToSetLocation')}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                    {t('uploadPhoto')}
                  </label>
                <label className="flex h-[52px] items-center justify-center rounded-2xl border border-dashed border-slate-600 bg-black/30 text-[11px] text-slate-400 cursor-pointer hover:border-teal-400 hover:text-teal-300 transition-all">
                  {orderPhotos.length > 0 ? `${orderPhotos.length} ${t('photosSelected')}` : t('tapToAddReferencePhotos')}
                    <input
                      type="file"
                      accept="image/*"
                    multiple
                      className="hidden"
                      onChange={(e) => {
                      const files = Array.from(e.target.files || []).slice(0, 10);
                      setOrderPhotos(files);
                      }}
                    />
                  </label>
                {orderPhotos.length > 0 && (
                  <div className="mt-2">
                    {orderPhotos.length <= 4 ? (
                      <span className="inline-flex items-center px-3 py-1 rounded-full bg-amber-500/10 border border-amber-400/50 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">
                        {t('lowProofWork')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-400/50 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">
                        {t('highProofWork')}
                      </span>
                    )}
                  </div>
                )}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                  {t('shortDescriptionAndArea')}
                </label>
                <textarea
                  value={orderDescription}
                  onChange={(e) => setOrderDescription(e.target.value)}
                  rows={2}
                  placeholder={
                    taskType === 'city'
                      ? t('describeCitySpot')
                      : t('describeHomeTask')
                  }
                  className="w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500 resize-none"
                />
              </div>

              {orderError && (
                <p className="text-xs text-red-400 font-medium">{orderError}</p>
              )}
              {orderSuccess && (
                <p className="text-xs text-emerald-400 font-medium">{orderSuccess}</p>
              )}

              <div className={`w-full mt-1 rounded-full ${taskType === 'city' ? 'animated-border-city' : 'animated-border-home'} ${orderSubmitting || uploadingProof || !selectedLocation ? 'opacity-60' : ''}`}>
                <button
                  type="submit"
                  disabled={orderSubmitting || uploadingProof || !selectedLocation}
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
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={handleCloseBidModal}
          aria-hidden="false"
        >
          <div
            className="w-full max-w-md animated-border animated-border-rect rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="animated-border-inner w-full rounded-3xl bg-[#020617]/95 backdrop-blur-xl p-6"
            >
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-black uppercase tracking-[0.18em] text-white">
                Place bid
              </h3>
              <button
                type="button"
                onClick={handleCloseBidModal}
                disabled={bidSubmitting}
                className="text-slate-400 hover:text-white text-lg font-bold disabled:opacity-40 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 mb-6">
              <div className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1">
                  Target amount
                </p>
                <p className="text-xl font-black text-amber-400">
                  ${bidJob.amount_target}
                </p>
              </div>
              {bidJob.description && (
                <div className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3">
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
                  Your bid (USD)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={bidAmount}
                  onChange={(e) => setBidAmount(e.target.value)}
                  placeholder="Enter your bid amount"
                  className="w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                />
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
          className="absolute inset-0 z-[95] flex items-end justify-center"
          aria-hidden="false"
        >
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={handleCloseMissionBriefing}
            aria-hidden="true"
          />
          <div
            className="relative w-full max-w-xl rounded-t-3xl bg-cyan-950/30 backdrop-blur-md border-t border-x border-cyan-500/20 shadow-[0_4px_30px_rgba(6,182,212,0.1)] p-6 pb-16 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-[10px] font-black uppercase tracking-[0.35em] text-slate-500">
                  {t('missionBriefing')}
                </h2>
                {selectedMission.status === 'in_progress' && selectedMission.cleaner_id === currentUserId && (
                  <p className="text-[10px] font-bold uppercase tracking-wider text-sky-400 mt-1">{t('yourActiveMission')}</p>
                )}
              </div>
              <button
                type="button"
                onClick={handleCloseMissionBriefing}
                className="p-2 -m-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                aria-label="Close"
              >
                ✕
              </button>
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
                  $
                  {selectedMission.category === 'public'
                    ? Number(selectedMission.current_funding || 0).toFixed(2)
                    : Number(selectedMission.amount_target).toFixed(2)}
                </p>
                {selectedMission.category === 'public' && (
                  <p className="mt-1 text-[11px] text-slate-400">
                    {t('targetGoal')}: ${Number(selectedMission.amount_target).toFixed(2)}
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
                <p className="text-sm text-slate-400">{selectedMission.description}</p>
              )}
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
                    <div className="rounded-2xl bg-black/50 border border-amber-500/40 p-4 space-y-3">
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
                  <div className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3">
                    <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
                      {t('yourBidUsd')}
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={missionBidAmount}
                      onChange={(e) => setMissionBidAmount(e.target.value)}
                      className={`w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none ${
                        selectedMission.category === 'public'
                          ? 'focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500'
                          : 'focus:border-amber-500 focus:ring-1 focus:ring-amber-500'
                      }`}
                      placeholder={`Default: $${selectedMission.amount_target}`}
                    />
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
                    disabled={isAccepting}
                    className="animated-border-inner w-full rounded-full px-6 py-2 text-sm font-black uppercase tracking-[0.24em] text-orange-400 border border-orange-500/50 bg-orange-500/10 hover:bg-orange-500/20 hover:shadow-[0_0_15px_rgba(249,115,22,0.3)] transition-all active:scale-[0.98] disabled:cursor-wait"
                  >
                    {isAccepting ? t('placing') : showBidInput ? t('placeBid') : t('makeABid')}
                  </button>
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
                        <div className="rounded-2xl bg-black/40 border border-emerald-500/30 px-4 py-3 space-y-2">
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
                                ${preset}
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
                                className="w-full rounded-2xl bg-black/40 border border-white/10 px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500"
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
        <div className="absolute inset-0 z-[97] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={closeCrowdfundConfirm}
            aria-hidden="true"
          />
          <div
            className="relative w-full max-w-lg rounded-3xl bg-[#020617]/95 backdrop-blur-2xl border border-white/10 shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.35em] text-slate-500">
                  {t('confirmation')}
                </p>
                <h3 className="mt-2 text-lg font-extrabold text-white">
                  {t('thisIsCrowdfundingMission')}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeCrowdfundConfirm}
                className="p-2 -m-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {(() => {
              const bid = Number(crowdfundBidAmount ?? 0);
              const funded = Number(selectedMission.current_funding ?? 0);
              const diff = Math.max(0, bid - funded);
              return (
                <>
                  <p className="text-sm text-slate-300">
                    {t('yourBidIs')} <span className="font-black text-amber-300">${bid.toFixed(2)}</span>. {t('currentFundingIs')}{' '}
                    <span className="font-black text-emerald-300">${funded.toFixed(2)}</span>.
                  </p>
                  <p className="mt-2 text-[11px] text-slate-500">
                    {t('chooseHowToProceed')}
                  </p>

                  <div className="mt-5 grid grid-cols-1 gap-3">
                    <button
                      type="button"
                      disabled={isAccepting}
                      onClick={async () => {
                        if (!selectedMission) return;
                        if (!crowdfundBidAmount) return;
                        try {
                          setIsAccepting(true);
                          await handleCoFundMission(selectedMission.id, crowdfundBidAmount);
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
                      className="w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-4 text-left hover:border-amber-400/50 hover:bg-black/50 transition-all disabled:opacity-60 disabled:cursor-wait"
                    >
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-300">
                        {t('addAmountToCloseDeal', { amount: diff.toFixed(2) })}
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
                      className="w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-4 text-left hover:border-sky-400/50 hover:bg-black/50 transition-all disabled:opacity-60 disabled:cursor-wait"
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
          className="absolute inset-0 z-[96] flex items-center justify-center"
          aria-hidden="false"
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleCloseHallOfFame}
            aria-hidden="true"
          />
          <div
            className="relative w-full max-w-2xl mx-4 rounded-3xl bg-[#020617]/98 backdrop-blur-2xl border border-white/10 shadow-2xl p-6 sm:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-4">
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
              <button
                type="button"
                onClick={handleCloseHallOfFame}
                className="p-2 -m-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                aria-label="Close"
              >
                ✕
              </button>
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

    </div>
  );
};

export default MapPicker;
