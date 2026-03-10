import React, { useState, useCallback, useEffect } from 'react';
import Map, { Marker, NavigationControl, GeolocateControl, MapRef } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '../lib/supabaseClient';
import JobMarker from './JobMarker';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

type TaskType = 'city' | 'home';

interface JobOnMap {
  id: string;
  task_type: TaskType | string;
  amount: number;
  location_lat: number;
  location_lng: number;
  status: string;
  worker_id?: string | null;
  creator_id?: string | null;
  description?: string | null;
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

  // Fetch pending jobs from Supabase
  const fetchJobs = useCallback(async () => {
    const { data, error } = await supabase
      .from('jobs')
      .select('id, task_type, amount, location_lat, location_lng, status, worker_id, creator_id, description')
      .eq('status', 'pending')
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
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    const handleFocus = () => fetchJobs();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [fetchJobs]);

  useEffect(() => {
    const onPaymentSuccess = () => {
      // Initial refresh
      fetchJobs();
      // Simple polling to wait for webhook to finish inserting the job
      setTimeout(() => fetchJobs(), 1500);
      setTimeout(() => fetchJobs(), 4000);
    };
    window.addEventListener('paymentSuccess', onPaymentSuccess);
    return () => window.removeEventListener('paymentSuccess', onPaymentSuccess);
  }, [fetchJobs]);

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
          type: 'job_creation',
          userId: session.user.id,
          amount: payload.amount,
          taskType: payload.taskType,
          location_lat: payload.location.lat,
          location_lng: payload.location.lng,
          description: payload.description || undefined,
          creator_photos: payload.creatorPhotos && payload.creatorPhotos.length > 0 ? payload.creatorPhotos : undefined,
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
        sessionStorage.setItem('paymentReturnType', 'job_creation');
        window.location.assign(data.paymentUrl);
        return;
      }
      if (data.paymentToken) {
        sessionStorage.setItem('paymentReturnType', 'job_creation');
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

  const handleMarkerClick = useCallback(
    async (job: JobOnMap) => {
      if (job.task_type !== 'home') return;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        onRequestAuth?.();
        return;
      }
      if (job.creator_id === session.user.id) {
        alert('You cannot bid on your own job.');
        return;
      }
      setBidJob(job);
      setBidAmount('');
      setBidError(null);
      setBidSuccess(null);
    },
    [onRequestAuth]
  );

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

      const { error } = await supabase.from('bids').insert([
        {
          job_id: bidJob.id,
          worker_id: session.user.id,
          bid_amount: amount,
          status: 'pending',
        },
      ]);

      if (error) {
        console.error('Error placing bid:', error.message);
        setBidError('Could not place bid. Please try again.');
        return;
      }

      setBidSuccess('Bid placed successfully.');
      setBidAmount('');
      await fetchJobs();
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

