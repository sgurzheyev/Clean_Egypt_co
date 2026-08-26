import { compressPinVideoProof } from './compressPinVideo';
import { uploadToR2 } from './r2Media';

export async function uploadPinVideoProofToR2(
  file: File,
  folder: 'mission-photos' | 'reports' = 'mission-photos'
): Promise<string> {
  const compressed = await compressPinVideoProof(file);
  const { objectKey } = await uploadToR2({
    folder,
    file: compressed,
    subpath: 'video-proof',
    preferPublicUrl: false,
  });
  return objectKey;
}
