/**
 * Compress + upload mission chat photos to Cloudflare R2 (`chat/`).
 * Stores object key in `mission_chats.image_url`; resolve with resolveR2PublicUrl.
 */
import { compressMissionPhoto } from './missionPhotoCompression';
import { uploadToR2 } from './r2Media';

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

  const fileToUpload = await compressMissionPhoto(file);
  const safeMissionId = String(missionId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);

  const { objectKey } = await uploadToR2({
    folder: 'chat',
    file: fileToUpload,
    subpath: safeMissionId || 'mission',
    preferPublicUrl: false,
  });

  return objectKey;
}