      // 1) Upload creator proof photos (if any)
      let creatorPhotoUrls: string[] | undefined;
      if (orderPhotos.length > 0) {
        setUploadingProof(true);
        const uploaded: string[] = [];
        for (const file of orderPhotos) {
          const ext = file.name.split('.').pop() || 'jpg';
          const fileName = `creator_${session.user.id}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
          const { error: uploadError } = await supabase.storage
            .from('order-photos')
            .upload(fileName, file, { upsert: false });
          if (uploadError) {
            throw uploadError;
          }
          const { data: { publicUrl } } = supabase.storage
            .from('order-photos')
            .getPublicUrl(fileName);
          uploaded.push(publicUrl);
        }
        creatorPhotoUrls = uploaded;
      }

      // 2) Kick off Paymob flow with creator_photos attached to pending job
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

        {/* Job markers — luxury pyramids */}
        {(jobs || []).map((job) => (
          <Marker
            key={job.id}
            latitude={job.location_lat}
            longitude={job.location_lng}
            anchor="bottom"
          >
            <JobMarker
              amount={job.amount}
              orderType={job.task_type === 'home' ? 'home' : 'city'}
              onClick={() => handleMarkerClick(job)}
            />
          </Marker>
        ))}
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
              What needs cleaning?
            </h2>
            <div className="flex flex-col sm:flex-row gap-4 w-full max-w-sm justify-center pointer-events-auto">
              <button
                type="button"
                onClick={() => selectTaskType('city')}
                className="rounded-full px-6 py-3.5 bg-black/60 backdrop-blur-md border-2 border-emerald-400/60 text-white font-medium text-sm shadow-[0_0_28px_rgba(52,211,153,0.5)] hover:shadow-[0_0_36px_rgba(52,211,153,0.6)] hover:border-emerald-400 transition-all active:scale-[0.98]"
              >
                Clean City Area
              </button>
              <button
                type="button"
                onClick={() => selectTaskType('home')}
                className="rounded-full px-6 py-3.5 bg-black/60 backdrop-blur-md border-2 border-amber-400/60 text-white font-medium text-sm shadow-[0_0_28px_rgba(251,191,36,0.5)] hover:shadow-[0_0_36px_rgba(251,191,36,0.6)] hover:border-amber-400 transition-all active:scale-[0.98]"
              >
                Clean Your Home/Office
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
                  {taskType === 'city' ? 'Clean City Area' : 'Clean Your Home/Office'}
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
                    Amount (USD)
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={orderAmount}
                    onChange={(e) => setOrderAmount(e.target.value)}
                    placeholder="Any amount"
                    className="w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                    Location
                  </label>
                  <div className="flex items-center gap-2 rounded-2xl bg-black/40 border border-white/10 px-3 py-2.5">
                    <span className="text-slate-400 text-sm">📍</span>
                    <p className="flex-1 text-xs text-slate-300">
                      {selectedLocation
                        ? `${selectedLocation.lat.toFixed(4)}, ${selectedLocation.lng.toFixed(4)}`
                        : 'Tap on the 3D map to select'}
                    </p>
                  </div>
                  {!selectedLocation && (
                    <p className="mt-1 text-[10px] text-amber-300 uppercase tracking-[0.18em]">
                      Please tap on the map to set a location.
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                    Upload photo
                  </label>
                <label className="flex h-[52px] items-center justify-center rounded-2xl border border-dashed border-slate-600 bg-black/30 text-[11px] text-slate-400 cursor-pointer hover:border-teal-400 hover:text-teal-300 transition-all">
                  {orderPhotos.length > 0 ? `${orderPhotos.length} photo(s) selected` : 'Tap to add reference photos (up to 10)'}
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
                        Low Proof Work (Worker takes at own risk)
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-400/50 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">
                        High Proof Work
                      </span>
                    )}
                  </div>
                )}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                  Short description & area
                </label>
                <textarea
                  value={orderDescription}
                  onChange={(e) => setOrderDescription(e.target.value)}
                  rows={2}
                  placeholder={
                    taskType === 'city'
                      ? 'Describe the city spot you want to support...'
                      : 'Describe your home cleaning task and area size...'
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

              <div className={`w-full mt-1 animated-border rounded-full ${orderSubmitting || uploadingProof || !selectedLocation ? 'opacity-60' : ''}`}>
                <button
                  type="submit"
                  disabled={orderSubmitting || uploadingProof || !selectedLocation}
                  className="animated-border-inner w-full rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.24em] transition-all text-white bg-[#020617] hover:brightness-110 disabled:cursor-not-allowed active:scale-[0.98]"
                >
                  {uploadingProof
                    ? 'Uploading Proof Photos...'
                    : orderSubmitting
                      ? 'Processing...'
                      : 'Submit Task & Pay'}
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
                  ${bidJob.amount}
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

              <div className={`animated-border rounded-full ${bidSubmitting ? 'opacity-60' : ''}`}>
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

    </div>
  );
};

export default MapPicker;
