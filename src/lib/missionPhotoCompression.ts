/**
 * Shared image compression preset for all user-uploaded mission / proof photos.
 * Targets ≤ 700 KB at 1280 px — good quality on mobile, fast upload.
 */
import imageCompression from 'browser-image-compression';

export const MOBILE_PHOTO_COMPRESSION = {
  /** Hard cap at 700 KB */
  maxSizeMB: 0.7,
  /** Shrink longest dimension to 1280 px (2× retina on most phones) */
  maxWidthOrHeight: 1280,
  useWebWorker: true,
  fileType: 'image/jpeg' as const,
  /**
   * EXIF orientation is automatically corrected by browser-image-compression;
   * keep it at default quality (~0.85) unless overridden.
   */
  initialQuality: 0.85,
} as const;

/**
 * Compress a single image file for mobile upload.
 * Falls back to the original file on any error.
 */
export async function compressMissionPhoto(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const compressed = await imageCompression(file, MOBILE_PHOTO_COMPRESSION);
    return compressed as File;
  } catch (err) {
    console.warn('[compressMissionPhoto] compression failed', file.name, err);
    return file;
  }
}

/**
 * Compress multiple files in parallel (up to concurrency limit).
 */
export async function compressMissionPhotos(
  files: File[],
  onProgress?: (done: number, total: number) => void
): Promise<File[]> {
  const results: File[] = [];
  let done = 0;
  // Process in chunks of 3 to avoid freezing the main thread on low-end devices.
  const CHUNK = 3;
  for (let i = 0; i < files.length; i += CHUNK) {
    const chunk = files.slice(i, i + CHUNK);
    const compressed = await Promise.all(chunk.map((f) => compressMissionPhoto(f)));
    results.push(...compressed);
    done += chunk.length;
    onProgress?.(done, files.length);
  }
  return results;
}
