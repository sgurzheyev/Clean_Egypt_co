import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import imageCompression from 'browser-image-compression';
import {
  validateMissionDescription,
  filterMissionDescription,
  MISSION_DESCRIPTION_POLICY_ERROR,
} from '../src/lib/missionContentPolicy';
import { PROFILE_GLASS_PANEL } from '../constants';
import { fileToBase64Parts } from '../src/lib/imageBase64';

const MODERATION_COMPRESSION = {
  maxWidthOrHeight: 1200,
  initialQuality: 0.7,
  useWebWorker: true,
  fileType: 'image/jpeg' as const,
};

const MAX_PHOTOS = 10;

type PhotoSlotStatus = 'checking' | 'approved' | 'rejected';

type PhotoSlot = {
  key: string;
  file: File;
  previewUrl: string;
  status: PhotoSlotStatus;
  reason?: string;
};

type Props = {
  taskType: 'city' | 'home';
  orderDescription: string;
  setOrderDescription: (v: string) => void;
  orderPhotos: File[];
  setOrderPhotos: (files: File[]) => void;
  onDescriptionPolicyError: (msg: string | null) => void;
  onTextWarning?: (msg: string | null) => void;
  hasTextWarning?: boolean;
  /** SaaS lead-gen: hide the long description field (keep only photo upload). */
  showDescription?: boolean;
  /** True while any photo is awaiting AI moderation (disables parent submit). */
  onModerationBusy?: (busy: boolean) => void;
};

