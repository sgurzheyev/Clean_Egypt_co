import { supabase } from '../../services/supabase';
import { APP_EVENT_MISSION_DELETED } from './brand';

function rpcErrorMessage(
  error: { message?: string; details?: string; hint?: string; code?: string },
  fallback: string
): string {
  const parts = [error.message, error.details, error.hint].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0
  );
  if (parts.length) return parts.join(' — ');
  if (error.code) return `${fallback} (${error.code})`;
  return fallback;
}

/** Soft-hide (or unhide). Public feeds drop hidden rows via RLS. */
export async function adminHideMission(missionId: string, hidden = true): Promise<void> {
  const { error } = await supabase.rpc('admin_set_mission_hidden', {
    p_mission_id: missionId,
    p_hidden: hidden,
  });
  if (error) {
    throw new Error(rpcErrorMessage(error, hidden ? 'Failed to hide mission' : 'Failed to unhide mission'));
  }
  if (hidden) {
    window.dispatchEvent(
      new CustomEvent(APP_EVENT_MISSION_DELETED, { detail: { missionId } })
    );
  }
}

/** Profile / map admin action. Hides the mission; it does not hard-delete. */
export async function adminDeleteMission(missionId: string): Promise<void> {
  await adminHideMission(missionId, true);
}
