import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

interface ProfileRow {
  id: string;
  full_name?: string | null;
  telegram_username?: string | null;
  wallet_balance?: number | null;
  contact_email?: string | null;
  phone_number?: string | null;
  created_at?: string | null;
}

interface MissionRow {
  id: string;
  status: string;
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
}

interface AdminDashboardProps {
  onBack: () => void;
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
          .select('id, full_name, telegram_username, contact_email, phone_number, wallet_balance, created_at'),
        supabase.from('missions').select('id, status'),
        supabase
          .from('transactions')
          .select('id, user_id, mission_id, amount, type, created_at')
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

  const filteredProfiles = (profiles || []).filter((p) => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return true;
    const name = (p.full_name || '').toLowerCase();
    const handle = (p.telegram_username || '').toLowerCase();
    const email = (p.contact_email || '').toLowerCase();
    return (
      name.includes(q) ||
      handle.includes(q) ||
      email.includes(q)
    );
  });

  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-6 text-white">
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
              placeholder="Search by name or @username"
              className="mb-2 w-full rounded-2xl bg-slate-950 border border-cyan-500/40 px-3 py-1.5 text-[11px] text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
            />

            <div className="max-h-60 overflow-y-auto space-y-2 pr-1 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
              {filteredProfiles.length === 0 ? (
                <p className="text-slate-500 text-xs italic py-2">No users match this search.</p>
              ) : (
                filteredProfiles.map((p) => {
                  const name = p.full_name || '—';
                  const handle = p.telegram_username ? `(@${p.telegram_username})` : '';
                  const email = p.contact_email || '—';
                  const phone = p.phone_number || '';
                  return (
                    <div
                      key={p.id}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 rounded-xl bg-slate-950/70 border border-cyan-500/20 px-3 py-2 text-[11px]"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-200 truncate">
                          {name}{' '}
                          <span className="text-slate-500">{handle}</span>
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">
                          {email}
                        </p>
                        {phone && (
                          <p className="text-[10px] text-cyan-400 mt-0.5 truncate">
                            WhatsApp: {phone}
                          </p>
                        )}
                      </div>
                      <div className="sm:text-right">
                        <p className="text-[10px] text-slate-500">
                          Balance
                        </p>
                        <p className="font-bold text-orange-400">
                          ${Number(p.wallet_balance ?? 0).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
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
    </div>
  );
};

export default AdminDashboard;
