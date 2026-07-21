/**
 * Public creator profile at /profile/:id — minimal, read-only card reached by
 * tapping a creator avatar on a mission card. Uses the get_public_profile RPC.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, BadgeCheck, Star } from 'lucide-react';
import { supabase } from '../services/supabase';

interface PublicProfileData {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  is_verified: boolean | null;
  rating: number | null;
  missions_created: number | null;
  missions_completed: number | null;
}

const PublicProfile: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [profile, setProfile] = useState<PublicProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
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
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, t]);

  const initial = (profile?.full_name || '?').trim().charAt(0).toUpperCase() || '?';

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
                  {profile.is_verified && (
                    <BadgeCheck className="h-5 w-5 shrink-0 text-cyan-400" strokeWidth={2.25} />
                  )}
                </div>
                {typeof profile.rating === 'number' && !Number.isNaN(profile.rating) && (
                  <p className="mt-1 inline-flex items-center gap-1 text-sm font-bold text-amber-300">
                    <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                    {Number(profile.rating).toFixed(1)}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center">
                <p className="text-2xl font-black text-emerald-300">
                  {profile.missions_created ?? 0}
                </p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  {t('publicProfileMissionsCreated')}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center">
                <p className="text-2xl font-black text-cyan-300">
                  {profile.missions_completed ?? 0}
                </p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  {t('publicProfileMissionsCompleted')}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PublicProfile;
