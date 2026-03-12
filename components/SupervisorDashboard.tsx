import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

interface Mission {
  id: string;
  creator_id: string | null;
  cleaner_id: string | null;
  category: 'public' | 'home' | 'office' | string;
  amount_target: number;
  location_lat?: number | null;
  location_lng?: number | null;
  status: string;
  description?: string | null;
  created_at: string;
  started_at?: string | null;
  photo_urls?: string[] | null;
  after_photo_urls?: string[] | null;
  is_disputed?: boolean | null;
}

interface ProfileRow {
  id: string;
  is_supervisor?: boolean | null;
}

const SupervisorDashboard: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [authChecking, setAuthChecking] = useState(true);
  const [isSupervisor, setIsSupervisor] = useState(false);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const loadSupervisorFlag = useCallback(async () => {
    setAuthChecking(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        setIsSupervisor(false);
        return;
      }
      const userId = session.user.id;
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, is_supervisor')
        .eq('id', userId)
        .maybeSingle();
      const row = profile as ProfileRow | null;
      setIsSupervisor(!!row?.is_supervisor);
    } catch (e) {
      console.error('Failed to load supervisor flag', e);
      setIsSupervisor(false);
    } finally {
      setAuthChecking(false);
    }
  }, []);

  const fetchMissions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: missionsError } = await supabase
        .from('missions')
        .select(
          'id, creator_id, cleaner_id, category, amount_target, location_lat, location_lng, status, description, created_at, started_at, photo_urls, after_photo_urls, is_disputed'
        )
        .in('status', ['pending_verification', 'disputed'])
        .order('created_at', { ascending: false });

      if (missionsError) {
        throw missionsError;
      }

      setMissions((data || []) as Mission[]);
    } catch (e: any) {
      console.error('Failed to load missions for supervisor dashboard', e);
      setError(e?.message || 'Failed to load missions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSupervisorFlag();
  }, [loadSupervisorFlag]);

  useEffect(() => {
    if (!authChecking && isSupervisor) {
      fetchMissions();
    }
  }, [authChecking, isSupervisor, fetchMissions]);

  const handleResolveMission = async (mission: Mission, decision: 'approve' | 'reject') => {
    if (actionLoadingId) return;
    let supervisorComment: string | undefined;

    if (decision === 'approve') {
      const confirmApprove = window.confirm('Approve this cleanup and release payment?');
      if (!confirmApprove) return;
    } else {
      supervisorComment = window.prompt(
        'Please provide a brief reason for rejection (e.g., "Trash just moved, not removed").'
      ) || undefined;
      if (!supervisorComment || !supervisorComment.trim()) {
        alert('Rejection requires a comment.');
        return;
      }
    }

    try {
      setActionLoadingId(mission.id);
      const { error } = await supabase.rpc('resolve_mission_dispute', {
        mission_id: mission.id,
        decision,
        supervisor_comment: supervisorComment ?? null,
      });
      if (error) {
        console.error('resolve_mission_dispute error:', error.message);
        alert(error.message || 'Failed to resolve mission.');
        return;
      }
      await fetchMissions();
    } catch (e: any) {
      console.error('resolve_mission_dispute exception:', e);
      alert(e?.message || 'Failed to resolve mission.');
    } finally {
      setActionLoadingId(null);
    }
  };

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-300">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Checking permissions...</p>
      </div>
    );
  }

  if (!isSupervisor) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-300">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
          Supervisor access required to view this dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white px-4 py-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Supervisor Dashboard</h1>
            <p className="text-[11px] text-slate-400 uppercase tracking-[0.18em] mt-1">
              Review missions flagged for verification or disputes
            </p>
          </div>
        </header>

        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-3 text-xs text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-xs text-slate-500 uppercase tracking-[0.2em]">Loading missions...</p>
        ) : missions.length === 0 ? (
          <p className="text-sm text-slate-400">No missions require supervisor attention right now.</p>
        ) : (
          <div className="space-y-4">
            {missions.map((mission) => {
              const beforePhotos = mission.photo_urls || [];
              const afterPhotos = mission.after_photo_urls || [];
              const isCity = mission.category === 'public';

              return (
                <div
                  key={mission.id}
                  className="rounded-2xl border border-white/10 bg-black/60 backdrop-blur-xl p-4 space-y-4"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1">
                        {isCity ? 'City Cleaning' : 'Home Cleaning'}
                      </p>
                      <p className="text-sm text-slate-300">
                        #{mission.id.slice(0, 8)} · EGP {mission.amount_target}
                      </p>
                      {mission.location_lat != null && mission.location_lng != null && (
                        <p className="text-[11px] text-slate-500 font-mono mt-1">
                          {mission.location_lat.toFixed(5)}, {mission.location_lng.toFixed(5)}
                        </p>
                      )}
                      {mission.description && (
                        <p className="text-xs text-slate-400 mt-2 max-w-xl">{mission.description}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <span
                        className={`inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.18em] ${
                          mission.status === 'disputed'
                            ? 'bg-red-500/10 text-red-300 border border-red-500/40'
                            : 'bg-amber-500/10 text-amber-300 border border-amber-500/40'
                        }`}
                      >
                        {mission.status === 'disputed' ? 'Disputed' : 'Pending Verification'}
                      </span>
                    </div>
                  </div>

                  {photos.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
                          Before Photos
                        </p>
                        {beforePhotos.length === 0 ? (
                          <p className="text-[11px] text-slate-500">No explicit before photos captured.</p>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            {beforePhotos.map((url, idx) => (
                              <div
                                key={`${mission.id}-before-${idx}`}
                                className="aspect-square rounded-lg overflow-hidden border border-white/10 bg-slate-900"
                              >
                                <img
                                  src={url}
                                  alt="Before"
                                  className="h-full w-full object-cover"
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
                          After Photos
                        </p>
                        {afterPhotos.length === 0 ? (
                          <p className="text-[11px] text-slate-500">No explicit after photos captured.</p>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            {afterPhotos.map((url, idx) => (
                              <div
                                key={`${mission.id}-after-${idx}`}
                                className="aspect-square rounded-lg overflow-hidden border border-white/10 bg-slate-900"
                              >
                                <img
                                  src={url}
                                  alt="After"
                                  className="h-full w-full object-cover"
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-3 sm:justify-end pt-2">
                    <button
                      type="button"
                      onClick={() => handleResolveMission(mission, 'approve')}
                      disabled={actionLoadingId === mission.id}
                      className="inline-flex justify-center items-center px-4 py-2 rounded-full text-xs font-bold uppercase tracking-[0.2em] bg-emerald-500 text-black hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-wait"
                    >
                      {actionLoadingId === mission.id ? 'Processing...' : 'Approve Cleanup'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResolveMission(mission, 'reject')}
                      disabled={actionLoadingId === mission.id}
                      className="inline-flex justify-center items-center px-4 py-2 rounded-full text-xs font-bold uppercase tracking-[0.2em] bg-red-500 text-white hover:bg-red-400 disabled:opacity-60 disabled:cursor-wait"
                    >
                      {actionLoadingId === mission.id ? 'Processing...' : 'Reject (Issue Penalty)'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SupervisorDashboard;

