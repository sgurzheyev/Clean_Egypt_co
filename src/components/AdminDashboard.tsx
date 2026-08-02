/**
 * Admin Console — 3 pillars: Analytics · Users & Stores · Platform Control
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Map, { Marker } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { supabase } from '../../services/supabase';
import {
  applyMapboxStandardBasemapConfig,
  MAPBOX_STANDARD_STYLE_WITH_CONFIG,
  whenMapStyleReady,
} from '../lib/mapboxStandardTheme';
import { runMissionAiAnalysis } from '../lib/openai';
import { adminDeleteMission } from '../lib/adminMission';
import { isPlatformAdmin } from '../lib/platformAdmin';
import { YEARLY_SUBSCRIPTION } from '../lib/tokenPricing';
import KYCReviewDashboard from './KYCReviewDashboard';
import { ADMIN_FORCE_RELEASE_PAYMENT_BTN } from '../../constants';
import { formatTokens } from '../lib/formatMoney';
import ModeratedMissionPhoto from '../../components/ModeratedMissionPhoto';
import ProfileCard from '../../components/ProfileCard';

/** Supabase Postgrest errors are plain objects — String(e) becomes "[object Object]". */
function formatUnknownError(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message.trim()) return e.message;
  if (typeof e === 'string' && e.trim()) return e;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message.trim()) return o.message;
    if (typeof o.details === 'string' && o.details.trim()) return o.details;
    if (typeof o.hint === 'string' && o.hint.trim()) return o.hint;
    try {
      return JSON.stringify(e);
    } catch {
      /* ignore */
    }
  }
  return fallback;
}

interface ProfileRow {
  id: string;
  full_name?: string | null;
  telegram_username?: string | null;
  contact_email?: string | null;
  phone_number?: string | null;
  avatar_url?: string | null;
  token_balance?: number | null;
  subscription_expires_at?: string | null;
  verification_status?: string | null;
  wallet_balance?: number | null;
  is_verified?: boolean | null;
  is_banned?: boolean | null;
  first_gps_track?: unknown;
  store_id?: string | null;
  store_name?: string | null;
  store_published?: boolean | null;
}

interface StoreRow {
  id: string;
  owner_id: string;
  store_name: string | null;
  is_published: boolean;
  office_address: string | null;
  owner_name: string | null;
  updated_at: string | null;
}

interface MissionRow {
  id: string;
  status: string;
  title?: string | null;
  creator_id?: string | null;
  cleaner_id?: string | null;
  category?: string | null;
  amount_target?: number | null;
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
}

interface SaasMetrics {
  total_users: number;
  active_subscriptions: number;
  tokens_purchased: number;
  tokens_consumed: number;
  tokens_in_circulation: number;
}

interface MarketplacePulse {
  active_missions: number;
  completed_missions: number;
}

type PillarId = 'analytics' | 'users' | 'control';
type UsersSub = 'people' | 'stores' | 'kyc';
type ControlSub = 'stuck' | 'missions' | 'disputes';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

const PILLAR_BTN =
  'px-4 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.16em] border transition-all active:scale-95';
const SUB_BTN =
  'px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.14em] border transition-all';

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

