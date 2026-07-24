import imageCompression from 'browser-image-compression';
import { supabase } from '../../services/supabase';
import {
  extractMissionFeedDescription,
  MISSION_SHORT_DESCRIPTION_MAX,
} from './missionDescription';
import { filterMissionDescription, validateMissionDescription } from './missionContentPolicy';

export const EDITABLE_MISSION_STATUSES = new Set([
  'available',
  'pending',
  'funding',
  'open',
]);

export const MAX_MISSION_PHOTOS = 9;

const COMPRESSION = {
  maxSizeMB: 0.4,
  maxWidthOrHeight: 1280,
  useWebWorker: true,
  fileType: 'image/jpeg' as const,
};

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
    if (!file.type || !file.type.startsWith('image/')) {
      throw new Error('Only images are allowed');
    }

    let fileToUpload: File | Blob = file;
    try {
      fileToUpload = await imageCompression(file, COMPRESSION);
    } catch (err) {
      console.warn('[updateMissionDetails] compression failed', file.name, err);
    }

    const safeFileName = `mission_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from('order-photos')
      .upload(safeFileName, fileToUpload, { upsert: false, contentType: 'image/jpeg' });
    if (uploadError) throw uploadError;

    const {
      data: { publicUrl },
    } = supabase.storage.from('order-photos').getPublicUrl(safeFileName);
    uploaded.push(publicUrl);
  }

  return uploaded;
}

export type UpdateMissionDetailsInput = {
  missionId: string;
  currentDescription: string | null | undefined;
  currentPhotoUrls: string[] | null | undefined;
  nextBodyText: string;
  newPhotoFiles: File[];
};

export type UpdateMissionDetailsResult = {
  description: string | null;
  photo_urls: string[] | null;
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

  const { data, error } = await supabase.rpc('creator_update_mission_details', {
    p_mission_id: input.missionId,
    p_description: nextDescription,
    p_photo_urls: nextPhotos,
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
  };
}
