/**
 * [[Architecture_Overview.md]]
 * Admin moderation dashboard — content review, delete mission, finance view.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../services/supabase';
import Map, { Marker } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  applyMapboxStandardBasemapConfig,
  MAPBOX_STANDARD_STYLE,
  whenMapStyleReady,
} from '../lib/mapboxStandardTheme';
import { runMissionAiAnalysis } from '../lib/openai';
import { adminDeleteMission } from '../lib/adminMission';
import { isPlatformAdmin } from '../lib/platformAdmin';
import KYCReviewDashboard from './KYCReviewDashboard';
import { ADMIN_FORCE_RELEASE_PAYMENT_BTN } from '../../constants';
import { formatTokens, formatWorkBudgetUsd } from '../lib/formatMoney';
import ModeratedMissionPhoto from '../../components/ModeratedMissionPhoto';
import ProfileCard from '../../components/ProfileCard';

interface ProfileRow {
  id: string;
  full_name?: string | null;
  telegram_username?: string | null;
  wallet_balance?: number | null;
  contact_email?: string | null;
  phone_number?: string | null;
  avatar_url?: string | null;
  is_verified?: boolean | null;
  is_banned?: boolean | null;
  first_gps_track?: unknown;
}

/** Enrich profiles with phones via admin RPC (column SELECT revoked for authenticated). */
async function withAdminPhones(rows: ProfileRow[]): Promise<ProfileRow[]> {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id).filter(Boolean);
  const { data, error } = await supabase.rpc('admin_get_profile_phones', {
    p_user_ids: ids,
  });
  if (error) {
    console.warn('admin_get_profile_phones', error.message);
    return rows;
  }
  const phoneById = new globalThis.Map<string, string | null>();
  for (const row of (data || []) as { user_id: string; phone_number: string | null }[]) {
    phoneById.set(row.user_id, row.phone_number);
  }
  return rows.map((r) => ({ ...r, phone_number: phoneById.get(r.id) ?? null }));
}

