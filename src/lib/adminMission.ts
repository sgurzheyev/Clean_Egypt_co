import { supabase } from '../../services/supabase';

export async function adminDeleteMission(missionId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_mission', {
    p_mission_id: missionId,
  });
  if (error) throw error;
  window.dispatchEvent(
    new CustomEvent('cleanegypt:mission-deleted', { detail: { missionId } })
  );
}
