import { supabase } from '../../services/supabase';
import { APP_EVENT_MISSION_DELETED } from './brand';

export async function adminDeleteMission(missionId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_mission', {
    p_mission_id: missionId,
  });
  if (error) throw error;
  window.dispatchEvent(
    new CustomEvent(APP_EVENT_MISSION_DELETED, { detail: { missionId } })
  );
}
