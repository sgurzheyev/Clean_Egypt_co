import { supabase } from '../../services/supabase';
import {
  filterMissionDescription,
  validateMissionDescription,
} from './missionContentPolicy';
import {
  MISSION_SHORT_DESCRIPTION_MAX,
  processMissionDescription,
} from './missionDescription';
import { isGarbageRemovalService } from './crowdfunding';
import { compressMissionPhoto, isLikelyImageFile } from './missionPhotoCompression';
import { uploadToR2 } from './r2Media';
import { uploadPinVideoProofToR2 } from './pinVideoProof';

/** Free civic report photo cap (MissionBriefing carousel already supports multi-image). */
export const MAX_GARBAGE_ZONE_REPORT_PHOTOS = 5;

export type CreatedGarbageZoneReport = {
  id: string;
  description: string;
  photoUrls: string[];
  videoProofUrl: string | null;
};

export function isGarbageZoneReport(mission: {
  is_report?: boolean | null;
  status?: string | null;
}): boolean {
  if (mission.is_report) return true;
  return String(mission.status || '').toLowerCase() === 'reported';
}

async function uploadReportPhoto(file: File): Promise<string> {
  if (!isLikelyImageFile(file)) {
    throw new Error('Only images are allowed');
  }
  const fileToUpload = await compressMissionPhoto(file);
  // Cloudflare R2 — store object key in missions.photo_urls
  const { objectKey } = await uploadToR2({
    folder: 'reports',
    file: fileToUpload,
    preferPublicUrl: false,
  });
  if (!objectKey) {
    throw new Error('Photo upload returned no object key');
  }
  return objectKey;
}

export async function createGarbageZoneReport(input: {
  lat: number;
  lng: number;
  description: string;
  /** Preferred: 1–5 photo files. */
  photoFiles?: File[];
  /** @deprecated Use photoFiles — kept for a single-file call site. */
  photoFile?: File;
  /** Optional vertical pin evidence video. */
  videoFile?: File | null;
  serviceType?: string;
  /** Mapbox reverse-geocode country display name. */
  country?: string | null;
  /** Mapbox reverse-geocode city / place display name. */
  city?: string | null;
}): Promise<CreatedGarbageZoneReport> {
  const raw = input.description.trim().slice(0, MISSION_SHORT_DESCRIPTION_MAX);
  if (raw.length > 0) {
    const policy = validateMissionDescription(raw);
    if (!policy.ok) {
      throw new Error('error' in policy ? policy.error : 'Invalid description');
    }
  }
  const { filteredText } = filterMissionDescription(raw);
  const serviceType =
    input.serviceType && isGarbageRemovalService(input.serviceType)
      ? input.serviceType
      : 'beach_street_cleanup';
  const body =
    processMissionDescription(filteredText.trim() || raw || '#GarbageZone', serviceType) ||
    '#GarbageZone Needs attention';

  // Snapshot the File list up-front so later UI resets cannot empty the upload batch.
  const files = (input.photoFiles?.length
    ? input.photoFiles
    : input.photoFile
      ? [input.photoFile]
      : []
  )
    .filter((f) => f && isLikelyImageFile(f))
    .slice(0, MAX_GARBAGE_ZONE_REPORT_PHOTOS);

  if (files.length < 1) {
    throw new Error('At least one photo is required');
  }

  const photoUrls: string[] = [];
  for (const file of files) {
    photoUrls.push(await uploadReportPhoto(file));
  }
  if (photoUrls.length < 1) {
    throw new Error('At least one photo is required');
  }

  const country = String(input.country ?? '').trim() || null;
  const city = String(input.city ?? '').trim() || null;
  let videoProofUrl: string | null = null;
  if (input.videoFile) {
    videoProofUrl = await uploadPinVideoProofToR2(input.videoFile, 'reports');
  }

  const { data, error } = await supabase.rpc('create_garbage_zone_report', {
    p_location_lat: input.lat,
    p_location_lng: input.lng,
    p_description: body,
    p_photo_urls: photoUrls,
    p_service_type: serviceType,
    p_country: country,
    p_city: city,
    p_video_proof_url: videoProofUrl,
  });

  if (error) throw error;
  const id = Array.isArray(data) ? data[0] : data;
  if (!id) throw new Error('Report create returned no id');
  return {
    id: String(id),
    description: body,
    photoUrls,
    videoProofUrl,
  };
}

export type ConvertedMissionRow = {
  id: string;
  status: string;
  is_report: boolean;
  crowdfunding_mode: boolean;
  expected_price: number | null;
  amount_target: number | null;
  current_funding: number | null;
  crowdfunding_expires_at: string | null;
};

export async function convertReportToMission(input: {
  missionId: string;
  expectedPriceUsd: number;
  crowdfundingMode?: boolean;
}): Promise<ConvertedMissionRow> {
  const price = Math.floor(Number(input.expectedPriceUsd) || 0);
  if (price < 5) throw new Error('Target budget must be at least $5');

  const { data, error } = await supabase.rpc('convert_report_to_mission', {
    p_mission_id: input.missionId,
    p_expected_price: price,
    p_crowdfunding_mode: input.crowdfundingMode !== false,
  });

  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as ConvertedMissionRow | null;
  if (!row?.id) throw new Error('Conversion returned no mission');
  return row;
}