function parseFirstGpsTrack(value: unknown): { lat: number; lng: number } | null {
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
    const v = value as Record<string, unknown>;
    const lat = Number(v.lat ?? v.latitude);
    const lng = Number(v.lng ?? v.lon ?? v.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

function formatSubPeriod(expiresAt: string | null | undefined, locale?: string) {
  const endMs = expiresAt ? Date.parse(expiresAt) : NaN;
  if (!Number.isFinite(endMs)) return null;
  const end = new Date(endMs);
  const start = new Date(end);
  start.setMonth(start.getMonth() - YEARLY_SUBSCRIPTION.months);
  const fmt = (d: Date) =>
    d.toLocaleDateString(locale || undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  return {
    active: endMs > Date.now(),
    startLabel: fmt(start),
    endLabel: fmt(end),
    daysLeft: Math.max(0, Math.ceil((endMs - Date.now()) / 86_400_000)),
  };
}

const AdminDashboard: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [adminChecked, setAdminChecked] = useState(false);
  const [isAllowedAdmin, setIsAllowedAdmin] = useState(false);
  const [pillar, setPillar] = useState<PillarId>('analytics');
  const [usersSub, setUsersSub] = useState<UsersSub>('people');
  const [controlSub, setControlSub] = useState<ControlSub>('stuck');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [saasMetrics, setSaasMetrics] = useState<SaasMetrics | null>(null);
  const [pulse, setPulse] = useState<MarketplacePulse | null>(null);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);

  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<ProfileRow | null>(null);
  const [verifyLoadingUserId, setVerifyLoadingUserId] = useState<string | null>(null);
  const [grantUser, setGrantUser] = useState<ProfileRow | null>(null);
  const [grantTokens, setGrantTokens] = useState('100');
  const [grantBusy, setGrantBusy] = useState(false);

  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalRow[]>([]);
  const [pendingApprovalsError, setPendingApprovalsError] = useState<string | null>(null);
  const [adminDeleteLoadingId, setAdminDeleteLoadingId] = useState<string | null>(null);

  const [missions, setMissions] = useState<MissionRow[]>([]);
  const [missionsLoading, setMissionsLoading] = useState(false);
  const [missionsError, setMissionsError] = useState<string | null>(null);

  const [disputes, setDisputes] = useState<MissionRow[]>([]);
  const [disputesLoading, setDisputesLoading] = useState(false);
  const [disputesError, setDisputesError] = useState<string | null>(null);
  const [aiRunningMissionId, setAiRunningMissionId] = useState<string | null>(null);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [saasRes, pulseRes, txRes] = await Promise.all([
        supabase.rpc('admin_saas_overview_metrics'),
        supabase.rpc('admin_financial_metrics'),
        supabase
          .from('transactions')
          .select('id, user_id, mission_id, amount, type, gateway, created_at')
          .order('created_at', { ascending: false })
          .limit(20),
      ]);
      if (saasRes.error) throw saasRes.error;
      if (txRes.error) throw txRes.error;
      const saasRow = Array.isArray(saasRes.data) ? saasRes.data[0] : saasRes.data;
      setSaasMetrics({
        total_users: Number(saasRow?.total_users ?? 0),
        active_subscriptions: Number(saasRow?.active_subscriptions ?? 0),
        tokens_purchased: Number(saasRow?.tokens_purchased ?? 0),
        tokens_consumed: Number(saasRow?.tokens_consumed ?? 0),
        tokens_in_circulation: Number(saasRow?.tokens_in_circulation ?? 0),
      });
      if (!pulseRes.error) {
        const prow = Array.isArray(pulseRes.data) ? pulseRes.data[0] : pulseRes.data;
        setPulse({
          active_missions: Number(prow?.active_missions ?? 0),
          completed_missions: Number(prow?.completed_missions ?? 0),
        });
      }
      setTransactions((txRes.data || []) as TransactionRow[]);
    } catch (e: unknown) {
      const msg = formatUnknownError(e, 'Failed to load analytics.');
      console.error('Admin analytics', msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.rpc('admin_list_profiles_finance', {
        p_limit: 100,
      });
      if (err) throw err;
      setProfiles(await withAdminPhones((data || []) as ProfileRow[]));
    } catch (e: unknown) {
      setError(formatUnknownError(e, 'Failed to load users.'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStores = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.rpc('admin_list_contractor_stores', {
        p_limit: 100,
      });
      if (err) throw err;
      setStores((data || []) as StoreRow[]);
    } catch (e: unknown) {
      setError(formatUnknownError(e, 'Failed to load stores.'));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPendingApprovals = useCallback(async () => {
    setPendingApprovalsError(null);
    const { data, error: err } = await supabase
      .from('missions')
      .select('id, amount_target, cleaner_id, status, after_photo_urls')
      .in('status', ['completed', 'in_progress', 'disputed'])
      .not('cleaner_id', 'is', null)
      .order('created_at', { ascending: false });
    if (err) {
      setPendingApprovalsError(err.message || 'Failed to load stuck missions.');
      return;
    }
    const rows = (data || []) as PendingApprovalRow[];
    setPendingApprovals(
      rows.filter(
        (m) =>
          m.status === 'completed' ||
          (m.after_photo_urls && m.after_photo_urls.length > 0)
      )
    );
  }, []);

  const loadMissionControl = useCallback(async () => {
    setMissionsLoading(true);
    setMissionsError(null);
    try {
      const { data, error: err } = await supabase
        .from('missions')
        .select(
          'id, status, creator_id, cleaner_id, category, amount_target, description, created_at, photo_urls, after_photo_urls'
        )
        .in('status', [
          'pending_payment',
          'pending',
          'available',
          'funding',
          'in_progress',
          'completed',
          'disputed',
          'pending_verification',
          'review',
          'dispute',
        ])
        .order('created_at', { ascending: false })
        .limit(50);
      if (err) throw err;
      setMissions((data || []) as MissionRow[]);
    } catch (e: unknown) {
      setMissionsError(formatUnknownError(e, 'Failed to load missions.'));
    } finally {
      setMissionsLoading(false);
    }
  }, []);

  const loadDisputes = useCallback(async () => {
    setDisputesLoading(true);
    setDisputesError(null);
    try {
      const { data, error: err } = await supabase
        .from('missions')
        .select(
          'id, status, creator_id, cleaner_id, category, amount_target, description, created_at, photo_urls, after_photo_urls, ai_confidence_score, ai_verdict'
        )
        .in('status', ['disputed', 'pending_verification', 'review', 'dispute'])
        .order('created_at', { ascending: false })
        .limit(30);
      if (err) throw err;
      setDisputes((data || []) as MissionRow[]);
    } catch (e: unknown) {
      setDisputesError(formatUnknownError(e, 'Failed to load disputes.'));
    } finally {
      setDisputesLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
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
        setIsAllowedAdmin(
          !!isPlatformAdmin({ email: user?.email, telegramUsername, role })
        );
      } catch {
        setIsAllowedAdmin(false);
      } finally {
        setAdminChecked(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!adminChecked || !isAllowedAdmin) return;
    if (pillar === 'analytics') void loadAnalytics();
    if (pillar === 'users' && usersSub === 'people') void loadUsers();
    if (pillar === 'users' && usersSub === 'stores') void loadStores();
    if (pillar === 'control' && controlSub === 'stuck') void fetchPendingApprovals();
    if (pillar === 'control' && controlSub === 'missions') void loadMissionControl();
    if (pillar === 'control' && controlSub === 'disputes') void loadDisputes();
  }, [
    adminChecked,
    isAllowedAdmin,
    pillar,
    usersSub,
    controlSub,
    loadAnalytics,
    loadUsers,
    loadStores,
    fetchPendingApprovals,
    loadMissionControl,
    loadDisputes,
  ]);

  const filteredProfiles = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter((p) => {
      const blob = [
        p.full_name,
        p.telegram_username,
        p.contact_email,
        p.phone_number,
        p.id,
      ]
        .join(' ')
        .toLowerCase();
      return blob.includes(q);
    });
  }, [profiles, userSearch]);

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
      setSelectedUser((prev) =>
        prev?.id === userId ? { ...prev, is_verified: nextValue } : prev
      );
    } catch (e: unknown) {
      alert(formatUnknownError(e, 'Failed to update verification.'));
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
      setProfiles((prev) =>
        prev.map((p) => (p.id === userId ? { ...p, is_banned: nextValue } : p))
      );
      setSelectedUser((prev) =>
        prev?.id === userId ? { ...prev, is_banned: nextValue } : prev
      );
      alert(nextValue ? 'User banned.' : 'User unbanned.');
    } catch (e: unknown) {
      alert(formatUnknownError(e, 'Failed to update ban status.'));
    }
  };

  const submitGrantTokens = async () => {
    if (!grantUser) return;
    const n = Math.floor(Number(grantTokens));
    if (!Number.isFinite(n) || n === 0) {
      alert('Enter a non-zero token amount.');
      return;
    }
    setGrantBusy(true);
    try {
      const { data, error: err } = await supabase.rpc('admin_grant_tokens', {
        p_user_id: grantUser.id,
        p_tokens: n,
      });
      if (err) throw err;
      const next = Number(data);
      setProfiles((prev) =>
        prev.map((p) =>
          p.id === grantUser.id
            ? { ...p, token_balance: Number.isFinite(next) ? next : p.token_balance }
            : p
        )
      );
      setSelectedUser((prev) =>
        prev?.id === grantUser.id
          ? { ...prev, token_balance: Number.isFinite(next) ? next : prev.token_balance }
          : prev
      );
      setGrantUser(null);
      alert(`Token balance updated → ${next}`);
    } catch (e: unknown) {
      alert(formatUnknownError(e, 'Failed to grant tokens.'));
    } finally {
      setGrantBusy(false);
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
    } catch (e: unknown) {
      alert(formatUnknownError(e, 'Failed to clean ghost pins.'));
    }
  };

  const forceCancelMission = async (missionId: string) => {
    if (!window.confirm('Force cancel this mission?')) return;
    try {
      const { error: rpcErr } = await supabase.rpc('force_cancel_mission', {
        p_mission_id: missionId,
      });
      if (rpcErr) throw rpcErr;
      alert('Mission cancelled.');
      await loadMissionControl();
    } catch (e: unknown) {
      alert(formatUnknownError(e, 'Failed to cancel mission.'));
    }
  };

  const resolveDispute = async (missionId: string, decision: 'approve' | 'reject') => {
    if (
      !window.confirm(
        decision === 'approve'
          ? 'Approve moderation (mark completed, no payout)?'
          : 'Reject dispute?'
      )
    )
      return;
    try {
      const mission = disputes.find((d) => d.id === missionId) ?? null;
      const { error: err } = await supabase.rpc('resolve_mission_dispute', {
        p_mission_id: missionId,
        p_decision: decision,
        p_supervisor_comment:
          decision === 'reject'
            ? mission?.ai_verdict?.trim() || 'AI FRAUD DETECTED'
            : null,
        p_supervisor_verified: false,
        p_supervisor_user_id: null,
      });
      if (err) throw err;
      alert(decision === 'approve' ? 'Approved (P2P, no escrow).' : 'Rejected.');
      await loadDisputes();
    } catch (e: unknown) {
      alert(formatUnknownError(e, 'Failed to resolve dispute.'));
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
      alert('AI analysis saved.');
      await loadDisputes();
    } catch (e: unknown) {
      alert(formatUnknownError(e, 'AI analysis failed.'));
    } finally {
      setAiRunningMissionId(null);
    }
  };

  const handleAdminDeleteStuckMission = async (mission: PendingApprovalRow) => {
    if (!window.confirm('Permanently delete this mission?')) return;
    setAdminDeleteLoadingId(mission.id);
    try {
      await adminDeleteMission(mission.id);
      await fetchPendingApprovals();
      alert('Mission deleted.');
    } catch (e: unknown) {
      alert(formatUnknownError(e, 'Failed to delete mission.'));
    } finally {
      setAdminDeleteLoadingId(null);
    }
  };

  if (!adminChecked) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500/40 border-t-cyan-300" />
      </div>
    );
  }

  if (!isAllowedAdmin) {
    return (
      <div className="mx-auto w-full max-w-4xl p-6 text-white">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-white/20 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-slate-300 hover:bg-white/10"
        >
          ← Back to Profile
        </button>
        <div className="mt-6 rounded-2xl border border-cyan-500/20 bg-slate-950 p-6">
          <p className="text-sm text-slate-300">Access denied.</p>
        </div>
      </div>
    );
  }

  const selectedPeriod = selectedUser
    ? formatSubPeriod(selectedUser.subscription_expires_at)
    : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 text-white sm:px-6">
      <button
        type="button"
        onClick={onBack}
        className="w-fit rounded-full border border-white/20 px-4 py-2 text-sm font-bold uppercase tracking-[0.18em] text-slate-300 hover:bg-white/10"
      >
        ← Back to Profile
      </button>

      <div>
        <h2 className="text-xl font-black uppercase tracking-[0.2em] text-cyan-300">
          Admin Console
        </h2>
        <p className="mt-1 text-[11px] text-slate-500">
          SaaS overview · user directory · platform controls
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {(
          [
            { id: 'analytics' as const, label: 'Analytics & Overview' },
            { id: 'users' as const, label: 'Users & Stores' },
            { id: 'control' as const, label: 'Platform Control' },
          ] as const
        ).map((tab) => {
          const active = pillar === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPillar(tab.id)}
              className={`${PILLAR_BTN} ${
                active
                  ? 'border-cyan-400/55 bg-cyan-500/15 text-cyan-100 shadow-[0_0_16px_rgba(34,211,238,0.25)]'
                  : 'border-white/15 bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {error && <p className="text-sm font-medium text-red-400">{error}</p>}

      {loading && pillar !== 'control' ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500/50 border-t-cyan-300" />
        </div>
      ) : null}

      {/* ─── Pillar A: Analytics ─── */}
      {pillar === 'analytics' && !loading && (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
              SaaS KPIs
            </h3>
            <button
              type="button"
              onClick={() => void loadAnalytics()}
              className={`${SUB_BTN} border-cyan-500/40 bg-cyan-500/10 text-cyan-200`}
            >
              Refresh
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-cyan-400/40 bg-gradient-to-br from-cyan-500/20 via-slate-950 to-slate-950 p-4 shadow-[0_0_24px_rgba(34,211,238,0.18)]">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300/90">
                Total Registered Users
              </p>
              <p className="mt-2 text-3xl font-black tabular-nums text-cyan-100">
                {saasMetrics?.total_users ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-400/40 bg-gradient-to-br from-emerald-500/20 via-slate-950 to-slate-950 p-4 shadow-[0_0_24px_rgba(16,185,129,0.18)]">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300/90">
                Active Subscriptions
              </p>
              <p className="mt-2 text-3xl font-black tabular-nums text-emerald-100">
                {saasMetrics?.active_subscriptions ?? 0}
              </p>
              <p className="mt-1 text-[10px] text-emerald-200/70">Currently valid / paid</p>
            </div>
            <div className="rounded-2xl border border-lime-400/40 bg-gradient-to-br from-lime-500/20 via-slate-950 to-slate-950 p-4 shadow-[0_0_24px_rgba(132,204,22,0.18)]">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-lime-300/90">
                Token Economy Volume
              </p>
              <p className="mt-2 text-lg font-black leading-snug text-lime-100">
                Purchased {formatTokens(saasMetrics?.tokens_purchased ?? 0)}
              </p>
              <p className="text-sm font-bold text-lime-200/90">
                Consumed {formatTokens(saasMetrics?.tokens_consumed ?? 0)}
              </p>
              <p className="mt-1 text-[10px] text-slate-400">
                In circulation: {formatTokens(saasMetrics?.tokens_in_circulation ?? 0)}
              </p>
            </div>
          </div>

          <section className="rounded-2xl border border-white/10 bg-black/40 p-4">
            <h4 className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
              Marketplace pulse
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-cyan-500/20 bg-slate-900/60 p-3 text-center">
                <p className="text-2xl font-black text-cyan-300">{pulse?.active_missions ?? 0}</p>
                <p className="text-[10px] uppercase text-slate-400">Active missions</p>
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-slate-900/60 p-3 text-center">
                <p className="text-2xl font-black text-emerald-300">
                  {pulse?.completed_missions ?? 0}
                </p>
                <p className="text-[10px] uppercase text-slate-400">Completed</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-black/40 p-4">
            <h4 className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
              Recent transactions
            </h4>
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1 [scrollbar-width:none]">
              {transactions.length === 0 ? (
                <p className="text-xs italic text-slate-500">No recent transactions.</p>
              ) : (
                transactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/5 bg-slate-900/50 px-3 py-2 text-[11px]"
                  >
                    <span className="font-mono text-slate-400">{tx.type}</span>
                    <span className="text-cyan-300">{formatTokens(Number(tx.amount))}</span>
                    <span className="text-slate-500">
                      {new Date(tx.created_at).toLocaleString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}

      {/* ─── Pillar B: Users & Stores ─── */}
      {pillar === 'users' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: 'people' as const, label: 'People' },
                { id: 'stores' as const, label: 'Stores' },
                { id: 'kyc' as const, label: 'KYC' },
              ] as const
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setUsersSub(s.id)}
                className={`${SUB_BTN} ${
                  usersSub === s.id
                    ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-100'
                    : 'border-white/15 bg-white/5 text-slate-400'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {usersSub === 'people' && !loading && (
            <section className="rounded-2xl border border-cyan-500/25 bg-slate-950/80 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300/90">
                  User directory
                </h3>
                <button
                  type="button"
                  onClick={() => void loadUsers()}
                  className={`${SUB_BTN} border-cyan-500/40 bg-cyan-500/10 text-cyan-200`}
                >
                  Refresh
                </button>
              </div>
              <input
                type="search"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search name, email, phone, telegram…"
                className="mb-3 w-full rounded-2xl border border-cyan-500/25 bg-black/40 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-cyan-500/30"
              />
              <div className="max-h-[28rem] space-y-2 overflow-y-auto [scrollbar-width:thin]">
                {filteredProfiles.length === 0 ? (
                  <p className="py-8 text-center text-sm italic text-slate-500">No users.</p>
                ) : (
                  filteredProfiles.map((p) => {
                    const period = formatSubPeriod(p.subscription_expires_at);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedUser(p)}
                        className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-cyan-950/20 px-3 py-3 text-left transition-colors hover:border-cyan-400/40 hover:bg-cyan-950/35"
                      >
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-cyan-500/30 bg-slate-950">
                          {p.avatar_url ? (
                            <img
                              src={p.avatar_url}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-xs font-black text-cyan-300">
                              {(p.full_name || 'U').slice(0, 1).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-white">
                            {p.full_name || p.id.slice(0, 8)}
                            {p.is_verified ? (
                              <span className="ml-1.5 text-emerald-400">✓</span>
                            ) : null}
                            {p.is_banned ? (
                              <span className="ml-1.5 text-red-400">⛔</span>
                            ) : null}
                          </p>
                          <p className="truncate text-[11px] text-slate-400">
                            {p.contact_email || p.phone_number || '—'}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[10px] font-black tabular-nums text-lime-300">
                            {formatTokens(Number(p.token_balance ?? 0))}
                          </p>
                          <p
                            className={`text-[9px] font-bold uppercase ${
                              period?.active ? 'text-emerald-400' : 'text-amber-400'
                            }`}
                          >
                            {period?.active ? 'Sub active' : 'Sub expired'}
                          </p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </section>
          )}

          {usersSub === 'stores' && !loading && (
            <section className="rounded-2xl border border-violet-500/25 bg-slate-950/80 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-300">
                  Contractor stores
                </h3>
                <button
                  type="button"
                  onClick={() => void loadStores()}
                  className={`${SUB_BTN} border-violet-500/40 bg-violet-500/10 text-violet-200`}
                >
                  Refresh
                </button>
              </div>
              <div className="space-y-2">
                {stores.length === 0 ? (
                  <p className="py-6 text-center text-sm italic text-slate-500">No stores.</p>
                ) : (
                  stores.map((s) => (
                    <div
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-violet-950/20 px-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-bold text-white">
                          {s.store_name || 'Untitled store'}
                        </p>
                        <p className="truncate text-[11px] text-slate-400">
                          {s.owner_name || s.owner_id.slice(0, 8)}
                          {s.office_address ? ` · ${s.office_address}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase ${
                            s.is_published
                              ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
                              : 'border-slate-500/40 bg-slate-500/10 text-slate-400'
                          }`}
                        >
                          {s.is_published ? 'Published' : 'Draft'}
                        </span>
                        <Link
                          to={`/store/${s.owner_id}`}
                          className="rounded-full border border-violet-400/40 bg-violet-500/15 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-violet-100"
                        >
                          Open
                        </Link>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {usersSub === 'kyc' && <KYCReviewDashboard isAllowedAdmin={isAllowedAdmin} />}
        </div>
      )}

      {/* ─── Pillar C: Platform Control ─── */}
      {pillar === 'control' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: 'stuck' as const, label: 'Stuck missions' },
                { id: 'missions' as const, label: 'Mission control' },
                { id: 'disputes' as const, label: 'Disputes' },
              ] as const
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setControlSub(s.id)}
                className={`${SUB_BTN} ${
                  controlSub === s.id
                    ? 'border-rose-400/50 bg-rose-500/15 text-rose-100'
                    : 'border-white/15 bg-white/5 text-slate-400'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {controlSub === 'stuck' && (
            <section className="rounded-2xl border border-red-500/30 bg-black/40 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-400/90">
                  Stuck missions
                </h3>
                <button
                  type="button"
                  onClick={() => void fetchPendingApprovals()}
                  className={`${SUB_BTN} border-red-500/40 bg-red-500/10 text-red-200`}
                >
                  Refresh
                </button>
              </div>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {pendingApprovalsError ? (
                  <p className="text-xs text-red-300">{pendingApprovalsError}</p>
                ) : pendingApprovals.length === 0 ? (
                  <p className="py-2 text-xs italic text-slate-500">No stuck missions.</p>
                ) : (
                  pendingApprovals.map((m) => (
                    <div
                      key={m.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/5 bg-slate-900/60 px-3 py-2 text-[11px]"
                    >
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        <span className="font-mono text-slate-300">
                          #{String(m.id).slice(0, 8)}
                        </span>
                        <span className="text-slate-500">
                          Cleaner: {String(m.cleaner_id || '').slice(0, 8)}
                        </span>
                        <span className="text-slate-400">
                          {formatTokens(Number(m.amount_target))}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={adminDeleteLoadingId === m.id}
                        onClick={() => void handleAdminDeleteStuckMission(m)}
                        className={ADMIN_FORCE_RELEASE_PAYMENT_BTN}
                      >
                        {adminDeleteLoadingId === m.id ? 'Processing…' : 'Delete Mission'}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {controlSub === 'missions' && (
            <section className="rounded-2xl border border-cyan-500/20 bg-slate-950 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">
                  Mission control
                </h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void cleanGhostPins()}
                    className={`${SUB_BTN} border-red-500/50 bg-red-500/10 text-red-200`}
                  >
                    Clean Ghost Pins
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadMissionControl()}
                    disabled={missionsLoading}
                    className={`${SUB_BTN} border-cyan-500/40 bg-cyan-500/10 text-cyan-200`}
                  >
                    {missionsLoading ? '…' : 'Refresh'}
                  </button>
                </div>
              </div>
              {missionsError && <p className="mb-2 text-xs text-red-300">{missionsError}</p>}
              <div className="max-h-[28rem] space-y-2 overflow-y-auto">
                {missions.length === 0 ? (
                  <p className="py-6 text-center text-sm italic text-slate-500">No missions.</p>
                ) : (
                  missions.map((m) => (
                    <div
                      key={m.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-cyan-950/20 px-3 py-3"
                    >
                      <div>
                        <p className="font-mono text-sm text-slate-100">#{m.id.slice(0, 8)}</p>
                        <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">
                          {m.status}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void forceCancelMission(m.id)}
                        className={`${SUB_BTN} border-red-500/40 bg-red-500/10 text-red-200`}
                      >
                        Force Cancel
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {controlSub === 'disputes' && (
            <section className="rounded-2xl border border-amber-500/25 bg-slate-950 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">
                  Dispute center
                </h3>
                <button
                  type="button"
                  onClick={() => void loadDisputes()}
                  disabled={disputesLoading}
                  className={`${SUB_BTN} border-amber-500/40 bg-amber-500/10 text-amber-200`}
                >
                  {disputesLoading ? '…' : 'Refresh'}
                </button>
              </div>
              {disputesError && <p className="mb-2 text-xs text-red-300">{disputesError}</p>}
              <div className="space-y-4">
                {disputes.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-2xl border border-white/10 bg-cyan-950/20 p-4"
                  >
                    <p className="font-mono text-[11px] text-slate-200">#{m.id.slice(0, 8)}</p>
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                      {m.status}
                    </p>
                    {m.description && (
                      <p className="mt-2 text-xs text-slate-300">{m.description}</p>
                    )}
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <p className="mb-1 text-[10px] uppercase text-slate-500">Before</p>
                        <div className="grid grid-cols-2 gap-1">
                          {(m.photo_urls || []).slice(0, 2).map((url) => (
                            <div
                              key={url}
                              className="aspect-square overflow-hidden rounded-lg border border-white/10"
                            >
                              <ModeratedMissionPhoto
                                url={url}
                                alt="Before"
                                imgClassName="h-full w-full object-cover"
                                showSafeBadge={false}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="mb-1 text-[10px] uppercase text-slate-500">After</p>
                        <div className="grid grid-cols-2 gap-1">
                          {(m.after_photo_urls || []).slice(0, 2).map((url) => (
                            <div
                              key={url}
                              className="aspect-square overflow-hidden rounded-lg border border-white/10"
                            >
                              <ModeratedMissionPhoto
                                url={url}
                                alt="After"
                                imgClassName="h-full w-full object-cover"
                                showSafeBadge={false}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    {m.ai_verdict && (
                      <p className="mt-2 text-[11px] text-amber-200/90">AI: {m.ai_verdict}</p>
                    )}
                    {m.status !== 'completed' && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void runAiForMission(m)}
                          disabled={aiRunningMissionId === m.id}
                          className={`${SUB_BTN} border-cyan-500/40 bg-cyan-500/10 text-cyan-200`}
                        >
                          {aiRunningMissionId === m.id ? 'AI…' : 'Run AI'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void resolveDispute(m.id, 'approve')}
                          className={`${SUB_BTN} border-emerald-500/40 bg-emerald-500/10 text-emerald-200`}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => void resolveDispute(m.id, 'reject')}
                          className={`${SUB_BTN} border-red-500/40 bg-red-500/10 text-red-200`}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {disputes.length === 0 && (
                  <p className="py-6 text-center text-sm italic text-slate-500">No disputes.</p>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      {/* User detail drawer */}
      {selectedUser && (
        <div
          className="fixed inset-0 z-[160] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setSelectedUser(null)}
        >
          <div
            className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-cyan-500/30 bg-slate-950 p-5 shadow-[0_0_40px_rgba(34,211,238,0.2)] sm:rounded-3xl sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative mb-4">
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="absolute right-0 top-0 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/50 text-slate-300"
                aria-label="Close"
              >
                ✕
              </button>
              <ProfileCard
                accent="cyan"
                name={selectedUser.full_name || selectedUser.id.slice(0, 8)}
                avatarUrl={selectedUser.avatar_url}
                handle={
                  selectedUser.telegram_username
                    ? `@${selectedUser.telegram_username}`
                    : undefined
                }
                isVerified={!!selectedUser.is_verified}
                subtitle={
                  <span className="block truncate">
                    {selectedUser.contact_email || '—'} ·{' '}
                    <span className="text-cyan-300">{selectedUser.phone_number || '—'}</span>
                  </span>
                }
                badges={
                  <>
                    {selectedUser.is_banned && (
                      <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[9px] font-black uppercase text-red-300">
                        Banned
                      </span>
                    )}
                    <span className="rounded-full border border-white/20 bg-white/5 px-2 py-0.5 text-[9px] font-black uppercase text-slate-300">
                      {selectedUser.verification_status ||
                        (selectedUser.is_verified ? 'verified' : 'unverified')}
                    </span>
                  </>
                }
                stats={[
                  {
                    label: 'Tokens',
                    value: formatTokens(Number(selectedUser.token_balance ?? 0)),
                    accent: 'text-lime-300',
                  },
                  {
                    label: 'Subscription',
                    value: selectedPeriod?.active ? 'Active' : 'Expired',
                    accent: selectedPeriod?.active ? 'text-emerald-300' : 'text-amber-300',
                  },
                ]}
                actions={
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        void toggleVerify(selectedUser.id, !selectedUser.is_verified)
                      }
                      disabled={verifyLoadingUserId === selectedUser.id}
                      className="min-w-[7rem] flex-1 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-cyan-200"
                    >
                      {selectedUser.is_verified ? 'Unverify' : 'Verify'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setGrantUser(selectedUser);
                        setGrantTokens('100');
                      }}
                      className="min-w-[7rem] flex-1 rounded-full border border-lime-500/40 bg-lime-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-lime-200"
                    >
                      Bonus Tokens
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleBan(selectedUser.id, !selectedUser.is_banned)}
                      className="min-w-[7rem] flex-1 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-red-200"
                    >
                      {selectedUser.is_banned ? 'Unban' : 'Ban'}
                    </button>
                  </>
                }
              />
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-lime-500/25 bg-lime-500/10 p-3">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-lime-300">
                  Token balance
                </p>
                <p className="mt-1 text-2xl font-black text-lime-100">
                  {formatTokens(Number(selectedUser.token_balance ?? 0))}
                </p>
              </div>

              <div
                className={`rounded-2xl border p-3 ${
                  selectedPeriod?.active
                    ? 'border-emerald-500/30 bg-emerald-500/10'
                    : 'border-amber-500/30 bg-amber-500/10'
                }`}
              >
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-300">
                  Subscription validity
                </p>
                {selectedPeriod ? (
                  <>
                    <p className="mt-1 text-sm font-semibold text-white">
                      Valid from {selectedPeriod.startLabel} until {selectedPeriod.endLabel}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {selectedPeriod.active
                        ? `${selectedPeriod.daysLeft} days remaining · Paid`
                        : 'Expired'}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-slate-400">No subscription on record.</p>
                )}
              </div>

              {selectedUser.store_id && (
                <div className="rounded-2xl border border-violet-500/30 bg-violet-500/10 p-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-300">
                    Published store
                  </p>
                  <p className="mt-1 font-bold text-white">
                    {selectedUser.store_name || 'Contractor store'}
                    {selectedUser.store_published ? (
                      <span className="ml-2 text-[10px] text-emerald-300">LIVE</span>
                    ) : (
                      <span className="ml-2 text-[10px] text-slate-400">DRAFT</span>
                    )}
                  </p>
                  <Link
                    to={`/store/${selectedUser.id}`}
                    className="mt-2 inline-flex rounded-full border border-violet-400/40 bg-violet-500/20 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-violet-100"
                  >
                    Open storefront
                  </Link>
                </div>
              )}

              {(() => {
                const gps = parseFirstGpsTrack(selectedUser.first_gps_track);
                if (!gps || !MAPBOX_TOKEN) return null;
                return (
                  <div className="overflow-hidden rounded-2xl border border-cyan-500/20">
                    <Map
                      mapboxAccessToken={MAPBOX_TOKEN}
                      initialViewState={{
                        latitude: gps.lat,
                        longitude: gps.lng,
                        zoom: 13,
                        pitch: 45,
                      }}
                      style={{ width: '100%', height: 180 }}
                      mapStyle={MAPBOX_STANDARD_STYLE_WITH_CONFIG}
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
                        <div className="h-3.5 w-3.5 rounded-full border-2 border-cyan-400 bg-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.6)]" />
                      </Marker>
                    </Map>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Bonus tokens modal */}
      {grantUser && (
        <div
          className="fixed inset-0 z-[170] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setGrantUser(null)}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-lime-500/30 bg-slate-950 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-sm font-black uppercase tracking-[0.16em] text-lime-300">
              Bonus tokens
            </h4>
            <p className="mt-1 text-xs text-slate-400">
              {grantUser.full_name || grantUser.id.slice(0, 8)} — current{' '}
              {formatTokens(Number(grantUser.token_balance ?? 0))}
            </p>
            <input
              type="number"
              value={grantTokens}
              onChange={(e) => setGrantTokens(e.target.value)}
              className="mt-3 w-full rounded-2xl border border-lime-500/30 bg-black/40 px-3 py-2.5 text-sm text-white outline-none"
              placeholder="e.g. 100 or -10"
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setGrantUser(null)}
                className="flex-1 rounded-full border border-white/15 px-3 py-2 text-[10px] font-black uppercase text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={grantBusy}
                onClick={() => void submitGrantTokens()}
                className="flex-1 rounded-full border border-lime-400/50 bg-lime-500/20 px-3 py-2 text-[10px] font-black uppercase text-lime-100 disabled:opacity-50"
              >
                {grantBusy ? '…' : 'Grant'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
