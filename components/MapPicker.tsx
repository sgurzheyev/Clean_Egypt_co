import React, { useState, useCallback, useEffect } from 'react';
import Map, { Marker, NavigationControl, GeolocateControl } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

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
}) => {
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
  const [orderPhoto, setOrderPhoto] = useState<File | null>(null);
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

  // Auth gate modal (for unauthenticated users on submit)
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authSent, setAuthSent] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

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
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success' || params.get('success') === 'true') {
      fetchJobs();
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [fetchJobs]);

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
        alert('You must be signed in to place a bid.');
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
    []
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

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail?.trim()) return;
    setAuthError(null);
    setAuthLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: authEmail.trim(),
        options: { emailRedirectTo: `${window.location.origin}/` },
      });
      if (error) {
        setAuthError(error.message || 'Failed to send magic link.');
        return;
      }
      setAuthSent(true);
    } catch (err) {
      console.error('Auth error:', err);
      setAuthError('Something went wrong. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleCloseAuthModal = useCallback(() => {
    if (!authLoading) {
      setShowAuthModal(false);
      setAuthEmail('');
      setAuthSent(false);
      setAuthError(null);
    }
  }, [authLoading]);

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
        setOrderSubmitting(false);
        setShowAuthModal(true);
        setAuthEmail('');
        setAuthSent(false);
        setAuthError(null);
        return;
      }

      const creatorId = session.user.id;

      const res = await fetch('/api/paymob-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'job_creation',
          userId: creatorId,
          amount,
          taskType,
          location_lat: selectedLocation.lat,
          location_lng: selectedLocation.lng,
          description: orderDescription || undefined,
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
        return;
      }

      throw new Error('No payment URL or token received.');
    } catch (err) {
      console.error('Job submit exception:', err);
      setOrderError(
        err instanceof Error ? err.message : 'Unexpected error. Please try again.'
      );
    } finally {
      setOrderSubmitting(false);
    }
  };

  return (
    <div className="w-full h-screen relative bg-black overflow-hidden">
      {/* Full-screen 3D map — no blocking overlays */}
      <Map
        ref={(ref) => {
          // keep react-map-gl ref stable
        }}
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

        {/* Job markers as pills */}
        {(jobs || []).map((job) => {
          const isCity = job.task_type === 'city';
          const pillClasses = isCity
            ? 'bg-gradient-to-r from-emerald-400 to-emerald-500 text-black'
            : 'bg-gradient-to-r from-amber-300 to-amber-500 text-black';

          return (
            <Marker
              key={job.id}
              latitude={job.location_lat}
              longitude={job.location_lng}
              anchor="bottom"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleMarkerClick(job);
                }}
                className={`px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-[0.16em] shadow-lg cursor-pointer select-none transition-transform hover:scale-110 active:scale-95 ${pillClasses}`}
              >
                ${job.amount}
              </button>
            </Marker>
          );
        })}
      </Map>

      {/* Minimalist overlays — wrapper is pointer-events-none so map stays interactive */}
      <div className="absolute inset-0 pointer-events-none z-[80] flex flex-col">
        {/* Header: CleanEgypt.co (non-interactive) + profile avatar (clickable) */}
        <header className="flex items-center justify-between px-5 pt-5">
          <h1 className="text-sm font-medium tracking-wide text-white pointer-events-none">
            CleanEgypt.co
          </h1>
          <Link
            to="/profile"
            className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white hover:border-emerald-400/50 hover:shadow-[0_0_16px_rgba(16,185,129,0.3)] transition-all"
          >
            👤
          </Link>
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
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                    Upload photo
                  </label>
                  <label className="flex h-[52px] items-center justify-center rounded-2xl border border-dashed border-slate-600 bg-black/30 text-[11px] text-slate-400 cursor-pointer hover:border-teal-400 hover:text-teal-300 transition-all">
                    {orderPhoto ? 'Photo selected' : 'Tap to add reference photo'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setOrderPhoto(file);
                      }}
                    />
                  </label>
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

              <button
                type="submit"
                disabled={orderSubmitting}
                className={`w-full mt-1 rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.24em] transition-all ${
                  taskType === 'city'
                    ? 'bg-emerald-400 text-black shadow-[0_0_24px_rgba(52,211,153,0.7)] hover:brightness-110'
                    : 'bg-amber-400 text-black shadow-[0_0_24px_rgba(251,191,36,0.7)] hover:brightness-110'
                } ${orderSubmitting ? 'opacity-60 cursor-wait' : 'active:scale-95'}`}
              >
                {orderSubmitting ? 'Processing...' : 'Submit Task & Pay'}
              </button>
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
            className="w-full max-w-md rounded-3xl bg-black/85 backdrop-blur-xl border border-white/10 shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
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

              <button
                type="submit"
                disabled={bidSubmitting}
                className="w-full rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.24em] bg-gradient-to-r from-amber-300 to-amber-500 text-black shadow-[0_0_24px_rgba(251,191,36,0.7)] hover:brightness-110 transition-all disabled:opacity-60 disabled:cursor-wait active:scale-95"
              >
                {bidSubmitting ? 'Placing bid...' : 'Place bid'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Auth gate modal — sign in to create jobs */}
      {showAuthModal && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={handleCloseAuthModal}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-black/85 backdrop-blur-xl border border-white/10 shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-bold uppercase tracking-[0.18em] text-white">
                Sign in to continue
              </h3>
              <button
                type="button"
                onClick={handleCloseAuthModal}
                disabled={authLoading}
                className="text-slate-400 hover:text-white text-lg font-bold disabled:opacity-40"
              >
                ✕
              </button>
            </div>

            {authSent ? (
              <div className="py-4">
                <p className="text-emerald-400 text-sm font-medium mb-2">
                  Check your email
                </p>
                <p className="text-slate-400 text-sm">
                  We sent a magic link to <span className="text-white font-medium">{authEmail}</span>. Click it to sign in, then return here to submit your task.
                </p>
              </div>
            ) : (
              <form onSubmit={handleAuthSubmit} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                    required
                  />
                </div>
                {authError && (
                  <p className="text-xs text-red-400 font-medium">{authError}</p>
                )}
                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.24em] bg-emerald-500 text-black shadow-[0_0_24px_rgba(52,211,153,0.6)] hover:brightness-110 disabled:opacity-60 disabled:cursor-wait transition-all"
                >
                  {authLoading ? 'Sending...' : 'Send magic link'}
                </button>
              </form>
            )}

            <p className="mt-4 text-[10px] text-slate-500 text-center uppercase tracking-wider">
              No password required. We&apos;ll email you a link to sign in.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default MapPicker;
