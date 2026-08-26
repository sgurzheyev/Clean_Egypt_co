/**
 * Client-side pin evidence video: 9:16 crop, 30–60s window, WebM/MP4.
 */

export const PIN_VIDEO_MIN_SEC = 30;
export const PIN_VIDEO_IDEAL_MIN_SEC = 30;
export const PIN_VIDEO_MAX_SEC = 60;
export const PIN_VIDEO_MAX_BYTES = 80 * 1024 * 1024;

const TARGET_W = 720;
const TARGET_H = 1280;
const FPS = 30;
const BITRATE = 1_200_000;

function loadVideo(file: File): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = url;
    const cleanup = () => URL.revokeObjectURL(url);
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => {
      cleanup();
      reject(new Error('Could not read video file'));
    };
  });
}

export async function readVideoDurationSec(file: File): Promise<number> {
  const video = await loadVideo(file);
  const d = Number(video.duration);
  URL.revokeObjectURL(video.src);
  video.src = '';
  if (!Number.isFinite(d) || d <= 0) {
    throw new Error('Could not read video duration');
  }
  return d;
}

function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  if (typeof MediaRecorder === 'undefined') return '';
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function coverCrop(
  vw: number,
  vh: number
): { sx: number; sy: number; sw: number; sh: number } {
  const target = TARGET_W / TARGET_H;
  const src = vw / vh;
  if (src > target) {
    const sw = vh * target;
    return { sx: (vw - sw) / 2, sy: 0, sw, sh: vh };
  }
  const sh = vw / target;
  return { sx: 0, sy: (vh - sh) / 2, sw: vw, sh };
}

/**
 * Trim to ≤60s, crop to vertical 9:16, encode. Falls back to the original
 * file when MediaRecorder/canvas capture is unavailable.
 */
export async function compressPinVideoProof(file: File): Promise<File> {
  if (!file || file.size < 1) {
    throw new Error('A video file is required');
  }
  if (file.size > PIN_VIDEO_MAX_BYTES) {
    throw new Error('Video is too large (max 80 MB)');
  }

  const video = await loadVideo(file);
  const duration = Number(video.duration);
  if (!Number.isFinite(duration) || duration < PIN_VIDEO_MIN_SEC) {
    URL.revokeObjectURL(video.src);
    throw new Error(
      `Video must be at least ${PIN_VIDEO_IDEAL_MIN_SEC} seconds (30–60s vertical).`
    );
  }

  const clipSec = Math.min(duration, PIN_VIDEO_MAX_SEC);
  const mime = pickMimeType();
  const canvas = document.createElement('canvas');
  canvas.width = TARGET_W;
  canvas.height = TARGET_H;
  const ctx = canvas.getContext('2d');
  if (!ctx || !mime || typeof canvas.captureStream !== 'function') {
    URL.revokeObjectURL(video.src);
    if (duration > PIN_VIDEO_MAX_SEC + 1) {
      throw new Error('Video must be 30–60 seconds. Trim it and try again.');
    }
    return file;
  }

  const crop = coverCrop(video.videoWidth || TARGET_W, video.videoHeight || TARGET_H);
  const stream = canvas.captureStream(FPS);
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: BITRATE,
  });

  const blob: Blob = await new Promise((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = () => reject(new Error('Video encoding failed'));
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: mime.split(';')[0] }));
    };

    let stopped = false;
    const stopAll = () => {
      if (stopped) return;
      stopped = true;
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        /* already stopped */
      }
      video.pause();
    };

    const draw = () => {
      if (stopped) return;
      if (video.currentTime >= clipSec) {
        stopAll();
        return;
      }
      ctx.drawImage(
        video,
        crop.sx,
        crop.sy,
        crop.sw,
        crop.sh,
        0,
        0,
        TARGET_W,
        TARGET_H
      );
      requestAnimationFrame(draw);
    };

    recorder.start(250);
    video.currentTime = 0;
    video
      .play()
      .then(() => requestAnimationFrame(draw))
      .catch((err) => {
        stopAll();
        reject(err);
      });
    window.setTimeout(stopAll, (clipSec + 1.5) * 1000);
  });

  URL.revokeObjectURL(video.src);
  video.src = '';

  if (blob.size < 1024) {
    if (duration > PIN_VIDEO_MAX_SEC + 1) {
      throw new Error('Video must be 30–60 seconds. Trim it and try again.');
    }
    return file;
  }

  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  return new File([blob], `pin-video-proof.${ext}`, {
    type: blob.type || 'video/webm',
    lastModified: Date.now(),
  });
}
