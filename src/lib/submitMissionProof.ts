import { supabase } from '../../services/supabase';

/** Worker submits proof — secure in_progress → review (no wallet mutation). */
export async function submitMissionProof(input: {
  missionId: string;
  afterPhotoUrls: string[];
  completionLat?: number | null;
  completionLng?: number | null;
  completionDistanceMeters?: number | null;
  proofVideoUrl?: string | null;
  livenessLat?: number | null;
  livenessLng?: number | null;
}): Promise<void> {
  const urls = (input.afterPhotoUrls || []).filter((u) => typeof u === 'string' && u.trim().length > 0);
  if (urls.length < 1) {
    throw new Error('After photos are required');
  }

  const { error } = await supabase.rpc('submit_mission_proof', {
    p_mission_id: input.missionId,
    p_after_photo_urls: urls.slice(0, 9),
    p_completion_lat: input.completionLat ?? null,
    p_completion_lng: input.completionLng ?? null,
    p_completion_distance_meters: input.completionDistanceMeters ?? null,
    p_proof_video_url: input.proofVideoUrl ?? null,
    p_liveness_lat: input.livenessLat ?? null,
    p_liveness_lng: input.livenessLng ?? null,
  });
  if (error) throw error;
}
