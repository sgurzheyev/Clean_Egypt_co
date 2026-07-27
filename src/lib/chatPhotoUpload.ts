/**
 * Compress + upload chat photos to the `chat-photos` Storage bucket.
 * Path: {missionId}/{userId}/{timestamp}_{rand}.jpg
 */
import imageCompression from 'browser-image-compression';
import { supabase } from '../../services/supabase';

const CHAT_PHOTO_BUCKET = 'chat-photos';

const COMPRESSION = {
  maxSizeMB: 0.4,
  maxWidthOrHeight: 1280,
  useWebWorker: true,
  fileType: 'image/jpeg' as const,
};

export async function uploadChatPhoto(params: {
  file: File;
  missionId: string;
  userId: string;
}): Promise<string> {
  const { file, missionId, userId } = params;
  if (!file?.type || !file.type.startsWith('image/')) {
    throw new Error('Only images are allowed');
  }
  if (!missionId || !userId) {
    throw new Error('Missing mission or user for chat photo upload');
  }

  let fileToUpload: File | Blob = file;
  try {
    fileToUpload = await imageCompression(file, COMPRESSION);
  } catch (err) {
    console.warn('[chatPhotoUpload] compression failed', file.name, err);
  }

  const safeName = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.jpg`;
  const path = `${missionId}/${userId}/${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(CHAT_PHOTO_BUCKET)
    .upload(path, fileToUpload, { upsert: false, contentType: 'image/jpeg' });
  if (uploadError) throw uploadError;

  const {
    data: { publicUrl },
  } = supabase.storage.from(CHAT_PHOTO_BUCKET).getPublicUrl(path);

  if (!publicUrl) throw new Error('Failed to resolve chat photo URL');
  return publicUrl;
}
