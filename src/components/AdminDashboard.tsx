import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

interface ProfileRow {
  id: string;
  full_name?: string | null;
  telegram_username?: string | null;
  wallet_balance?: number | null;
}

interface MissionRow {
  id: string;
  status: string;
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      setError(null);
      try {
        const [profRes, missRes, txRes] = await Promise.all([
          supabase.from('profiles').select('id, full_name, telegram_username, wallet_balance'),
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
      } catch (e: any) {
        console.error('Admin fetch error:', e);
        setError(e?.message || 'Failed to load admin data.');
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);

  const activeCount = missions.filter((m) =>
    ['available', 'in_progress'].includes(m.status)
  ).length;
  const completedCount = missions.filter((m) => m.status === 'completed').length;

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

          {/* User Directory */}
          <section className="rounded-2xl bg-black/40 border border-amber-500/30 p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-3">
              User Directory
            </h3>
            <div className="max-h-48 overflow-y-auto space-y-2 pr-1 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
              {(profiles || []).map((p) => (
                <div
                  key={p.id}
                  className="flex justify-between items-center rounded-xl bg-slate-900/60 border border-white/5 px-3 py-2 text-xs"
                >
                  <div>
                    <p className="font-semibold text-slate-200">
                      {p.full_name || '—'}
                    </p>
                    <p className="text-slate-500 text-[10px]">
                      @{p.telegram_username || 'n/a'}
                    </p>
                  </div>
                  <p className="font-bold text-emerald-400">
                    ${Number(p.wallet_balance ?? 0).toFixed(2)}
                  </p>
                </div>
              ))}
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
