import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import Map, { Marker } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

interface ProfileRow {
  id: string;
  full_name?: string | null;
  telegram_username?: string | null;
  wallet_balance?: number | null;
  contact_email?: string | null;
  phone_number?: string | null;
  avatar_url?: string | null;
  is_verified?: boolean | null;
  first_gps_track?: unknown;
}

interface MissionRow {
  id: string;
  status: string;
  creator_id?: string | null;
}

interface PendingApprovalRow {
  id: string;
  amount_target: number;
  cleaner_id: string | null;
  status?: string;
  after_photo_urls?: string[] | null;
}

interface TransactionRow {
  id: string;
  user_id: string;
  mission_id?: string | null;
  amount: number;
  type: string;
  created_at: string;
  gateway?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  device_info?: string | null;
  metadata?: any;
}

interface AdminDashboardProps {
  onBack: () => void;
}

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

type ParsedGps = { lat: number; lng: number } | null;

function parseFirstGpsTrack(value: unknown): ParsedGps {
  if (!value) return null;
  if (typeof value === 'string') {
    const parts = value.split(',').map((s) => s.trim());
    if (parts.length >= 2) {
      const lat = Number(parts[0]);
      const lng = Number(parts[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
    return null;
  }
  if (Array.isArray(value) && value.length >= 2) {
    const lat = Number(value[0]);
    const lng = Number(value[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    return null;
  }
  if (typeof value === 'object') {
    const v = value as any;
    const lat = Number(v.lat ?? v.latitude);
    const lng = Number(v.lng ?? v.lon ?? v.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onBack }) => {
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [missions, setMissions] = useState<MissionRow[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [forcePayLoadingId, setForcePayLoadingId] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<ProfileRow | null>(null);
  const [selectedUserTransactions, setSelectedUserTransactions] = useState<TransactionRow[]>([]);
  const [selectedUserTxLoading, setSelectedUserTxLoading] = useState(false);
  const [selectedUserTxError, setSelectedUserTxError] = useState<string | null>(null);
  const [verifyLoadingUserId, setVerifyLoadingUserId] = useState<string | null>(null);

  const fetchPendingApprovals = async () => {
    const { data, error: err } = await supabase
      .from('missions')
      .select('id, amount_target, cleaner_id, status, after_photo_urls')
      .in('status', ['completed', 'in_progress', 'disputed'])
      .not('cleaner_id', 'is', null)
      .order('created_at', { ascending: false });
    if (err) {
      console.error('Pending approvals fetch error:', err);
      return;
    }
    const rows = (data || []) as PendingApprovalRow[];
    const stuck = rows.filter(
      (m) =>
        m.status === 'completed' ||
        (m.after_photo_urls && m.after_photo_urls.length > 0)
    );
    setPendingApprovals(stuck);
  };

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [profRes, missRes, txRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, telegram_username, contact_email, phone_number, wallet_balance, avatar_url, is_verified, first_gps_track')
          .order('wallet_balance', { ascending: false }),
        supabase.from('missions').select('id, status, creator_id'),
        supabase
          .from('transactions')
          .select('id, user_id, mission_id, amount, type, gateway, ip_address, user_agent, device_info, metadata, created_at')
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      if (profRes.error) throw profRes.error;
      if (missRes.error) throw missRes.error;
      if (txRes.error) throw txRes.error;

      setProfiles((profRes.data || []) as ProfileRow[]);
      setMissions((missRes.data || []) as MissionRow[]);
      setTransactions((txRes.data || []) as TransactionRow[]);
      await fetchPendingApprovals();
    } catch (e: any) {
      console.error('Admin fetch error:', e);
      setError(e?.message || 'Failed to load admin data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const openUser = async (p: ProfileRow) => {
    setSelectedUser(p);
    setSelectedUserTransactions([]);
    setSelectedUserTxError(null);
    setSelectedUserTxLoading(true);
    try {
      const { data, error: txErr } = await supabase
        .from('transactions')
        .select('id, user_id, mission_id, amount, type, gateway, ip_address, user_agent, device_info, metadata, created_at')
        .eq('user_id', p.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (txErr) throw txErr;
      setSelectedUserTransactions((data || []) as TransactionRow[]);
    } catch (e: any) {
      console.error('User tx fetch error:', e);
      setSelectedUserTxError(e?.message || 'Failed to load user transactions.');
    } finally {
      setSelectedUserTxLoading(false);
    }
  };

  const toggleVerify = async (userId: string, nextValue: boolean) => {
    setVerifyLoadingUserId(userId);
    try {
      const { error: updErr } = await supabase
        .from('profiles')
        .update({ is_verified: nextValue })
        .eq('id', userId);
      if (updErr) throw updErr;

      setProfiles((prev) =>
        prev.map((p) => (p.id === userId ? { ...p, is_verified: nextValue } : p))
      );
      setSelectedUser((prev) => (prev?.id === userId ? { ...prev, is_verified: nextValue } : prev));
    } catch (e: any) {
      console.error('Verify toggle error:', e);
      alert(e?.message || 'Failed to update verification status.');
    } finally {
      setVerifyLoadingUserId(null);
    }
  };

  const handleForcePay = async (mission: PendingApprovalRow) => {
    if (!mission.cleaner_id) {
      alert('No cleaner assigned to this mission.');
      return;
    }
    if (!window.confirm('Are you sure you want to force-release funds to the cleaner?')) return;
    setForcePayLoadingId(mission.id);
    try {
      const exchangeRate = 50;
      const payoutEgp = Math.round((mission.amount_target || 0) * exchangeRate);

      const { data: workerProfile, error: workerErr } = await supabase
        .from('profiles')
        .select('id, wallet_balance')
        .eq('id', mission.cleaner_id)
        .maybeSingle();
      if (workerErr) throw workerErr;

      const currentBalance = (workerProfile?.wallet_balance ?? 0) as number;
      const { error: balanceErr } = await supabase
        .from('profiles')
        .update({ wallet_balance: currentBalance + payoutEgp })
        .eq('id', mission.cleaner_id);
      if (balanceErr) throw balanceErr;

      const { error: jobErr } = await supabase
        .from('missions')
        .update({ status: 'finished' })
        .eq('id', mission.id);
      if (jobErr) throw jobErr;

      await fetchPendingApprovals();
      alert('Payment force-released successfully.');
    } catch (err: any) {
      console.error('Force pay error:', err);
      alert(err?.message || 'Failed to force-release payment.');
    } finally {
      setForcePayLoadingId(null);
    }
  };

  const activeCount = missions.filter((m) =>
    ['available', 'in_progress'].includes(m.status)
  ).length;
  const completedCount = missions.filter((m) => m.status === 'completed').length;

  const missionsCreatedByUserId = (missions || []).reduce<Record<string, number>>((acc, m) => {
    const creatorId = m.creator_id || '';
    if (!creatorId) return acc;
    acc[creatorId] = (acc[creatorId] || 0) + 1;
    return acc;
  }, {});

  const filteredProfiles = (profiles || []).filter((p) => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return true;
    const name = (p.full_name || '').toLowerCase();
    const handle = (p.telegram_username || '').toLowerCase();
    const email = (p.contact_email || '').toLowerCase();
    const phone = (p.phone_number || '').toLowerCase();
    return (
      name.includes(q) ||
      handle.includes(q) ||
      email.includes(q) ||
      phone.includes(q)
    );
  });

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col gap-6 text-white">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/20 text-slate-300 hover:bg-white/10 hover:text-white transition-all text-sm font-bold uppercase tracking-[0.18em]"
      >
        ← Back to Profile
      </button>

      <h2 className="text-xl font-black uppercase tracking-[0.2em] text-amber-400/90">
        👑 Admin Dashboard
      </h2>

      {error && (
        <p className="text-sm text-red-400 font-medium">{error}</p>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 border-2 border-amber-500/60 border-t-amber-400 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* System Stats */}
          <section className="rounded-2xl bg-black/40 border border-amber-500/30 p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-3">
              System Stats
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-slate-900/60 border border-white/5 p-3 text-center">
                <p className="text-2xl font-black text-emerald-400">{profiles.length}</p>
                <p className="text-[10px] text-slate-400 uppercase">Users</p>
              </div>
              <div className="rounded-xl bg-slate-900/60 border border-white/5 p-3 text-center">
                <p className="text-2xl font-black text-sky-400">{activeCount}</p>
                <p className="text-[10px] text-slate-400 uppercase">Active</p>
              </div>
              <div className="rounded-xl bg-slate-900/60 border border-white/5 p-3 text-center">
                <p className="text-2xl font-black text-amber-400">{completedCount}</p>
                <p className="text-[10px] text-slate-400 uppercase">Completed</p>
              </div>
            </div>
          </section>

          {/* Stuck Missions (Action Required) */}
          <section className="rounded-2xl bg-black/40 border border-red-500/30 p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-400/90 mb-3">
              ⚠️ Stuck Missions (Action Required)
            </h3>
            <div className="max-h-48 overflow-y-auto space-y-2 pr-1 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
              {pendingApprovals.length === 0 ? (
                <p className="text-slate-500 text-xs italic py-2">No stuck missions.</p>
              ) : (
                pendingApprovals.map((m) => (
                  <div
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-900/60 border border-white/5 px-3 py-2 text-[11px]"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-mono text-slate-300">Mission: #{String(m.id).slice(0, 8)}</span>
                      <span className="text-slate-500">Cleaner: {String(m.cleaner_id || '').slice(0, 8)}</span>
                      <span className="text-slate-400">${Number(m.amount_target).toFixed(2)}</span>
                    </div>
                    <button
                      type="button"
                      disabled={forcePayLoadingId === m.id}
                      onClick={() => handleForcePay(m)}
                      className="shrink-0 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-red-500/20 border border-red-400/60 text-red-300 hover:bg-red-500/30 hover:border-red-400 disabled:opacity-60 disabled:cursor-wait transition-all shadow-[0_0_12px_rgba(239,68,68,0.3)]"
                    >
                      {forcePayLoadingId === m.id ? '...' : 'Force Release Payment'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* 👥 User Directory */}
          <section className="rounded-2xl bg-cyan-950/30 backdrop-blur-md border border-cyan-500/20 shadow-[0_4px_30px_rgba(6,182,212,0.1)] p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400/90 mb-3">
              👥 User Directory
            </h3>

            <input
              type="text"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search by name, @username, email, or WhatsApp"
              className="mb-2 w-full rounded-2xl bg-slate-950 border border-cyan-500/40 px-3 py-1.5 text-[11px] text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
            />

            <div className="max-h-[420px] overflow-auto pr-1 rounded-xl border border-cyan-500/20 bg-cyan-950/10 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-[#020617]/95 backdrop-blur border-b border-cyan-500/20">
                  <tr className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
                    <th className="px-3 py-2">User</th>
                    <th className="px-3 py-2">WhatsApp</th>
                    <th className="px-3 py-2">Wallet</th>
                    <th className="px-3 py-2">Missions Created</th>
                    <th className="px-3 py-2">First GPS Track</th>
                    <th className="px-3 py-2 text-right">Verify</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProfiles.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-slate-500 italic">
                        No users match this search.
                      </td>
                    </tr>
                  ) : (
                    filteredProfiles.map((p) => {
                      const name = p.full_name || '—';
                      const handle = p.telegram_username ? `@${p.telegram_username}` : '—';
                      const email = p.contact_email || '—';
                      const phone = p.phone_number || '—';
                      const wallet = Number(p.wallet_balance ?? 0);
                      const createdCount = missionsCreatedByUserId[p.id] || 0;
                      const gps = parseFirstGpsTrack(p.first_gps_track);
                      const gpsLabel = gps ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : '—';
                      const verified = !!p.is_verified;
                      return (
                        <tr
                          key={p.id}
                          className="border-b border-cyan-500/10 bg-cyan-950/30 backdrop-blur hover:bg-cyan-950/40 transition-colors cursor-pointer"
                          onClick={() => openUser(p)}
                        >
                          <td className="px-3 py-2">
                            <div className="min-w-0 flex items-center gap-3">
                              <div className="h-9 w-9 rounded-full overflow-hidden border border-cyan-500/20 bg-slate-950 shrink-0">
                                {p.avatar_url ? (
                                  <img
                                    src={p.avatar_url}
                                    alt={name}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="h-full w-full flex items-center justify-center text-[11px] font-black text-cyan-300">
                                    {(name || 'U').slice(0, 1).toUpperCase()}
                                  </div>
                                )}
                              </div>
                              <div className="font-semibold text-slate-200 truncate">
                                {name}{' '}
                                <span className="text-slate-500 font-normal">({handle})</span>
                                {verified && (
                                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-[0.18em] border border-cyan-500/30 text-cyan-200 bg-cyan-500/10 shadow-[0_0_10px_rgba(34,211,238,0.25)]">
                                    Verified
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-500 truncate">{email}</div>
                              <div className="text-[10px] text-slate-600 font-mono truncate">
                                {p.id.slice(0, 8)}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-cyan-300 font-medium">{phone}</td>
                          <td className="px-3 py-2">
                            <span className="font-bold text-orange-400">
                              ${wallet.toFixed(2)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-200">{createdCount}</td>
                          <td className="px-3 py-2 text-slate-300 font-mono">{gpsLabel}</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleVerify(p.id, !verified);
                              }}
                              disabled={verifyLoadingUserId === p.id}
                              className={[
                                'inline-flex items-center justify-center px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.18em] transition-all',
                                'border',
                                verified
                                  ? 'border-orange-500/50 text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 hover:shadow-[0_0_12px_rgba(249,115,22,0.25)]'
                                  : 'border-cyan-500/40 text-cyan-200 bg-cyan-500/10 hover:bg-cyan-500/15 hover:shadow-[0_0_12px_rgba(34,211,238,0.22)]',
                                verifyLoadingUserId === p.id && 'opacity-60 cursor-wait',
                              ].join(' ')}
                            >
                              {verifyLoadingUserId === p.id ? '...' : verified ? 'Unverify' : 'Verify'}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Recent Transactions */}
          <section className="rounded-2xl bg-black/40 border border-amber-500/30 p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-3">
              Recent Transactions
            </h3>
            <div className="max-h-56 overflow-y-auto space-y-2 pr-1 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
              {(transactions || []).map((tx) => (
                <div
                  key={tx.id}
                  className="flex justify-between items-center rounded-xl bg-slate-900/60 border border-white/5 px-3 py-2 text-[11px]"
                >
                  <div>
                    <p className="font-mono text-slate-300">{tx.type}</p>
                    <p className="text-slate-500 text-[10px]">
                      {new Date(tx.created_at).toLocaleString()}
                    </p>
                  </div>
                  <p
                    className={`font-bold ${
                      ['deposit', 'mission_reward', 'donation'].includes(tx.type)
                        ? 'text-emerald-400'
                        : 'text-amber-400'
                    }`}
                  >
                    ${Number(tx.amount).toFixed(2)}
                  </p>
                </div>
              ))}
              {transactions.length === 0 && (
                <p className="text-slate-500 text-xs italic py-4 text-center">
                  No transactions yet.
                </p>
              )}
            </div>
          </section>
        </>
      )}

      {/* User deep-dive modal */}
      {selectedUser && (
        <div
          className="fixed inset-0 z-[160] flex items-center justify-center p-4 pt-[env(safe-area-inset-top)] bg-black/70 backdrop-blur-sm"
          onClick={() => setSelectedUser(null)}
          aria-hidden="false"
        >
          <div
            className="w-full max-w-3xl rounded-3xl bg-cyan-950/30 backdrop-blur-md border border-cyan-500/20 shadow-[0_4px_30px_rgba(6,182,212,0.12)] p-5 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="p-2 -m-2 mr-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                aria-label="Close"
              >
                ✕
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-black uppercase tracking-[0.35em] text-cyan-300/80">
                  User Deep-Dive
                </p>
                <h3 className="mt-1 text-lg font-extrabold tracking-tight text-white truncate">
                  {selectedUser.full_name || '—'}{' '}
                  <span className="text-slate-400 font-normal">
                    {selectedUser.telegram_username ? `(@${selectedUser.telegram_username})` : ''}
                  </span>
                </h3>
                <p className="mt-1 text-[11px] text-slate-400 truncate">
                  {selectedUser.contact_email || '—'} •{' '}
                  <span className="text-cyan-300">{selectedUser.phone_number || '—'}</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Wallet</p>
                <p className="text-orange-400 font-black">
                  ${Number(selectedUser.wallet_balance ?? 0).toFixed(2)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-2xl bg-black/30 border border-cyan-500/15 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
                  First GPS Track
                </p>
                {(() => {
                  const gps = parseFirstGpsTrack(selectedUser.first_gps_track);
                  if (!gps || !MAPBOX_TOKEN) {
                    return (
                      <p className="text-xs text-slate-500 italic">
                        {MAPBOX_TOKEN ? 'No GPS track available.' : 'Mapbox token missing.'}
                      </p>
                    );
                  }
                  return (
                    <div className="rounded-xl overflow-hidden border border-cyan-500/20">
                      <Map
                        mapboxAccessToken={MAPBOX_TOKEN}
                        initialViewState={{
                          latitude: gps.lat,
                          longitude: gps.lng,
                          zoom: 13,
                        }}
                        style={{ width: '100%', height: 220 }}
                        mapStyle="mapbox://styles/mapbox/dark-v11"
                      >
                        <Marker latitude={gps.lat} longitude={gps.lng} anchor="bottom">
                          <div className="w-4 h-4 rounded-full border-2 border-orange-500 shadow-[0_0_12px_rgba(249,115,22,0.6)] bg-slate-950" />
                        </Marker>
                      </Map>
                    </div>
                  );
                })()}
              </div>

              <div className="rounded-2xl bg-black/30 border border-cyan-500/15 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
                  IP / Device (if available)
                </p>
                {(() => {
                  const fromTx = selectedUserTransactions.find(
                    (tx) => tx.ip_address || tx.user_agent || tx.device_info
                  );
                  const ip = fromTx?.ip_address ?? null;
                  const ua = fromTx?.user_agent ?? null;
                  const device = fromTx?.device_info ?? null;
                  if (!ip && !ua && !device) {
                    return <p className="text-xs text-slate-500 italic">No IP/device info found.</p>;
                  }
                  return (
                    <div className="space-y-2 text-[11px]">
                      {ip && (
                        <p className="text-slate-300">
                          <span className="text-slate-500">IP:</span>{' '}
                          <span className="font-mono">{ip}</span>
                        </p>
                      )}
                      {device && (
                        <p className="text-slate-300">
                          <span className="text-slate-500">Device:</span> {device}
                        </p>
                      )}
                      {ua && (
                        <p className="text-slate-300">
                          <span className="text-slate-500">UA:</span>{' '}
                          <span className="break-all">{ua}</span>
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="mt-4 rounded-2xl bg-black/30 border border-cyan-500/15 p-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  Transaction History (this user)
                </p>
                {selectedUserTxLoading && (
                  <div className="h-4 w-4 border-2 border-cyan-500/60 border-t-cyan-300 rounded-full animate-spin" />
                )}
              </div>

              {selectedUserTxError && (
                <p className="text-xs text-red-400">{selectedUserTxError}</p>
              )}

              <div className="max-h-64 overflow-y-auto space-y-2 pr-1 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
                {selectedUserTransactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-cyan-950/30 backdrop-blur border border-cyan-500/10 px-3 py-2 text-[11px]"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-slate-200 truncate">
                        {tx.type}
                        {tx.gateway ? <span className="text-slate-500">{` • ${tx.gateway}`}</span> : null}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {new Date(tx.created_at).toLocaleString()}
                      </p>
                      {tx.mission_id && (
                        <p className="text-[10px] text-slate-600 font-mono">
                          Mission: {String(tx.mission_id).slice(0, 8)}
                        </p>
                      )}
                    </div>
                    <p
                      className={`font-black ${
                        ['deposit', 'mission_reward', 'donation'].includes(tx.type)
                          ? 'text-emerald-400'
                          : 'text-amber-400'
                      }`}
                    >
                      ${Number(tx.amount).toFixed(2)}
                    </p>
                  </div>
                ))}
                {!selectedUserTxLoading && selectedUserTransactions.length === 0 && (
                  <p className="text-slate-500 text-xs italic py-4 text-center">
                    No transactions found for this user.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
