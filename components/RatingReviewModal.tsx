/**
 * Post-completion rating + short review modal. Used by both sides
 * (creator rating worker, worker rating creator).
 */
import React, { useEffect, useState } from 'react';
import { Star, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { submitReview } from '../src/lib/reviews';

export interface RatingTarget {
  missionId: string;
  revieweeId: string;
  /** Who is being rated — drives the modal heading. */
  role: 'worker' | 'creator';
  /** Mission assigned worker (required when role is creator / legacy cleaner_id). */
  cleanerId?: string | null;
}

interface RatingReviewModalProps {
  target: RatingTarget | null;
  onClose: () => void;
  onSubmitted?: () => void;
  toast?: { success: (m: string) => void; error: (m: string) => void };
}

const RatingReviewModal: React.FC<RatingReviewModalProps> = ({
  target,
  onClose,
  onSubmitted,
  toast,
}) => {
  const { t } = useTranslation();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (target) {
      setRating(0);
      setHover(0);
      setComment('');
      setSubmitting(false);
    }
  }, [target]);

  if (!target) return null;

  const heading =
    target.role === 'worker'
      ? t('rateWorkerTitle', { defaultValue: 'Rate the worker' })
      : t('rateCreatorTitle', { defaultValue: 'Rate the client' });

  const handleSubmit = async () => {
    if (rating < 1 || rating > 5) {
      toast?.error(t('mapToastRatingRange'));
      return;
    }
    try {
      setSubmitting(true);
      await submitReview({
        missionId: target.missionId,
        revieweeId: target.revieweeId,
        rating,
        comment,
        cleanerId: target.role === 'worker' ? target.revieweeId : target.cleanerId,
      });
      toast?.success(
        t('reviewSubmittedSuccess', {
          defaultValue: 'Review submitted successfully!',
        })
      );
      onSubmitted?.();
      onClose();
    } catch (err: any) {
      toast?.error(err?.message || t('mapToastRatingSubmitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const shown = hover || rating;

  return (
    <div
      className="fixed inset-0 z-[10070] flex items-end justify-center bg-black/80 p-0 backdrop-blur-md sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl border border-amber-400/25 bg-slate-950/95 p-6 shadow-[0_-12px_40px_rgba(0,0,0,0.5)] sm:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black uppercase tracking-[0.12em] text-amber-300">{heading}</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/5 text-slate-300 hover:text-white"
            aria-label={t('close')}
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>

        <p className="mb-3 text-[11px] text-slate-400">{t('ratingHelpsReward')}</p>

        <div className="mb-4 flex items-center justify-center gap-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              disabled={submitting}
              onMouseEnter={() => setHover(star)}
              onMouseLeave={() => setHover(0)}
              onClick={() => setRating(star)}
              className="transition-transform hover:scale-110 active:scale-95"
              aria-label={`${star}`}
            >
              <Star
                className={`h-9 w-9 ${
                  star <= shown ? 'fill-amber-400 text-amber-400' : 'text-slate-600'
                }`}
                strokeWidth={1.75}
              />
            </button>
          ))}
        </div>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={1000}
          rows={3}
          placeholder={t('reviewCommentPlaceholder', {
            defaultValue: 'Leave a short comment (optional)',
          })}
          className="w-full resize-none rounded-xl border border-white/12 bg-slate-900/80 px-3 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-amber-400/50"
        />

        <button
          type="button"
          disabled={submitting || rating < 1}
          onClick={() => void handleSubmit()}
          className="mt-4 w-full rounded-full bg-amber-500 py-3 text-[12px] font-black uppercase tracking-[0.18em] text-black transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? t('submitting') : t('submitRating')}
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={onClose}
          className="mt-2 w-full rounded-full border border-white/10 py-2.5 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400 hover:text-slate-200 disabled:opacity-50"
        >
          {t('reviewSkip', { defaultValue: 'Skip' })}
        </button>
      </div>
    </div>
  );
};

export default RatingReviewModal;
