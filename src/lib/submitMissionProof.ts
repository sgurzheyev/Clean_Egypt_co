import { supabase } from '../../services/supabase';

/** Worker submits proof — P2P photos → review; crowdfunding R2 video → awaiting_approval. */
export async function submitMissionProof(input: {
  missionId: string;
  afterPhotoUrls?: string[];
  /** Worker GPS at submission time (required server-side, ≤200m from mission). */
  workerLat: number;
  workerLng: number;
  completionLat?: number | null;
  completionLng?: number | null;
  completionDistanceMeters?: number | null;
  /** R2 object key (crowdfunding) or optional liveness URL (P2P). */
  proofVideoUrl?: string | null;
  livenessLat?: number | null;
  livenessLng?: number | null;
}): Promise<void> {
  const urls = (input.afterPhotoUrls || []).filter((u) => typeof u === 'string' && u.trim().length > 0);
  const video = (input.proofVideoUrl || '').trim();
  if (urls.length < 1 && !video) {
    throw new Error('After photos or a proof video are required');
  }
  if (
    typeof input.workerLat !== 'number' ||
    typeof input.workerLng !== 'number' ||
    !Number.isFinite(input.workerLat) ||
    !Number.isFinite(input.workerLng)
  ) {
    throw new Error('Worker GPS coordinates are required');
  }

  const { error } = await supabase.rpc('submit_mission_proof', {
    p_mission_id: input.missionId,
    p_after_photo_urls: urls.slice(0, 9),
    p_worker_lat: input.workerLat,
    p_worker_lng: input.workerLng,
    p_completion_lat: input.completionLat ?? input.workerLat,
    p_completion_lng: input.completionLng ?? input.workerLng,
    p_completion_distance_meters: input.completionDistanceMeters ?? null,
    p_proof_video_url: video || null,
    p_liveness_lat: input.livenessLat ?? null,
    p_liveness_lng: input.livenessLng ?? null,
  });
  if (error) throw error;
}

/** Creator rejects worker proof — review → in_progress with reason. */
export async function creatorRejectProof(input: {
  missionId: string;
  reason: string;
}): Promise<void> {
  const reason = (input.reason || '').trim();
  if (!reason) {
    throw new Error('Rejection reason is required');
  }

  const { error } = await supabase.rpc('creator_reject_proof', {
    p_mission_id: input.missionId,
    p_reason: reason.slice(0, 1000),
  });
  if (error) throw error;
}

/** Read browser geolocation once (for proof GPS gate). */
export function getWorkerGeolocation(options?: PositionOptions): Promise<{
  lat: number;
  lng: number;
}> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation is not available on this device'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        reject(new Error(err?.message || 'Failed to read GPS location'));
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
        ...options,
      }
    );
  });
}
