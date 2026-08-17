/**
 * Donor escrow review: play R2 proof video and first-vote Approve / Reject.
 */
import React, { useEffect, useState } from 'react';
import { Check, Loader2, ShieldAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  fetchProofPlaybackUrl,
  processProofVote,
  proofObjectKeyFromStored,
} from '../src/lib/escrowProofVotes';

export type DonorProofReviewProps = {
  missionId: string;
  proofVideoUrl?: string | null;
  onVoted?: (status: string) => void;
  toast?: { success: (m: string) => void; error: (m: string) => void };
};

const DonorProofReview: React.FC<DonorProofReviewProps> = ({
  missionId,
  proofVideoUrl,
  onVoted,
  toast,
}) => {
  const { t } = useTranslation();
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [loadingVideo, setLoadingVideo] = useState(true);
  const [voting, setVoting] = useState<'approve' | 'reject' | null>(null);

  useEffect(() => {
    let cancelled = false;
    const key = proofObjectKeyFromStored(proofVideoUrl);
    if (!key) {
      setExpired(true);
      setLoadingVideo(false);
      setPlaybackUrl(null);
      return;
    }

    setLoadingVideo(true);
    setExpired(false);
    setPlaybackUrl(null);

    void fetchProofPlaybackUrl({ missionId, objectKey: key })
      .then((url) => {
        if (cancelled) return;
        setPlaybackUrl(url);
        setExpired(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPlaybackUrl(null);
        setExpired(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingVideo(false);
      });

    return () => {
      cancelled = true;
    };
  }, [missionId, proofVideoUrl]);

  const vote = async (isApproved: boolean) => {
    if (voting) return;
    try {
      setVoting(isApproved ? 'approve' : 'reject');
      const result = await processProofVote({ missionId, isApproved });
      toast?.success(
        t('escrowVoteRecorded', { defaultValue: 'Your vote has been recorded.' })
      );
      onVoted?.(result.status);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast?.error(msg || t('escrowVoteFailed', { defaultValue: 'Could not record vote.' }));
    } finally {
      setVoting(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-violet-200">
        {t('escrowDonorReviewTitle', { defaultValue: 'Review worker video' })}
      </p>
      <p className="text-xs text-slate-300">
        {t('escrowDonorReviewHint', {
          defaultValue: 'First donor vote decides this job. Approve to release, or reject as fraud.',
        })}
      </p>

      <div className="overflow-hidden rounded-xl border border-white/15 bg-black/60">
        {loadingVideo ? (
          <div className="flex h-40 items-center justify-center gap-2 text-cyan-200">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            <span className="text-xs font-bold uppercase tracking-[0.14em]">
              {t('loading', { defaultValue: 'Loading…' })}
            </span>
          </div>
        ) : expired || !playbackUrl ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 px-4 text-center">
            <ShieldAlert className="h-6 w-6 text-amber-300" aria-hidden />
            <p className="text-xs font-semibold leading-snug text-amber-100">
              {t('escrowVideoExpired', {
                defaultValue: 'Video expired / unavailable. Storage window is 7 days.',
              })}
            </p>
          </div>
        ) : (
          <video
            src={playbackUrl}
            controls
            playsInline
            className="max-h-56 w-full bg-black"
            onError={() => {
              setExpired(true);
              setPlaybackUrl(null);
            }}
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={!!voting}
          onClick={() => void vote(true)}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-400/60 bg-emerald-500/25 px-4 py-3.5 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-50 hover:bg-emerald-500/40 disabled:cursor-wait disabled:opacity-55"
        >
          {voting === 'approve' ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Check className="h-4 w-4" aria-hidden />
          )}
          {t('escrowApproveCta', { defaultValue: 'Approve work' })}
        </button>
        <button
          type="button"
          disabled={!!voting}
          onClick={() => void vote(false)}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-red-400/60 bg-red-500/20 px-4 py-3.5 text-[11px] font-black uppercase tracking-[0.14em] text-red-100 hover:bg-red-500/35 disabled:cursor-wait disabled:opacity-55"
        >
          {voting === 'reject' ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <X className="h-4 w-4" aria-hidden />
          )}
          {t('escrowRejectCta', { defaultValue: 'Reject (fraud)' })}
        </button>
      </div>
    </div>
  );
};

export default DonorProofReview;
