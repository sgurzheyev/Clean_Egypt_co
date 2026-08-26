import { supabase } from '../../services/supabase';
import {
  extractMissionFeedDescription,
  MISSION_SHORT_DESCRIPTION_MAX,
} from './missionDescription';
import { filterMissionDescription, validateMissionDescription } from './missionContentPolicy';
import { compressMissionPhoto, isLikelyImageFile } from './missionPhotoCompression';
import { uploadMissionPhotoToR2 } from './r2Media';
import { uploadPinVideoProofToR2 } from './pinVideoProof';

export const EDITABLE_MISSION_STATUSES = new Set([
  'available',
  'pending',
  'funding',
  'open',
]);

export const MAX_MISSION_PHOTOS = 9;

export function isMissionEditableStatus(status: string | null | undefined): boolean {
  return EDITABLE_MISSION_STATUSES.has(String(status || '').toLowerCase());
}

/** Preserve the leading 📍 location line while replacing the body text. */
export function replaceMissionFeedDescription(
  fullDescription: string | null | undefined,
  newBody: string
): string {
  const raw = String(fullDescription ?? '');
  const trimmedBody = newBody.trim().slice(0, MISSION_SHORT_DESCRIPTION_MAX);

  if (raw.includes('\n\n')) {
    const [head] = raw.split(/\n\n+/);
    if (head.trim().startsWith('📍')) {
      return trimmedBody ? `${head.trim()}\n\n${trimmedBody}` : head.trim();
    }
  }

  const lines = raw.split('\n');
  if (lines[0]?.trim().startsWith('📍')) {
    return trimmedBody ? `${lines[0].trim()}\n\n${trimmedBody}` : lines[0].trim();
  }

  return trimmedBody;
}

export async function uploadMissionPhotoFiles(files: File[]): Promise<string[]> {
  const uploaded: string[] = [];

  for (const file of files) {
    if (!isLikelyImageFile(file)) {
      throw new Error('Only images are allowed');
    }

    const fileToUpload = await compressMissionPhoto(file);
    uploaded.push(await uploadMissionPhotoToR2(fileToUpload, 'creator'));
  }

  return uploaded;
}

export type UpdateMissionDetailsInput = {
  missionId: string;
  currentDescription: string | null | undefined;
  currentPhotoUrls: string[] | null | undefined;
  nextBodyText: string;
  newPhotoFiles: File[];
  newVideoFile?: File | null;
};

export type UpdateMissionDetailsResult = {
  description: string | null;
  photo_urls: string[] | null;
  video_proof_url?: string | null;
};

export async function updateMissionDetails(
  input: UpdateMissionDetailsInput
): Promise<UpdateMissionDetailsResult> {
  const rawBody = input.nextBodyText.trim().slice(0, MISSION_SHORT_DESCRIPTION_MAX);
  if (rawBody.length > 0) {
    const policy = validateMissionDescription(rawBody);
    if (!policy.ok) {
      throw new Error('error' in policy ? policy.error : 'Invalid description');
    }
  }

  const { filteredText } = filterMissionDescription(rawBody);
  const bodyText = filteredText.trim() || rawBody;
  const nextDescription = replaceMissionFeedDescription(input.currentDescription, bodyText);

  const existing = (input.currentPhotoUrls || []).filter(Boolean);
  const slotsLeft = Math.max(0, MAX_MISSION_PHOTOS - existing.length);
  const filesToUpload = input.newPhotoFiles.slice(0, slotsLeft);
  const uploaded = filesToUpload.length > 0 ? await uploadMissionPhotoFiles(filesToUpload) : [];
  const nextPhotos = [...existing, ...uploaded].slice(0, MAX_MISSION_PHOTOS);
  let videoProofUrl: string | undefined;
  if (input.newVideoFile) {
    videoProofUrl = await uploadPinVideoProofToR2(input.newVideoFile, 'mission-photos');
  }

  const { data, error } = await supabase.rpc('creator_update_mission_details', {
    p_mission_id: input.missionId,
    p_description: nextDescription,
    p_photo_urls: nextPhotos,
    ...(videoProofUrl ? { p_video_proof_url: videoProofUrl } : {}),
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  return {
    description:
      (row?.description as string | null | undefined) ??
      nextDescription ??
      extractMissionFeedDescription(nextDescription) ??
      null,
    photo_urls: (row?.photo_urls as string[] | null | undefined) ?? nextPhotos,
    video_proof_url:
      (row?.video_proof_url as string | null | undefined) ?? videoProofUrl ?? null,
  };
}
