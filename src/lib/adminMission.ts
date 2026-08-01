import { supabase } from '../../services/supabase';
import { APP_EVENT_MISSION_DELETED } from './brand';

function rpcErrorMessage(error: { message?: string; details?: string; hint?: string; code?: string }): string {
  const parts = [error.message, error.details, error.hint].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0
  );
  if (parts.length) return parts.join(' — ');
  if (error.code) return `Delete failed (${error.code})`;
  return 'Failed to delete mission';
}

export async function adminDeleteMission(missionId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_mission', {
    p_mission_id: missionId,
  });
  if (error) {
    throw new Error(rpcErrorMessage(error));
  }
  window.dispatchEvent(
    new CustomEvent(APP_EVENT_MISSION_DELETED, { detail: { missionId } })
  );
}