interface MissionRow {
  id: string;
  status: string;
  title?: string | null;
  creator_id?: string | null;
  cleaner_id?: string | null;
  category?: string | null;
  amount_target?: number | null;
  location_lat?: number | null;
  location_lng?: number | null;
  country?: string | null;
  city?: string | null;
  description?: string | null;
  created_at?: string | null;
  photo_urls?: string[] | null;
  after_photo_urls?: string[] | null;
  ai_confidence_score?: number | null;
  ai_verdict?: string | null;
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
  status?: string | null;
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
  const [adminChecked, setAdminChecked] = useState(false);
  const [isAllowedAdmin, setIsAllowedAdmin] = useState(false);

  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [missions, setMissions] = useState<MissionRow[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalRow[]>([]);
  const [pendingApprovalsError, setPendingApprovalsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adminDeleteLoadingId, setAdminDeleteLoadingId] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<ProfileRow | null>(null);
  const [selectedUserTransactions, setSelectedUserTransactions] = useState<TransactionRow[]>([]);
  const [selectedUserTxLoading, setSelectedUserTxLoading] = useState(false);
  const [selectedUserTxError, setSelectedUserTxError] = useState<string | null>(null);
  const [verifyLoadingUserId, setVerifyLoadingUserId] = useState<string | null>(null);

  type TabId = 'god' | 'missions' | 'finance' | 'disputes' | 'kyc';
  const [activeTab, setActiveTab] = useState<TabId>('god');

  const [godSearch, setGodSearch] = useState('');
  const [godLoading, setGodLoading] = useState(false);
  const [godError, setGodError] = useState<string | null>(null);

  const [editBalanceUser, setEditBalanceUser] = useState<ProfileRow | null>(null);
  const [editBalanceValue, setEditBalanceValue] = useState<string>('');
  const [editBalanceSubmitting, setEditBalanceSubmitting] = useState(false);

  const [missionsLoading, setMissionsLoading] = useState(false);
  const [missionsError, setMissionsError] = useState<string | null>(null);

  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<{
    total_donated: number;
    supervisor_bounties_total: number;
    active_missions: number;
    completed_missions: number;
  } | null>(null);

  const [disputes, setDisputes] = useState<MissionRow[]>([]);
  const [disputesLoading, setDisputesLoading] = useState(false);
  const [disputesError, setDisputesError] = useState<string | null>(null);
  const [aiRunningMissionId, setAiRunningMissionId] = useState<string | null>(null);
  const [lastAiRunByMissionId, setLastAiRunByMissionId] = useState<Record<string, string>>({});

  const fetchPendingApprovals = async () => {
    setPendingApprovalsError(null);
    const { data, error: err } = await supabase
      .from('missions')
      .select('id, amount_target, cleaner_id, status, after_photo_urls')
      .in('status', ['completed', 'in_progress', 'disputed'])
      .not('cleaner_id', 'is', null)
      .order('created_at', { ascending: false });
    if (err) {
      console.error('Pending approvals fetch error:', err);
      setPendingApprovalsError(err.message || 'Failed to load stuck missions.');
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
        supabase.rpc('admin_list_profiles_finance', { p_limit: 50 }),
        supabase.from('missions').select('id, status, creator_id').limit(50),
        supabase
          .from('transactions')
          .select('id, user_id, mission_id, amount, type, gateway, created_at')
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      if (profRes.error) throw profRes.error;
      if (missRes.error) throw missRes.error;
      if (txRes.error) throw txRes.error;

      setProfiles(await withAdminPhones((profRes.data || []) as ProfileRow[]));
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
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user ?? null;

        let role: string | null = null;
        let telegramUsername: string | null = null;
        if (user?.id) {
          const [{ data: profile }, { data: priv }] = await Promise.all([
            supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
            supabase.rpc('get_own_private_profile'),
          ]);
          role = (profile as { role?: string | null } | null)?.role ?? null;
          const row = (priv && typeof priv === 'object' ? priv : {}) as Record<string, unknown>;
          telegramUsername = row.telegram_username ? String(row.telegram_username) : null;
        }

        const isAdmin = isPlatformAdmin({
          email: user?.email,
          telegramUsername,
          role,
        });

        setIsAllowedAdmin(!!isAdmin);
      } catch {
        setIsAllowedAdmin(false);
      } finally {
        setAdminChecked(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (adminChecked && isAllowedAdmin) {
      fetchAll();
    }
  }, [adminChecked, isAllowedAdmin]);

  const openUser = async (p: ProfileRow) => {
    setSelectedUser(p);
    setSelectedUserTransactions([]);
    setSelectedUserTxError(null);
    setSelectedUserTxLoading(true);
    try {
      const { data, error: txErr } = await supabase
        .from('transactions')
        .select('id, user_id, mission_id, amount, type, gateway, created_at')
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
      const { error: updErr } = await supabase.rpc('admin_set_profile_verified', {
        p_user_id: userId,
        p_verified: nextValue,
      });
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

  const toggleBan = async (userId: string, nextValue: boolean) => {
    try {
      const { error: updErr } = await supabase.rpc('admin_set_profile_banned', {
        p_user_id: userId,
        p_banned: nextValue,
      });
      if (updErr) throw updErr;
      setProfiles((prev) => prev.map((p) => (p.id === userId ? { ...p, is_banned: nextValue } : p)));
      alert(nextValue ? 'User banned.' : 'User unbanned.');
    } catch (e: any) {
      console.error('Ban toggle error:', e);
      alert(e?.message || 'Failed to update ban status.');
    }
  };

  const submitBalanceEdit = async () => {
    if (!editBalanceUser) return;
    const next = Number(editBalanceValue);
    if (!Number.isFinite(next)) {
      alert('Invalid balance value.');
      return;
    }
    setEditBalanceSubmitting(true);
    try {
      const { error: updErr } = await supabase.rpc('admin_set_wallet_balance', {
        p_user_id: editBalanceUser.id,
        p_balance: next,
      });
      if (updErr) throw updErr;
      setProfiles((prev) => prev.map((p) => (p.id === editBalanceUser.id ? { ...p, wallet_balance: next } : p)));
      alert('Balance updated.');
      setEditBalanceUser(null);
    } catch (e: any) {
      console.error('Edit balance error:', e);
      alert(e?.message || 'Failed to update balance.');
    } finally {
      setEditBalanceSubmitting(false);
    }
  };

  const loadGodMode = async () => {
    setGodLoading(true);
    setGodError(null);
    try {
      const { data, error } = await supabase.rpc('admin_list_profiles_finance', {
        p_limit: 50,
      });
      if (error) throw error;
      setProfiles(await withAdminPhones((data || []) as ProfileRow[]));
    } catch (e: any) {
      console.error('God mode fetch error:', e);
      setGodError(e?.message || 'Failed to load users.');
    } finally {
      setGodLoading(false);
    }
  };

  const loadMissionControl = async () => {
    setMissionsLoading(true);
    setMissionsError(null);
    try {
      const { data, error: err } = await supabase
        .from('missions')
        .select('id, status, creator_id, cleaner_id, category, amount_target, location_lat, location_lng, country, city, description, created_at, photo_urls, after_photo_urls')
        .in('status', ['pending_payment', 'pending', 'available', 'funding', 'in_progress', 'completed', 'disputed', 'pending_verification', 'review', 'dispute'])
        .order('created_at', { ascending: false })
        .limit(50);
      if (err) throw err;
      setMissions((data || []) as MissionRow[]);
    } catch (e: any) {
      console.error('Mission control fetch error:', e);
      setMissionsError(e?.message || 'Failed to load missions.');
    } finally {
      setMissionsLoading(false);
    }
  };

  const cleanGhostPins = async () => {
    if (!window.confirm('Clean ghost pins older than 24h?')) return;
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { error: delErr } = await supabase
        .from('missions')
        .delete()
        .eq('status', 'pending_payment')
        .lt('created_at', cutoff);
      if (delErr) throw delErr;
      alert('Ghost pins cleaned.');
      await loadMissionControl();
    } catch (e: any) {
      console.error('Clean ghost pins error:', e);
      alert(e?.message || 'Failed to clean ghost pins.');
    }
  };

  const forceCancelMission = async (missionId: string) => {
    if (!window.confirm('Force cancel this mission?')) return;
    try {
      const { error: rpcErr } = await supabase.rpc('force_cancel_mission', { p_mission_id: missionId });
      if (rpcErr) throw rpcErr;
      alert('Mission cancelled.');
      await loadMissionControl();
    } catch (e: any) {
      console.error('Force cancel error:', e);
      alert(e?.message || 'Failed to cancel mission.');
    }
  };

  const loadMetrics = async () => {
    setMetricsLoading(true);
    setMetricsError(null);
    try {
      const { data, error: err } = await supabase.rpc('admin_financial_metrics');
      if (err) throw err;
      const row = Array.isArray(data) ? data[0] : data;
      setMetrics({
        total_donated: Number(row?.total_donated ?? 0),
        supervisor_bounties_total: Number(row?.supervisor_bounties_total ?? 0),
        active_missions: Number(row?.active_missions ?? 0),
        completed_missions: Number(row?.completed_missions ?? 0),
      });
    } catch (e: any) {
      console.error('Metrics error:', e);
      setMetricsError(e?.message || 'Failed to load metrics.');
      setMetrics(null);
    } finally {
      setMetricsLoading(false);
    }
  };

  const loadFinanceTab = async () => {
    await loadMetrics();
  };

  const loadDisputes = async () => {
    setDisputesLoading(true);
    setDisputesError(null);
    try {
      const { data, error: err } = await supabase
        .from('missions')
        .select('id, status, creator_id, cleaner_id, category, amount_target, location_lat, location_lng, country, city, description, created_at, photo_urls, after_photo_urls, ai_confidence_score, ai_verdict')
        .in('status', ['disputed', 'pending_verification', 'review', 'dispute'])
        .order('created_at', { ascending: false })
        .limit(30);
      if (err) throw err;
      setDisputes((data || []) as MissionRow[]);
    } catch (e: any) {
      console.error('Disputes fetch error:', e);
      setDisputesError(e?.message || 'Failed to load disputes.');
    } finally {
      setDisputesLoading(false);
    }
  };

  const resolveDispute = async (missionId: string, decision: 'approve' | 'reject') => {
    if (!window.confirm(decision === 'approve' ? 'Approve moderation (mark completed, no payout)?' : 'Reject dispute?')) return;
    try {
      const mission = disputes.find((d) => d.id === missionId) ?? null;
      const supervisorComment =
        decision === 'reject'
          ? (mission?.ai_verdict?.trim() || 'AI FRAUD DETECTED')
          : null;

      const { error: err } = await supabase.rpc('resolve_mission_dispute', {
        p_mission_id: missionId,
        p_decision: decision,
        p_supervisor_comment: supervisorComment,
        p_supervisor_verified: false,
        p_supervisor_user_id: null,
      });
      if (err) throw err;
      alert(decision === 'approve' ? 'Approved — status set to completed (P2P, no escrow payout).' : 'Rejected.');
      await loadDisputes();
    } catch (e: any) {
      console.error('Resolve dispute error:', e);
      alert(e?.message || 'Failed to resolve dispute.');
    }
  };

  const runAiForMission = async (m: MissionRow) => {
    if (aiRunningMissionId) return;
    setAiRunningMissionId(m.id);
    try {
      const result = await runMissionAiAnalysis(m.id);

      const { error: updErr } = await supabase
        .from('missions')
        .update({
          ai_confidence_score: result.score,
          ai_verdict: result.verdict,
        })
        .eq('id', m.id);
      if (updErr) throw updErr;

      setLastAiRunByMissionId((prev) => ({
        ...prev,
        [m.id]: new Date().toISOString(),
      }));

      alert('AI analysis saved.');
      await loadDisputes();
    } catch (e: any) {
      console.error('AI analysis error:', e);
      alert(e?.message || 'AI analysis failed.');
    } finally {
      setAiRunningMissionId(null);
    }
  };

  const handleAdminDeleteStuckMission = async (mission: PendingApprovalRow) => {
    if (!window.confirm('Permanently delete this mission from the map? This cannot be undone.')) return;
    setAdminDeleteLoadingId(mission.id);
    try {
      await adminDeleteMission(mission.id);
      await fetchPendingApprovals();
      alert('Mission deleted from the map.');
    } catch (err: any) {
      console.error('Admin delete mission error:', err);
      alert(err?.message || 'Failed to delete mission.');
    } finally {
      setAdminDeleteLoadingId(null);
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

  const filteredGodProfiles = useMemo(() => {
    const q = godSearch.trim().toLowerCase();
    if (!q) return profiles;
    return (profiles || []).filter((p) => {
      const email = (p.contact_email || '').toLowerCase();
      const phone = (p.phone_number || '').toLowerCase();
      return email.includes(q) || phone.includes(q);
    });
  }, [godSearch, profiles]);

  if (!adminChecked) {
    return (
      <div className="w-full max-w-4xl mx-auto p-6 text-white">
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 border-2 border-orange-500/60 border-t-orange-400 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!isAllowedAdmin) {
    return (
      <div className="w-full max-w-4xl mx-auto p-6 text-white">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/20 text-slate-300 hover:bg-white/10 hover:text-white transition-all text-sm font-bold uppercase tracking-[0.18em]"
        >
          ← Back to Profile
        </button>
        <div className="mt-6 rounded-2xl bg-slate-950 border border-orange-500/20 p-6">
          <p className="text-sm text-slate-300">Access denied.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col gap-6 text-white px-4 sm:px-6">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/20 text-slate-300 hover:bg-white/10 hover:text-white transition-all text-sm font-bold uppercase tracking-[0.18em]"
      >
        ← Back to Profile
      </button>

      <h2 className="text-xl font-black uppercase tracking-[0.2em] text-orange-400/90">
        👑 Admin Panel Pro
      </h2>

      <div className="w-full -mx-1 px-1">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {([
          { id: 'god', label: 'God Mode' },
          { id: 'kyc', label: 'KYC Review' },
          { id: 'missions', label: 'Mission Control' },
          { id: 'finance', label: 'Financial Analytics' },
          { id: 'disputes', label: 'Dispute Center' },
        ] as { id: TabId; label: string }[]).map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={async () => {
                setActiveTab(tab.id);
                if (tab.id === 'god') await loadGodMode();
                if (tab.id === 'missions') await loadMissionControl();
                if (tab.id === 'finance') await loadFinanceTab();
                if (tab.id === 'disputes') await loadDisputes();
              }}
              className={[
                'px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.18em] border transition-all active:scale-95',
                active
                  ? 'border-orange-500/50 text-orange-200 bg-orange-500/10 shadow-[0_0_14px_rgba(249,115,22,0.22)]'
                  : 'border-white/15 text-slate-300 bg-white/5 hover:bg-white/10',
              ].join(' ')}
            >
              {tab.label}
            </button>
          );
        })}
        </div>
      </div>

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
              {pendingApprovalsError ? (
                <p className="text-red-300 text-xs py-2">{pendingApprovalsError}</p>
              ) : pendingApprovals.length === 0 ? (
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
                      <span className="text-slate-400">{formatTokens(Number(m.amount_target))}</span>
                    </div>
                    <button
                      type="button"
                      disabled={adminDeleteLoadingId === m.id}
                      onClick={() => handleAdminDeleteStuckMission(m)}
                      className={ADMIN_FORCE_RELEASE_PAYMENT_BTN}
                    >
                      {adminDeleteLoadingId === m.id && (
                        <span className="inline-block h-3 w-3 shrink-0 rounded-full border-2 border-red-200/40 border-t-red-100 animate-spin" aria-hidden />
                      )}
                      <span>{adminDeleteLoadingId === m.id ? 'Processing...' : 'Delete Mission'}</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Tab content */}
          {activeTab === 'god' && (
            <section className="rounded-2xl bg-slate-950 border border-orange-500/20 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-300/90">
                  God Mode (User Management)
                </h3>
                <button
                  type="button"
                  onClick={loadGodMode}
                  disabled={godLoading}
                  className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border border-orange-500/40 text-orange-200 bg-orange-500/10 hover:bg-orange-500/20 disabled:opacity-60 disabled:cursor-wait transition-all"
                >
                  {godLoading ? '...' : 'Refresh'}
                </button>
              </div>

              <input
                type="text"
                value={godSearch}
                onChange={(e) => setGodSearch(e.target.value)}
                placeholder="Search by phone/email"
                className="mb-3 w-full rounded-2xl bg-black/40 border border-orange-500/30 px-3 py-2 text-[11px] text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
              />
              {godError && <p className="text-xs text-red-300 mb-2">{godError}</p>}

              {/* Mobile: stacked cards (no horizontal scroll) */}
              <div className="space-y-2 md:hidden">
                {filteredGodProfiles.length === 0 && (
                  <p className="px-1 py-6 text-center text-slate-500 italic">No users.</p>
                )}
                {filteredGodProfiles.map((p) => {
                  const name = p.full_name || '—';
                  const handle = p.telegram_username ? `@${p.telegram_username}` : '';
                  const verified = !!p.is_verified;
                  const banned = !!p.is_banned;
                  return (
                    <div
                      key={p.id}
                      className="rounded-2xl border border-orange-500/15 bg-cyan-950/20 backdrop-blur p-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full border border-orange-500/20 bg-slate-950">
                          {p.avatar_url ? (
                            <img src={p.avatar_url} alt={name} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-sm font-black text-orange-300">
                              {(name || 'U').slice(0, 1).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-slate-100">
                            {name}
                            {verified && <span className="ml-1.5 text-emerald-400">✅</span>}
                            {banned && <span className="ml-1.5 text-red-400">⛔</span>}
                          </p>
                          {handle && <p className="truncate text-[11px] text-slate-500">{handle}</p>}
                          <p className="truncate text-[11px] text-slate-400">{p.contact_email || '—'}</p>
                          <p className="truncate text-[11px] text-cyan-300">{p.phone_number || '—'}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500">Wallet</p>
                          <p className="font-black text-orange-400">{formatTokens(Number(p.wallet_balance ?? 0))}</p>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => toggleVerify(p.id, true)}
                          disabled={verifyLoadingUserId === p.id || verified}
                          className="flex-1 min-w-[7rem] px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.18em] border border-emerald-500/40 text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/15 disabled:opacity-60 disabled:cursor-wait transition-all"
                        >
                          Verify Agent
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditBalanceUser(p);
                            setEditBalanceValue(String(Number(p.wallet_balance ?? 0)));
                          }}
                          className="flex-1 min-w-[7rem] px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.18em] border border-orange-500/40 text-orange-200 bg-orange-500/10 hover:bg-orange-500/20 transition-all"
                        >
                          Edit Balance
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleBan(p.id, true)}
                          disabled={banned}
                          className="flex-1 min-w-[7rem] px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.18em] border border-red-500/40 text-red-200 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-60 transition-all"
                        >
                          Ban User
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop: table */}
              <div className="hidden md:block max-h-[420px] overflow-auto pr-1 rounded-xl border border-orange-500/15 bg-black/20 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-[#020617]/95 backdrop-blur border-b border-orange-500/15">
                    <tr className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
                      <th className="px-3 py-2">User</th>
                      <th className="px-3 py-2">Contact</th>
                      <th className="px-3 py-2">Wallet</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredGodProfiles.map((p) => {
                      const name = p.full_name || '—';
                      const handle = p.telegram_username ? `@${p.telegram_username}` : '';
                      const verified = !!p.is_verified;
                      const banned = !!p.is_banned;
                      return (
                        <tr
                          key={p.id}
                          className="border-b border-orange-500/10 bg-cyan-950/20 backdrop-blur hover:bg-cyan-950/30 transition-colors"
                        >
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-3">
                              <div className="h-9 w-9 rounded-full overflow-hidden border border-orange-500/20 bg-slate-950 shrink-0">
                                {p.avatar_url ? (
                                  <img src={p.avatar_url} alt={name} className="h-full w-full object-cover" />
                                ) : (
                                  <div className="h-full w-full flex items-center justify-center text-[11px] font-black text-orange-300">
                                    {(name || 'U').slice(0, 1).toUpperCase()}
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold text-slate-200 truncate">
                                  {name}{' '}
                                  <span className="text-slate-500 font-normal">{handle ? `(${handle})` : ''}</span>
                                  {verified && <span className="ml-2 text-emerald-400">✅</span>}
                                  {banned && <span className="ml-2 text-red-400">⛔</span>}
                                </div>
                                <div className="text-[10px] text-slate-500 font-mono">{p.id.slice(0, 8)}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="text-[10px] text-slate-300">{p.contact_email || '—'}</div>
                            <div className="text-[10px] text-cyan-300">{p.phone_number || '—'}</div>
                          </td>
                          <td className="px-3 py-2">
                            <span className="font-black text-orange-400">{formatTokens(Number(p.wallet_balance ?? 0))}</span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-2 justify-end">
                              <button
                                type="button"
                                onClick={() => toggleVerify(p.id, true)}
                                disabled={verifyLoadingUserId === p.id || verified}
                                className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.18em] border border-emerald-500/40 text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/15 disabled:opacity-60 disabled:cursor-wait transition-all"
                              >
                                Verify Agent
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditBalanceUser(p);
                                  setEditBalanceValue(String(Number(p.wallet_balance ?? 0)));
                                }}
                                className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.18em] border border-orange-500/40 text-orange-200 bg-orange-500/10 hover:bg-orange-500/20 transition-all"
                              >
                                Edit Balance
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleBan(p.id, true)}
                                disabled={banned}
                                className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.18em] border border-red-500/40 text-red-200 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-60 transition-all"
                              >
                                Ban User
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredGodProfiles.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-slate-500 italic">
                          No users.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === 'kyc' && <KYCReviewDashboard isAllowedAdmin={isAllowedAdmin} />}

          {activeTab === 'missions' && (
            <section className="rounded-2xl bg-slate-950 border border-orange-500/20 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-300/90">
                  Mission Control
                </h3>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                  <button
                    type="button"
                    onClick={cleanGhostPins}
                    className="px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border border-red-500/50 text-red-200 bg-red-500/10 hover:bg-red-500/20 hover:shadow-[0_0_16px_rgba(239,68,68,0.25)] transition-all active:scale-95"
                  >
                    Clean Ghost Pins
                  </button>
                  <button
                    type="button"
                    onClick={loadMissionControl}
                    disabled={missionsLoading}
                    className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border border-orange-500/40 text-orange-200 bg-orange-500/10 hover:bg-orange-500/20 disabled:opacity-60 transition-all active:scale-95"
                  >
                    {missionsLoading ? '...' : 'Refresh'}
                  </button>
                </div>
              </div>
              {missionsError && <p className="text-xs text-red-300 mb-2">{missionsError}</p>}

              {/* Mobile: stacked cards */}
              <div className="space-y-2 md:hidden">
                {missions.length === 0 && (
                  <p className="px-1 py-6 text-center text-slate-500 italic">No missions.</p>
                )}
                {(missions || []).map((m) => (
                  <div
                    key={m.id}
                    className="rounded-2xl border border-orange-500/15 bg-cyan-950/20 backdrop-blur p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-sm text-slate-100">#{m.id.slice(0, 8)}</p>
                        <p className="mt-0.5 text-[11px] uppercase tracking-[0.14em] text-slate-400">{m.status}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500 font-mono">
                          Creator: {(m.creator_id || '—').slice(0, 8)}
                        </p>
                      </div>
                      <p className="shrink-0 font-black text-orange-300">{formatTokens(Number(m.amount_target ?? 0))}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => forceCancelMission(m.id)}
                      className="mt-3 w-full px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.18em] border border-red-500/40 text-red-200 bg-red-500/10 hover:bg-red-500/20 transition-all"
                    >
                      Force Cancel
                    </button>
                  </div>
                ))}
              </div>

              {/* Desktop: table */}
              <div className="hidden md:block max-h-[520px] overflow-auto pr-1 rounded-xl border border-orange-500/15 bg-black/20 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-[#020617]/95 backdrop-blur border-b border-orange-500/15">
                    <tr className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
                      <th className="px-3 py-2">Mission</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Amount</th>
                      <th className="px-3 py-2">Creator</th>
                      <th className="px-3 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(missions || []).map((m) => (
                      <tr key={m.id} className="border-b border-orange-500/10 bg-cyan-950/20">
                        <td className="px-3 py-2 font-mono text-slate-200">{m.id.slice(0, 8)}</td>
                        <td className="px-3 py-2 text-slate-300">{m.status}</td>
                        <td className="px-3 py-2 text-orange-300">{formatTokens(Number(m.amount_target ?? 0))}</td>
                        <td className="px-3 py-2 text-slate-500 font-mono">{(m.creator_id || '').slice(0, 8)}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => forceCancelMission(m.id)}
                            className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.18em] border border-red-500/40 text-red-200 bg-red-500/10 hover:bg-red-500/20 transition-all"
                          >
                            Force Cancel
                          </button>
                        </td>
                      </tr>
                    ))}
                    {missions.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-slate-500 italic">
                          No missions.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === 'finance' && (
            <section className="rounded-2xl bg-slate-950 border border-orange-500/20 p-4">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-300/90">
                  Financial Analytics
                </h3>
                <button
                  type="button"
                  onClick={loadFinanceTab}
                  disabled={metricsLoading}
                  className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border border-orange-500/40 text-orange-200 bg-orange-500/10 hover:bg-orange-500/20 disabled:opacity-60 transition-all"
                >
                  {metricsLoading ? '...' : 'Refresh'}
                </button>
              </div>
              {metricsError && <p className="text-xs text-red-300 mb-2">{metricsError}</p>}

              {/* Hero: total donated */}
              <div className="mb-4 overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent p-5">
                <div className="flex items-center gap-2">
                  <span className="text-lg" aria-hidden>💰</span>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-300/90">
                    Total Donated (Gross Volume)
                  </p>
                </div>
                <p className="mt-2 text-4xl font-black tracking-tight text-emerald-300 sm:text-5xl">
                  {formatWorkBudgetUsd(Number(metrics?.total_donated ?? 0))}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  Lifetime crowdfunding + donation inflow processed by the platform.
                </p>
              </div>

              {/* Contribution-model metrics (payouts/withdrawals retired) */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[
                  {
                    icon: '♻️',
                    label: 'Retained Contributions',
                    display: formatWorkBudgetUsd(Number(metrics?.total_donated ?? 0)),
                    color: 'text-emerald-300',
                    caption: 'Non-refundable — no card refunds',
                    ring: 'border-emerald-500/20',
                  },
                  {
                    icon: '🎖️',
                    label: 'Supervisor Bounties',
                    display: formatWorkBudgetUsd(Number(metrics?.supervisor_bounties_total ?? 0)),
                    color: 'text-cyan-300',
                    caption: 'Ahmed-Pro network rewards',
                    ring: 'border-cyan-500/20',
                  },
                  {
                    icon: '🟢',
                    label: 'Active Missions',
                    display: String(metrics?.active_missions ?? 0),
                    color: 'text-emerald-200',
                    caption: 'Live on the marketplace',
                    ring: 'border-emerald-500/15',
                  },
                  {
                    icon: '✅',
                    label: 'Completed Missions',
                    display: String(metrics?.completed_missions ?? 0),
                    color: 'text-slate-200',
                    caption: 'Closed / verified',
                    ring: 'border-white/10',
                  },
                ].map((c) => (
                  <div
                    key={c.label}
                    className={`rounded-2xl bg-cyan-950/20 backdrop-blur-md border ${c.ring} p-4`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                        {c.label}
                      </p>
                      <span className="text-base" aria-hidden>{c.icon}</span>
                    </div>
                    <p className={`mt-2 text-3xl font-black ${c.color}`}>{c.display}</p>
                    <p className="mt-1 text-[10px] text-slate-500">{c.caption}</p>
                  </div>
                ))}
              </div>

              <p className="mt-4 rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3 text-[11px] leading-relaxed text-slate-500">
                <span className="font-bold text-emerald-300/90">Economic model:</span> contributions are
                non-refundable. Payouts and balance withdrawals are retired — monetization and mission
                ranking run on token boosting (“продвижение за токены”). Amounts are USD-only (no FX).
              </p>
            </section>
          )}

          {activeTab === 'disputes' && (
            <section className="rounded-2xl bg-slate-950 border border-orange-500/20 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-300/90">
                  Dispute Center
                </h3>
                <button
                  type="button"
                  onClick={loadDisputes}
                  disabled={disputesLoading}
                  className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border border-orange-500/40 text-orange-200 bg-orange-500/10 hover:bg-orange-500/20 disabled:opacity-60 transition-all"
                >
                  {disputesLoading ? '...' : 'Refresh'}
                </button>
              </div>
              {disputesError && <p className="text-xs text-red-300 mb-2">{disputesError}</p>}

              <div className="space-y-4">
                {disputes.map((m) => (
                  <div key={m.id} className="rounded-2xl bg-cyan-950/20 backdrop-blur-md border border-orange-500/10 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-[11px] font-mono text-slate-200">#{m.id.slice(0, 8)}</p>
                        <p className="text-[10px] text-slate-500 uppercase tracking-[0.18em]">{m.status}</p>
                        {m.description && <p className="mt-2 text-xs text-slate-300">{m.description}</p>}
                      </div>
                      {m.status === 'completed' ? (
                        <span className="shrink-0 px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                          Completed & Paid
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-2">Before</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          {(m.photo_urls || []).slice(0, 4).map((url) => (
                            <div key={url} className="aspect-square rounded-xl overflow-hidden border border-white/10 bg-black/30">
                              <ModeratedMissionPhoto
                                url={url}
                                alt="Before"
                                imgClassName="h-full w-full object-cover"
                                showSafeBadge={false}
                              />
                            </div>
                          ))}
                          {(m.photo_urls || []).length === 0 && (
                            <p className="text-xs text-slate-500 italic">No before photos.</p>
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-2">After</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          {(m.after_photo_urls || []).slice(0, 4).map((url) => (
                            <div key={url} className="aspect-square rounded-xl overflow-hidden border border-white/10 bg-black/30">
                              <ModeratedMissionPhoto
                                url={url}
                                alt="After"
                                imgClassName="h-full w-full object-cover"
                                showSafeBadge={false}
                              />
                            </div>
                          ))}
                          {(m.after_photo_urls || []).length === 0 && (
                            <p className="text-xs text-slate-500 italic">No after photos.</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {m.status !== 'completed' && (
                      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        <button
                          type="button"
                          onClick={() => runAiForMission(m)}
                          disabled={aiRunningMissionId === m.id}
                          className="w-full sm:w-auto sm:flex-1 min-w-0 px-3 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border border-cyan-500/30 text-cyan-200 bg-cyan-500/10 hover:bg-cyan-500/15 hover:shadow-[0_0_14px_rgba(34,211,238,0.22)] disabled:opacity-60 disabled:cursor-wait transition-all active:scale-95"
                        >
                          {aiRunningMissionId === m.id ? '...' : '🤖 Run AI Analysis'}
                        </button>
                        <button
                          type="button"
                          onClick={() => resolveDispute(m.id, 'approve')}
                          className="w-full sm:w-auto sm:flex-1 min-w-0 px-3 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border border-emerald-500/40 text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/15 transition-all active:scale-95"
                        >
                          Approve & Payout
                        </button>
                        <button
                          type="button"
                          onClick={() => resolveDispute(m.id, 'reject')}
                          className="w-full sm:w-auto sm:flex-1 min-w-0 px-3 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border border-red-500/40 text-red-200 bg-red-500/10 hover:bg-red-500/20 transition-all active:scale-95"
                        >
                          Reject
                        </button>
                      </div>
                    )}

                    {(typeof m.ai_confidence_score === 'number' || m.ai_verdict) && (
                      <details className="mt-4 w-full rounded-xl border border-cyan-500/25 bg-slate-950/60 px-3 py-2 text-left max-h-[50vh] overflow-y-auto">
                        <summary className="cursor-pointer list-none text-[11px] font-black uppercase tracking-[0.14em] text-cyan-200/95 [&::-webkit-details-marker]:hidden">
                          🔍 AI Verification Details
                        </summary>
                        <div className="mt-2 space-y-2 text-[11px] text-slate-300">
                          {typeof m.ai_confidence_score === 'number' && (
                            <span
                              className={[
                                'inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-[0.18em] border',
                                m.ai_confidence_score > 85
                                  ? 'border-emerald-500/40 text-emerald-200 bg-emerald-500/10'
                                  : m.ai_confidence_score > 50
                                    ? 'border-amber-500/40 text-amber-200 bg-amber-500/10'
                                    : 'border-red-500/40 text-red-200 bg-red-500/10',
                              ].join(' ')}
                            >
                              AI {m.ai_confidence_score}%
                            </span>
                          )}
                          {m.ai_verdict && (
                            <pre className="whitespace-pre-wrap break-words font-sans text-sm md:text-base leading-relaxed text-slate-200">
                              {m.ai_verdict}
                            </pre>
                          )}
                        </div>
                      </details>
                    )}

                    {isAllowedAdmin && (
                      <div className="mt-4 rounded text-xs font-mono text-cyan-500/70 bg-slate-950/50 p-2 border border-cyan-900/30">
                        <p>Before URLs: {(m.photo_urls || []).length}</p>
                        <p>After URLs: {(m.after_photo_urls || []).length}</p>
                        <p>
                          Last AI Run:{' '}
                          {lastAiRunByMissionId[m.id]
                            ? new Date(lastAiRunByMissionId[m.id]).toLocaleString()
                            : 'Never'}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
                {!disputesLoading && disputes.length === 0 && (
                  <p className="text-sm text-slate-500 italic">No disputes.</p>
                )}
              </div>
            </section>
          )}

          {/* Existing 👥 User Directory (kept) */}
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

            {/* Mobile: stacked user cards (no horizontal scroll) */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:hidden">
              {filteredProfiles.length === 0 ? (
                <p className="col-span-full px-1 py-6 text-center text-slate-500 italic">
                  No users match this search.
                </p>
              ) : (
                filteredProfiles.map((p) => {
                  const name = p.full_name || '—';
                  const handle = p.telegram_username ? `@${p.telegram_username}` : '—';
                  const phone = p.phone_number || '—';
                  const wallet = Number(p.wallet_balance ?? 0);
                  const createdCount = missionsCreatedByUserId[p.id] || 0;
                  const gps = parseFirstGpsTrack(p.first_gps_track);
                  const gpsLabel = gps ? `${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : '—';
                  const verified = !!p.is_verified;
                  return (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => openUser(p)}
                      className="w-full rounded-2xl border border-cyan-500/15 bg-cyan-950/25 backdrop-blur p-3 text-left transition-colors hover:bg-cyan-950/40"
                    >
                      <div className="flex items-start gap-3">
                        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full border border-cyan-500/20 bg-slate-950">
                          {p.avatar_url ? (
                            <img src={p.avatar_url} alt={name} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-sm font-black text-cyan-300">
                              {(name || 'U').slice(0, 1).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-slate-100">
                            {name}
                            {verified && (
                              <span className="ml-1.5 inline-flex items-center rounded-full border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] text-cyan-200 align-middle">
                                Verified
                              </span>
                            )}
                          </p>
                          <p className="truncate text-[11px] text-slate-500">{handle}</p>
                          <p className="truncate text-[11px] text-cyan-300">{phone}</p>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-1.5">
                        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-1.5 py-1.5 text-center">
                          <p className="text-sm font-black text-orange-400">{formatTokens(wallet)}</p>
                          <p className="text-[8px] font-bold uppercase tracking-[0.1em] text-slate-500">Wallet</p>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-1.5 py-1.5 text-center">
                          <p className="text-sm font-black text-slate-100">{createdCount}</p>
                          <p className="text-[8px] font-bold uppercase tracking-[0.1em] text-slate-500">Missions</p>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-1.5 py-1.5 text-center">
                          <p className="truncate text-[10px] font-mono font-bold text-slate-300">{gpsLabel}</p>
                          <p className="text-[8px] font-bold uppercase tracking-[0.1em] text-slate-500">GPS</p>
                        </div>
                      </div>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleVerify(p.id, !verified);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleVerify(p.id, !verified);
                          }
                        }}
                        className={[
                          'mt-3 flex w-full items-center justify-center px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.18em] transition-all border cursor-pointer',
                          verified
                            ? 'border-orange-500/50 text-orange-300 bg-orange-500/10 hover:bg-orange-500/20'
                            : 'border-cyan-500/40 text-cyan-200 bg-cyan-500/10 hover:bg-cyan-500/15',
                          verifyLoadingUserId === p.id && 'opacity-60 cursor-wait',
                        ].join(' ')}
                      >
                        {verifyLoadingUserId === p.id ? '...' : verified ? 'Unverify' : 'Verify'}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {/* Desktop: table */}
            <div className="hidden md:block max-h-[420px] overflow-auto pr-1 rounded-xl border border-cyan-500/20 bg-cyan-950/10 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
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
                      <td colSpan={6} className="px-3 py-6 text-center text-slate-500 italic">
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
                              {formatTokens(wallet)}
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
                    {formatTokens(Number(tx.amount))}
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

      {/* Edit Balance modal */}
      {editBalanceUser && (
        <div
          className="fixed inset-0 z-[170] flex items-center justify-center p-4 pt-[env(safe-area-inset-top)] bg-black/70 backdrop-blur-sm"
          onClick={() => setEditBalanceUser(null)}
          aria-hidden="false"
        >
          <div
            className="w-[95vw] md:w-full max-w-4xl rounded-3xl bg-slate-950/95 backdrop-blur-xl border border-orange-500/20 p-5"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <button
                type="button"
                onClick={() => setEditBalanceUser(null)}
                className="p-2 -m-2 mr-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                aria-label="Close"
              >
                ✕
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-black uppercase tracking-[0.35em] text-orange-300/80">
                  Edit Balance
                </p>
                <p className="mt-1 text-sm font-bold text-white truncate">
                  {editBalanceUser.full_name || editBalanceUser.id.slice(0, 8)}
                </p>
              </div>
            </div>

            <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
              New wallet_balance (USD)
            </label>
            <input
              type="number"
              inputMode="decimal"
              value={editBalanceValue}
              onChange={(e) => setEditBalanceValue(e.target.value)}
              className="w-full rounded-2xl bg-black/40 border border-orange-500/20 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
            />

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => setEditBalanceUser(null)}
                className="flex-1 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border border-white/15 text-slate-300 hover:bg-white/10 transition-all active:scale-95"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitBalanceEdit}
                disabled={editBalanceSubmitting}
                className="flex-1 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border border-orange-500/50 text-orange-200 bg-orange-500/10 hover:bg-orange-500/20 disabled:opacity-60 disabled:cursor-wait transition-all active:scale-95"
              >
                {editBalanceSubmitting ? '...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User deep-dive modal */}
      {selectedUser && (
        <div
          className="fixed inset-0 z-[160] flex items-center justify-center p-4 pt-[env(safe-area-inset-top)] bg-black/70 backdrop-blur-sm"
          onClick={() => setSelectedUser(null)}
          aria-hidden="false"
        >
          <div
            className="w-[95vw] md:w-full max-w-4xl rounded-3xl bg-cyan-950/30 backdrop-blur-md border border-cyan-500/20 shadow-[0_4px_30px_rgba(6,182,212,0.12)] p-5 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative mb-4">
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="absolute right-0 top-0 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/50 text-slate-300 hover:text-white hover:bg-white/10 transition-all"
                aria-label="Close"
              >
                ✕
              </button>
              <ProfileCard
                accent="cyan"
                name={selectedUser.full_name || selectedUser.id.slice(0, 8)}
                avatarUrl={selectedUser.avatar_url}
                handle={selectedUser.telegram_username ? `@${selectedUser.telegram_username}` : undefined}
                isVerified={!!selectedUser.is_verified}
                subtitle={
                  <span className="block truncate">
                    {selectedUser.contact_email || '—'} •{' '}
                    <span className="text-cyan-300">{selectedUser.phone_number || '—'}</span>
                  </span>
                }
                badges={
                  <>
                    {selectedUser.is_banned && (
                      <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-red-300">
                        Banned
                      </span>
                    )}
                    {selectedUser.is_verified && (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-emerald-300">
                        Verified Agent
                      </span>
                    )}
                  </>
                }
                stats={[
                  {
                    label: 'Wallet',
                    value: formatTokens(Number(selectedUser.wallet_balance ?? 0)),
                    accent: 'text-orange-400',
                  },
                  {
                    label: 'Missions',
                    value: missionsCreatedByUserId[selectedUser.id] || 0,
                    accent: 'text-cyan-300',
                  },
                  {
                    label: 'Transactions',
                    value: selectedUserTransactions.length,
                    accent: 'text-emerald-300',
                  },
                ]}
                actions={
                  <>
                    <button
                      type="button"
                      onClick={() => toggleVerify(selectedUser.id, !selectedUser.is_verified)}
                      disabled={verifyLoadingUserId === selectedUser.id}
                      className="flex-1 min-w-[8rem] px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.18em] border border-cyan-500/40 text-cyan-200 bg-cyan-500/10 hover:bg-cyan-500/15 disabled:opacity-60 disabled:cursor-wait transition-all"
                    >
                      {verifyLoadingUserId === selectedUser.id
                        ? '...'
                        : selectedUser.is_verified
                          ? 'Unverify'
                          : 'Verify Agent'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditBalanceUser(selectedUser);
                        setEditBalanceValue(String(Number(selectedUser.wallet_balance ?? 0)));
                      }}
                      className="flex-1 min-w-[8rem] px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.18em] border border-orange-500/40 text-orange-200 bg-orange-500/10 hover:bg-orange-500/20 transition-all"
                    >
                      Edit Balance
                    </button>
                  </>
                }
              />
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
                          pitch: 45,
                          bearing: -20,
                        }}
                        style={{ width: '100%', height: 220 }}
                        mapStyle={MAPBOX_STANDARD_STYLE}
                        onLoad={(e) => {
                          const map = e.target as {
                            isStyleLoaded?: () => boolean;
                            once?: (t: string, fn: () => void) => void;
                            setConfigProperty?: (a: string, b: string, c: unknown) => void;
                          };
                          whenMapStyleReady(map, (ready) => {
                            applyMapboxStandardBasemapConfig(ready);
                          });
                        }}
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
                <p className="text-xs text-slate-500 italic">
                  Not available in current schema.
                </p>
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
                      {formatTokens(Number(tx.amount))}
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
