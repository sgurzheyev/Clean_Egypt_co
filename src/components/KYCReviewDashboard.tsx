import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../services/supabase';
import { createKycAdminSignedUrls, kycDocTypeLabel } from '../lib/kycDocuments';

export type PendingKycProfile = {
  id: string;
  full_name?: string | null;
  telegram_username?: string | null;
  contact_email?: string | null;
  phone_number?: string | null;
  verification_document_type?: string | null;
  verification_photo_front?: string | null;
  verification_photo_back?: string | null;
  verification_liveness_video?: string | null;
  avatar_url?: string | null;
};

type KycMediaUrls = {
  front: string | null;
  back: string | null;
  liveness: string | null;
};

type KYCReviewDashboardProps = {
  /** Parent AdminDashboard already gates access; this is a second guard. */
  isAllowedAdmin: boolean;
};

const KYCReviewDashboard: React.FC<KYCReviewDashboardProps> = ({ isAllowedAdmin }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingKycProfile[]>([]);
  const [mediaByUserId, setMediaByUserId] = useState<Record<string, KycMediaUrls>>({});
  const [mediaLoadingId, setMediaLoadingId] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PendingKycProfile | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const loadPending = useCallback(async () => {
    if (!isAllowedAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('list_pending_kyc_profiles');
      if (rpcErr) throw rpcErr;
      setPending((data || []) as PendingKycProfile[]);
      setMediaByUserId({});
    } catch (e: any) {
      console.error('list_pending_kyc_profiles', e);
      setError(e?.message || 'Failed to load pending KYC applications.');
      setPending([]);
    } finally {
      setLoading(false);
    }
  }, [isAllowedAdmin]);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  const loadMediaForUser = async (row: PendingKycProfile) => {
    if (mediaByUserId[row.id]) return;
    setMediaLoadingId(row.id);
    try {
      const urls = await createKycAdminSignedUrls([
        row.verification_photo_front,
        row.verification_photo_back,
        row.verification_liveness_video,
      ]);
      const frontPath = String(row.verification_photo_front ?? '').trim();
      const backPath = String(row.verification_photo_back ?? '').trim();
      const livePath = String(row.verification_liveness_video ?? '').trim();
      setMediaByUserId((prev) => ({
        ...prev,
        [row.id]: {
          front: frontPath ? urls[frontPath] ?? null : null,
          back: backPath ? urls[backPath] ?? null : null,
          liveness: livePath ? urls[livePath] ?? null : null,
        },
      }));
    } catch (e: any) {
      console.error('loadMediaForUser', e);
      alert(e?.message || 'Failed to load KYC media (signed URLs).');
    } finally {
      setMediaLoadingId(null);
    }
  };

  const handleApprove = async (row: PendingKycProfile) => {
    if (!window.confirm(`Approve KYC for ${row.full_name || row.id.slice(0, 8)}?`)) return;
    setActionLoadingId(row.id);
    try {
      const { error: rpcErr } = await supabase.rpc('moderate_kyc_verification', {
        p_user_id: row.id,
        p_decision: 'approve',
        p_rejection_reason: null,
      });
      if (rpcErr) throw rpcErr;
      setPending((prev) => prev.filter((p) => p.id !== row.id));
      setMediaByUserId((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
    } catch (e: any) {
      alert(e?.message || 'Failed to approve KYC.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const submitReject = async () => {
    if (!rejectTarget) return;
    setActionLoadingId(rejectTarget.id);
    try {
      const { error: rpcErr } = await supabase.rpc('moderate_kyc_verification', {
        p_user_id: rejectTarget.id,
        p_decision: 'reject',
        p_rejection_reason: rejectReason.trim() || null,
      });
      if (rpcErr) throw rpcErr;
      setPending((prev) => prev.filter((p) => p.id !== rejectTarget.id));
      setMediaByUserId((prev) => {
        const next = { ...prev };
        delete next[rejectTarget.id];
        return next;
      });
      setRejectTarget(null);
      setRejectReason('');
    } catch (e: any) {
      alert(e?.message || 'Failed to reject KYC.');
    } finally {
      setActionLoadingId(null);
    }
  };

  if (!isAllowedAdmin) {
    return (
      <section className="rounded-2xl bg-slate-950 border border-red-500/30 p-6">
        <p className="text-sm text-red-300">Admin access required.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-slate-950 border border-cyan-500/25 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300/90">
            KYC Review Queue
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            Pending identity verification — documents in Cloudflare R2 (
            <span className="font-mono text-cyan-400/80">kyc/</span>
            ), legacy Storage supported.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadPending()}
          disabled={loading}
          className="px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.16em] border border-cyan-400/35 text-cyan-100 bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-60 transition-all"
        >
          {loading ? '…' : 'Refresh'}
        </button>
      </div>

      {error && <p className="mb-3 text-xs text-red-300">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 border-2 border-cyan-500/60 border-t-cyan-300 rounded-full animate-spin" />
        </div>
      ) : pending.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500 italic">No pending KYC applications.</p>
      ) : (
        <div className="space-y-4 max-h-[min(70vh,720px)] overflow-y-auto pr-1 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
          {pending.map((row) => {
            const media = mediaByUserId[row.id];
            const isExpanded = !!media;
            const busy = actionLoadingId === row.id || mediaLoadingId === row.id;
            const name =
              row.full_name?.trim() ||
              row.contact_email?.trim() ||
              row.telegram_username?.trim() ||
              'Unknown worker';
            const handle = row.telegram_username ? `@${row.telegram_username.replace(/^@/, '')}` : '';

            return (
              <article
                key={row.id}
                className="rounded-2xl border border-white/10 bg-black/30 p-4 backdrop-blur-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full border border-cyan-400/25 bg-slate-900">
                      {row.avatar_url ? (
                        <img src={row.avatar_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-sm font-black text-cyan-300">
                          {name.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-white truncate">
                        {name}{' '}
                        {handle ? <span className="text-slate-500 font-normal">{handle}</span> : null}
                      </p>
                      <p className="text-[10px] font-mono text-slate-500">{row.id.slice(0, 8)}…</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {row.contact_email || '—'} · {row.phone_number || '—'}
                      </p>
                      <p className="mt-1 text-[11px] text-cyan-200/90">
                        Document:{' '}
                        <span className="font-semibold">
                          {kycDocTypeLabel(row.verification_document_type)}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
                    {!isExpanded && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void loadMediaForUser(row)}
                        className="w-full sm:w-auto px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.14em] border border-white/15 text-slate-200 bg-white/5 hover:bg-white/10 disabled:opacity-60"
                      >
                        {mediaLoadingId === row.id ? 'Loading…' : 'Load documents'}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleApprove(row)}
                      className="w-full sm:w-auto px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.14em] border border-emerald-400/40 text-emerald-100 bg-emerald-500/15 hover:bg-emerald-500/25 disabled:opacity-60"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setRejectTarget(row);
                        setRejectReason('');
                      }}
                      className="w-full sm:w-auto px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.14em] border border-red-400/40 text-red-100 bg-red-500/15 hover:bg-red-500/25 disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-white/10 bg-black/40 p-2">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        Front
                      </p>
                      {media?.front ? (
                        <a href={media.front} target="_blank" rel="noopener noreferrer">
                          <img
                            src={media.front}
                            alt="Document front"
                            className="max-h-48 w-full rounded-lg object-contain bg-black/50"
                          />
                        </a>
                      ) : (
                        <p className="text-xs text-slate-500 italic py-6 text-center">Unavailable</p>
                      )}
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/40 p-2">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        Back
                      </p>
                      {media?.back ? (
                        <a href={media.back} target="_blank" rel="noopener noreferrer">
                          <img
                            src={media.back}
                            alt="Document back"
                            className="max-h-48 w-full rounded-lg object-contain bg-black/50"
                          />
                        </a>
                      ) : (
                        <p className="text-xs text-slate-500 italic py-6 text-center">Not uploaded</p>
                      )}
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/40 p-2">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        Liveness
                      </p>
                      {media?.liveness ? (
                        <video
                          src={media.liveness}
                          controls
                          playsInline
                          className="max-h-48 w-full rounded-lg bg-black/50"
                        />
                      ) : (
                        <p className="text-xs text-slate-500 italic py-6 text-center">Unavailable</p>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {rejectTarget && (
        <div
          className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/75 backdrop-blur-sm px-4"
          onClick={() => !actionLoadingId && setRejectTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-red-500/30 bg-slate-950 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-black text-white mb-1">Reject KYC</p>
            <p className="text-xs text-slate-400 mb-4">
              {rejectTarget.full_name || rejectTarget.id.slice(0, 8)} — optional reason shown internally.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Reason (optional)"
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500/30"
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={!!actionLoadingId}
                onClick={() => setRejectTarget(null)}
                className="flex-1 py-2.5 rounded-full border border-white/15 text-slate-300 text-[11px] font-bold uppercase tracking-[0.12em] hover:bg-white/5 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!!actionLoadingId}
                onClick={() => void submitReject()}
                className="flex-1 py-2.5 rounded-full border border-red-400/40 bg-red-500/15 text-red-100 text-[11px] font-black uppercase tracking-[0.12em] hover:bg-red-500/25 disabled:opacity-60"
              >
                {actionLoadingId ? '…' : 'Confirm reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default KYCReviewDashboard;
