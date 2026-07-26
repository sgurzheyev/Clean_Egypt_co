/**
 * Public creator profile at /profile/:id — read-only card from mission avatars.
 * Phone is never in get_public_profile; unlocked only via get_client_phone_if_contracted
 * when the viewer has an accepted/assigned private mission with this client.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, BadgeCheck, Calendar, ShieldCheck, Star } from 'lucide-react';
import { supabase } from '../services/supabase';
import { getProfileReviews, type ProfileReviewRow } from '../src/lib/reviews';
import { formatSubmittedRelative } from '../src/lib/missionFilterSort';
import {
  getClientPhoneIfContracted,
  toTelHref,
  toWhatsAppHref,
} from '../src/lib/missionContact';
import PublicStoreCard from './PublicStoreCard';

interface PublicProfileData {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  is_verified: boolean | null;
  verification_status?: string | null;
  rating: number | null;
  review_count: number | null;
  missions_created: number | null;
  missions_completed: number | null;
  member_since?: string | null;
}

function formatMemberSince(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(locale || 'en', {
      month: 'long',
      year: 'numeric',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 7);
  }
}

function verificationLabel(
  profile: PublicProfileData,
  t: (key: string, opts?: Record<string, string>) => string
): string {
  const status = String(profile.verification_status || '').toLowerCase();
  if (profile.is_verified || status === 'verified' || status === 'approved') {
    return t('publicProfileVerified', { defaultValue: 'ID verified' });
  }
  if (status === 'pending' || status === 'submitted') {
    return t('publicProfileVerificationPending', { defaultValue: 'Verification pending' });
  }
  return t('publicProfileUnverified', { defaultValue: 'Not ID-verified' });
}

const PublicProfile: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [profile, setProfile] = useState<PublicProfileData | null>(null);
  const [reviews, setReviews] = useState<ProfileReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contractPhone, setContractPhone] = useState<string | null>(null);
  const [phoneChecked, setPhoneChecked] = useState(false);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setError(t('publicProfileNotFound'));
      setProfile(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContractPhone(null);
    setPhoneChecked(false);
    (async () => {
      const { data, error: rpcErr } = await supabase.rpc('get_public_profile', { p_id: id });
      if (cancelled) return;
      if (rpcErr) {
        setError(rpcErr.message || t('publicProfileLoadFailed'));
        setProfile(null);
      } else {
        const row = Array.isArray(data) ? data[0] : data;
        setProfile((row as PublicProfileData) ?? null);
      }
      try {
        const rows = await getProfileReviews(id, 15);
        if (!cancelled) setReviews(rows);
      } catch (err) {
        console.warn('getProfileReviews failed:', err);
      }

      // Phase 3: only returns a phone when viewer has an accepted/assigned private contract.
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.user?.id && session.user.id !== id) {
          const phone = await getClientPhoneIfContracted(id);
          if (!cancelled) setContractPhone(phone);
        }
      } catch (err) {
        console.warn('get_client_phone_if_contracted failed:', err);
        if (!cancelled) setContractPhone(null);
      } finally {
        if (!cancelled) setPhoneChecked(true);
      }

      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, t]);

  const initial = (profile?.full_name || '?').trim().charAt(0).toUpperCase() || '?';
  const memberSinceLabel = formatMemberSince(profile?.member_since, i18n.language);
  const telHref = useMemo(() => toTelHref(contractPhone), [contractPhone]);
  const whatsappHref = useMemo(() => toWhatsAppHref(contractPhone), [contractPhone]);
  const created = Math.max(0, Number(profile?.missions_created ?? 0));
  const completed = Math.max(0, Number(profile?.missions_completed ?? 0));
  const completionRate = created > 0 ? Math.min(100, Math.round((completed / created) * 100)) : 0;
  const isVerified =
    !!profile?.is_verified ||
    ['verified', 'approved'].includes(String(profile?.verification_status || '').toLowerCase());

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-xl flex-col px-4 pb-16 pt-6">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="mb-6 inline-flex items-center gap-1.5 self-start rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-slate-300 transition-colors hover:bg-white/10"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
          {t('backToMap')}
        </button>

        {loading ? (
          <p className="py-16 text-center text-sm text-slate-400">{t('loading')}</p>
        ) : error ? (
          <p className="py-16 text-center text-sm text-red-300">{error}</p>
        ) : !profile ? (
          <p className="py-16 text-center text-sm text-slate-400">{t('publicProfileNotFound')}</p>
        ) : (
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-[0_4px_30px_rgba(6,182,212,0.08)] backdrop-blur-md">
            <div className="flex items-center gap-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-emerald-300/50 bg-slate-800">
                {profile.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt=""
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <span className="text-3xl font-black uppercase text-emerald-200">{initial}</span>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-xl font-black text-white">
                    {profile.full_name || t('publicProfileAnonymous')}
                  </h1>
                  {isVerified && (
                    <BadgeCheck className="h-5 w-5 shrink-0 text-cyan-400" strokeWidth={2.25} />
                  )}
                </div>
                {typeof profile.rating === 'number' && !Number.isNaN(profile.rating) ? (
                  <p className="mt-1 inline-flex items-center gap-1 text-sm font-bold text-amber-300">
                    <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                    {Number(profile.rating).toFixed(1)}
                    <span className="text-xs font-medium text-slate-400">
                      ({profile.review_count ?? 0})
                    </span>
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">{t('publicProfileNoRating')}</p>
                )}
                {memberSinceLabel && (
                  <p className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                    <Calendar className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                    {t('publicProfileMemberSince', {
                      date: memberSinceLabel,
                      defaultValue: `Member since ${memberSinceLabel}`,
                    })}
                  </p>
                )}
              </div>
            </div>

            {/* Contract contact unlock — authenticated viewers only; phone only if contracted */}
            {phoneChecked && (
              <div className="mt-5 space-y-3">
                {contractPhone ? (
                  <div className="flex gap-2">
                    {telHref ? (
                      <a
                        href={telHref}
                        className="flex min-h-[52px] flex-1 items-center justify-center gap-1.5 rounded-2xl border border-emerald-400/40 bg-emerald-600/90 px-3 text-[11px] font-black uppercase tracking-[0.14em] text-white shadow-[0_4px_20px_rgba(16,185,129,0.3)]"
                      >
                        <span aria-hidden>📞</span>
                        {t('callClient')}
                      </a>
                    ) : null}
                    {whatsappHref ? (
                      <a
                        href={whatsappHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-h-[52px] flex-1 items-center justify-center gap-1.5 rounded-2xl border border-cyan-400/40 bg-cyan-600/90 px-3 text-[11px] font-black uppercase tracking-[0.14em] text-white shadow-[0_4px_20px_rgba(34,211,238,0.3)]"
                      >
                        <span aria-hidden>💬</span>
                        WhatsApp
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}

            <div className="mt-5 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <ShieldCheck
                className={`h-5 w-5 shrink-0 ${isVerified ? 'text-cyan-400' : 'text-slate-500'}`}
                strokeWidth={2}
              />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                  {t('publicProfileVerification', { defaultValue: 'Verification' })}
                </p>
                <p className={`text-sm font-bold ${isVerified ? 'text-cyan-200' : 'text-slate-300'}`}>
                  {verificationLabel(profile, t)}
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-center">
                <p className="text-2xl font-black text-emerald-300">{created}</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  {t('publicProfileMissionsCreated')}
                </p>
              </div>
              <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-4 text-center">
                <p className="text-2xl font-black text-cyan-300">{completed}</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  {t('publicProfileMissionsCompleted')}
                </p>
              </div>
            </div>
            {created > 0 && (
              <div className="mt-3">
                <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  <span>{t('publicProfileCompletionRate', { defaultValue: 'Completion rate' })}</span>
                  <span className="text-emerald-300">{completionRate}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400"
                    style={{ width: `${completionRate}%` }}
                  />
                </div>
              </div>
            )}

            {/* Contractor storefront — only renders when a published store exists */}
            {profile.id && <PublicStoreCard ownerId={profile.id} requirePublished />}

            <div className="mt-6">
              <h2 className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                {t('reviewsTitle', { defaultValue: 'Reviews' })}
              </h2>
              {reviews.length === 0 ? (
                <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-xs text-slate-500">
                  {t('reviewsEmpty', { defaultValue: 'No reviews yet.' })}
                </p>
              ) : (
                <div className="space-y-3">
                  {reviews.map((r) => {
                    const reviewerLabel =
                      (r.reviewer_name || '').trim() ||
                      t('reviewClientFallback', { defaultValue: 'Client' });
                    const revInitial = reviewerLabel.charAt(0).toUpperCase() || '?';
                    const reviewDate = (() => {
                      const d = new Date(r.created_at);
                      if (!Number.isFinite(d.getTime())) {
                        return formatSubmittedRelative(r.created_at, i18n.language);
                      }
                      try {
                        return new Intl.DateTimeFormat(i18n.language || 'en', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        }).format(d);
                      } catch {
                        return formatSubmittedRelative(r.created_at, i18n.language);
                      }
                    })();
                    return (
                      <div
                        key={r.id}
                        className="rounded-2xl border border-white/10 bg-white/5 p-4"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-slate-800">
                            {r.reviewer_avatar ? (
                              <img
                                src={r.reviewer_avatar}
                                alt=""
                                className="h-full w-full object-cover"
                                draggable={false}
                              />
                            ) : (
                              <span className="text-xs font-black uppercase text-emerald-200">
                                {revInitial}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-slate-100">
                              {reviewerLabel}
                            </p>
                            <p className="text-[10px] uppercase tracking-[0.1em] text-slate-500">
                              {reviewDate}
                            </p>
                          </div>
                          <div
                            className="flex shrink-0 items-center gap-0.5"
                            aria-label={`${r.rating} / 5`}
                          >
                            {[1, 2, 3, 4, 5].map((s) => (
                              <Star
                                key={s}
                                className={`h-3.5 w-3.5 ${
                                  s <= r.rating
                                    ? 'fill-amber-400 text-amber-400'
                                    : 'text-slate-600'
                                }`}
                                strokeWidth={1.75}
                              />
                            ))}
                          </div>
                        </div>
                        {r.comment?.trim() ? (
                          <p className="mt-2.5 text-sm leading-relaxed text-slate-200">
                            {r.comment.trim()}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PublicProfile;