const CreateMission: React.FC<Props> = ({
  taskType,
  orderDescription,
  setOrderDescription,
  orderPhotos,
  setOrderPhotos,
  onDescriptionPolicyError,
  onTextWarning,
  hasTextWarning = false,
  showDescription = true,
  onModerationBusy,
}) => {
  const { t, i18n } = useTranslation();
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const [photoSlots, setPhotoSlots] = useState<PhotoSlot[]>([]);
  const [moderationToast, setModerationToast] = useState<string | null>(null);
  const moderationRunRef = useRef(0);

  const resizeDescription = useCallback(() => {
    const el = descriptionRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, 72), 320);
    el.style.height = `${next}px`;
  }, []);

  useLayoutEffect(() => {
    resizeDescription();
  }, [orderDescription, resizeDescription]);

  useEffect(() => {
    const { textWarningKey } = filterMissionDescription(orderDescription);
    onTextWarning?.(textWarningKey ? t(textWarningKey) : null);
  }, [orderDescription, onTextWarning, t]);

  useEffect(() => {
    const busy = photoSlots.some((s) => s.status === 'checking');
    onModerationBusy?.(busy);
  }, [photoSlots, onModerationBusy]);

  /**
   * Parent clears `orderPhotos` after submit — reset local thumbnails too.
   * Only treat it as a reset when the count actually dropped to zero (prev > 0):
   * `orderPhotos` holds approved photos only, so it is legitimately empty while
   * a fresh photo is still being checked — wiping then would kill every upload.
   */
  const prevOrderPhotosCount = useRef(orderPhotos.length);
  useEffect(() => {
    const prevCount = prevOrderPhotosCount.current;
    prevOrderPhotosCount.current = orderPhotos.length;
    const hasChecking = photoSlots.some((s) => s.status === 'checking');
    if (prevCount > 0 && orderPhotos.length === 0 && photoSlots.length > 0 && !hasChecking) {
      moderationRunRef.current += 1; // cancel any in-flight moderation callbacks
      photoSlots.forEach((s) => URL.revokeObjectURL(s.previewUrl));
      setPhotoSlots([]);
      setModerationToast(null);
    }
  }, [orderPhotos.length, photoSlots]);

  useEffect(() => {
    return () => {
      photoSlots.forEach((s) => URL.revokeObjectURL(s.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup on unmount only
  }, []);

  const syncApprovedPhotos = useCallback(
    (slots: PhotoSlot[]) => {
      const approved = slots.filter((s) => s.status === 'approved').map((s) => s.file);
      setOrderPhotos(approved.slice(0, MAX_PHOTOS));
    },
    [setOrderPhotos]
  );

  const removeSlot = useCallback((key: string) => {
    setPhotoSlots((prev) => {
      const slot = prev.find((s) => s.key === key);
      if (slot) URL.revokeObjectURL(slot.previewUrl);
      const next = prev.filter((s) => s.key !== key);
      syncApprovedPhotos(next);
      return next;
    });
  }, [syncApprovedPhotos]);

  const approveSlot = useCallback(
    (key: string) => {
      setPhotoSlots((prev) => {
        const next = prev.map((s) =>
          s.key === key ? { ...s, status: 'approved' as const } : s
        );
        syncApprovedPhotos(next);
        return next;
      });
    },
    [syncApprovedPhotos]
  );

  const rejectSlot = useCallback(
    (key: string, reason: string) => {
      setPhotoSlots((prev) =>
        prev.map((s) =>
          s.key === key ? { ...s, status: 'rejected' as const, reason } : s
        )
      );
      setModerationToast(reason);
      window.setTimeout(() => removeSlot(key), 4500);
    },
    [removeSlot]
  );

  /**
   * Safety check for one photo. NEVER leaves a slot in 'checking':
   * - 200 + isApproved=false  -> reject (real NSFW verdict)
   * - 200 + isApproved=true   -> approve
   * - any service failure (network error, 4xx/5xx, bad JSON) -> fail-open:
   *   approve with a warning toast so a flaky moderation API can't block uploads.
   */
  const moderateOneFile = useCallback(
    async (file: File, key: string, runId: number) => {
      try {
        const compressed = await imageCompression(file, MODERATION_COMPRESSION).catch(() => file);
        const { base64, mimeType } = await fileToBase64Parts(compressed);

        const res = await fetch('/api/moderate-mission-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: base64,
            mimeType,
            userLanguage: i18n.language || 'en',
          }),
        });

        const data = (await res.json().catch(() => null)) as {
          isApproved?: boolean;
          reason?: string;
        } | null;

        if (moderationRunRef.current !== runId) return;

        if (res.ok && data && typeof data.isApproved === 'boolean') {
          if (data.isApproved) {
            approveSlot(key);
          } else {
            const reason =
              (typeof data.reason === 'string' && data.reason.trim()) ||
              t('photoModerationRejectedDefault');
            rejectSlot(key, reason);
          }
          return;
        }

        console.warn('moderate-mission-image unavailable, approving photo without check', res.status);
        approveSlot(key);
        setModerationToast(t('photoModerationUnavailable'));
      } catch (err) {
        if (moderationRunRef.current !== runId) return;
        console.warn('moderate-mission-image failed, approving photo without check', err);
        approveSlot(key);
        setModerationToast(t('photoModerationUnavailable'));
      }
    },
    [approveSlot, i18n.language, rejectSlot, t]
  );

  const handleIncomingPhotos = useCallback(
    async (incoming: File[]) => {
      const imageFiles = incoming.filter((f) => f.type.startsWith('image/'));
      if (imageFiles.length === 0) return;

      // Snapshot the run token WITHOUT bumping it: bumping here orphaned earlier
      // in-flight checks, leaving them stuck in 'checking' and locking the form.
      // The token is only bumped when slots are wiped (parent reset).
      const runId = moderationRunRef.current;
      setModerationToast(null);

      const approvedCount = photoSlots.filter((s) => s.status === 'approved').length;
      const checkingCount = photoSlots.filter((s) => s.status === 'checking').length;
      const room = Math.max(0, MAX_PHOTOS - approvedCount - checkingCount);
      const toQueue = imageFiles.slice(0, room);

      if (toQueue.length < imageFiles.length) {
        setModerationToast(t('photoModerationMaxReached', { max: MAX_PHOTOS }));
      }
      if (toQueue.length === 0) return;

      const newSlots: PhotoSlot[] = toQueue.map((file) => ({
        key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        status: 'checking' as const,
      }));

      setPhotoSlots((prev) => [...prev, ...newSlots]);

      await Promise.all(newSlots.map((slot) => moderateOneFile(slot.file, slot.key, runId)));
    },
    [moderateOneFile, photoSlots, t]
  );

  const handleDescriptionChange = (v: string) => {
    setOrderDescription(v);
    const r = validateMissionDescription(v);
    onDescriptionPolicyError(r.ok ? null : MISSION_DESCRIPTION_POLICY_ERROR);
    const { textWarningKey } = filterMissionDescription(v);
    onTextWarning?.(textWarningKey ? t(textWarningKey) : null);
  };

  const approvedCount = photoSlots.filter((s) => s.status === 'approved').length;

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
            {t('uploadPhoto')}
          </label>
          <label className="flex min-h-[52px] items-center justify-center rounded-2xl border border-dashed border-slate-600 bg-black/30 px-2 text-center text-[11px] text-slate-400 cursor-pointer hover:border-teal-400 hover:text-teal-300 transition-all">
            {approvedCount > 0
              ? `${approvedCount} ${t('photosSelected')}`
              : t('tapToAddReferencePhotos')}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = '';
                void handleIncomingPhotos(files);
              }}
            />
          </label>

          {moderationToast && (
            <p className="mt-2 text-[11px] font-medium text-amber-300 leading-snug" role="alert">
              {moderationToast}
            </p>
          )}

          {approvedCount > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {approvedCount <= 4 ? (
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-amber-500/10 border border-amber-400/50 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">
                  {t('lowProofWork')}
                </span>
              ) : (
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-400/50 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">
                  {t('highProofWork')}
                </span>
              )}
            </div>
          )}

          {photoSlots.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {photoSlots.map((slot) => (
                <li
                  key={slot.key}
                  className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/40"
                >
                  <img
                    src={slot.previewUrl}
                    alt=""
                    className={`h-full w-full object-cover ${
                      slot.status === 'checking' ? 'opacity-50' : ''
                    } ${slot.status === 'rejected' ? 'opacity-40 grayscale' : ''}`}
                  />
                  {slot.status === 'checking' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <span className="h-5 w-5 rounded-full border-2 border-cyan-300 border-t-transparent animate-spin" />
                    </div>
                  )}
                  {slot.status === 'approved' && (
                    <span className="absolute bottom-0.5 right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/90 text-[10px] text-black font-black">
                      ✓
                    </span>
                  )}
                  {slot.status === 'rejected' && (
                    <span className="absolute bottom-0.5 right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500/90 text-[10px] text-white font-black">
                      ✕
                    </span>
                  )}
                  {slot.status === 'approved' && (
                    <button
                      type="button"
                      onClick={() => removeSlot(slot.key)}
                      className="absolute top-0.5 right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-[10px] text-white hover:bg-red-600/80"
                      aria-label={t('removePhoto')}
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {photoSlots.some((s) => s.status === 'checking') && (
            <p className="mt-2 text-[10px] text-cyan-300 animate-pulse">
              {t('photoModerationChecking')}
            </p>
          )}
        </div>
      </div>

      {showDescription && (
        <div>
        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
          {t('shortDescriptionAndArea')}
        </label>
        <textarea
          ref={descriptionRef}
          value={orderDescription}
          onChange={(e) => handleDescriptionChange(e.target.value)}
          rows={2}
          placeholder={
            taskType === 'city' ? t('describeCitySpot') : t('describeHomeTask')
          }
          className={`w-full min-h-[4.5rem] max-h-[20rem] overflow-y-auto ${PROFILE_GLASS_PANEL} px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-500 resize-none ${
            hasTextWarning ? 'border-b-2 border-dashed border-[#ea580c]' : ''
          }`}
        />
        </div>
      )}
    </>
  );
};

export default CreateMission;
