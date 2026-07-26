import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../services/supabase';
import { resolveAuthenticatedUserId } from '../src/lib/supabaseAuth';

type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected' | string;

export type VerificationModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
  /** Parent-provided user id (Profile / MapPicker session) — avoids stale getSession(). */
  userId?: string | null;
};

type DocTypeOption = {
  slug: string;
  label: string;
};

const DOC_TYPES: DocTypeOption[] = [
  { slug: 'national_id_local', label: 'National ID (Local)' },
  { slug: 'drivers_license', label: "Driver's License" },
  { slug: 'international_passport', label: 'International Passport' },
  { slug: 'residence_permit', label: 'Residence Permit' },
];

/** Passport and residence permit only need the main data page (front). */
const FRONT_ONLY_DOC_SLUGS = new Set(['international_passport', 'residence_permit']);

function documentRequiresBackSide(slug: string): boolean {
  return !FRONT_ONLY_DOC_SLUGS.has(slug);
}

function normalizeStorageContentType(mimeType: string, kind: 'image' | 'video'): string {
  const m = String(mimeType || '').toLowerCase();
  if (kind === 'video') {
    if (m.includes('webm')) return 'video/webm';
    if (m.includes('mp4')) return 'video/mp4';
    if (m.includes('quicktime')) return 'video/quicktime';
    return 'video/webm';
  }
  if (m.includes('png')) return 'image/png';
  if (m.includes('webp')) return 'image/webp';
  return 'image/jpeg';
}

function extFromMime(mimeType: string) {
  const m = String(mimeType || '').toLowerCase();
  if (m.includes('image/png')) return 'png';
  if (m.includes('image/webp')) return 'webp';
  if (m.includes('image/jpeg') || m.includes('jpg') || m.includes('jpeg')) return 'jpg';
  if (m.includes('video/mp4')) return 'mp4';
  if (m.includes('video/quicktime')) return 'mov';
  if (m.includes('video/webm')) return 'webm';
  return 'bin';
}

function useObjectUrl(fileOrBlob: Blob | File | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!fileOrBlob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(fileOrBlob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [fileOrBlob]);
  return url;
}

function KycLivenessCapture(props: {
  disabled?: boolean;
  onCaptured: (res: { blob: Blob; mimeType: string }) => void;
}) {
  const { t } = useTranslation();
  const { disabled, onCaptured } = props;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const stopTimerRef = useRef<number | null>(null);

  const [ready, setReady] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  const supportedMimeType = useMemo(() => {
    const candidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    for (const candidate of candidates) {
      try {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) return candidate;
      } catch {
        // ignore
      }
    }
    return '';
  }, []);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      if (disabled) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera is not supported in this browser.');
        return;
      }

      try {
        setStarting(true);
        setError(null);

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (videoRef.current as any).srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setReady(true);
      } catch (e: any) {
        setError(e?.message || 'Camera permission denied.');
      } finally {
        setStarting(false);
      }
    };

    start();

    return () => {
      cancelled = true;
      if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
      try {
        recorderRef.current?.stop();
      } catch {
        // ignore
      }
      const s = streamRef.current;
      if (s) s.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
      recorderRef.current = null;
      chunksRef.current = [];
      setReady(false);
      setRecording(false);
    };
  }, [disabled]);

  const startRecording = async () => {
    if (disabled || !ready || recording || !streamRef.current) return;

    if (!supportedMimeType) {
      setError(t('livenessNotSupported', { defaultValue: 'Recording not supported on this device/browser.' }));
      return;
    }

    setError(null);
    chunksRef.current = [];

    try {
      setRecording(true);

      const recorder = new MediaRecorder(streamRef.current, { mimeType: supportedMimeType });
      recorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      recorder.onstop = () => {
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: supportedMimeType });
        chunksRef.current = [];
        onCaptured({ blob, mimeType: supportedMimeType });
      };

      recorder.start();

      const RECORD_MS = 4000;
      stopTimerRef.current = window.setTimeout(() => {
        try {
          recorder.stop();
        } catch {
          // ignore
        }
      }, RECORD_MS);
    } catch (e: any) {
      setRecording(false);
      setError(e?.message || t('livenessStartFailed', { defaultValue: 'Failed to start recording.' }));
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-200">
        {t('livenessCaptureTitle', { defaultValue: 'Identity verification' })}
      </p>

      <div className="relative mx-auto w-full max-w-[360px] rounded-[22px] border border-white/10 bg-black/30 p-3 sm:p-4">
        <div className="relative mx-auto w-full max-w-[320px] aspect-square max-h-[min(52vw,280px)] sm:max-h-[320px] rounded-[28px] overflow-hidden bg-black/50">
          <video
            ref={videoRef}
            className="w-full h-full object-cover scale-110"
            playsInline
            muted
          />

          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-300 bg-black/40 px-4 text-center">
              {starting
                ? t('livenessStarting', { defaultValue: 'Starting camera…' })
                : t('livenessPreviewUnavailable', { defaultValue: 'Camera preview unavailable.' })}
            </div>
          )}

          {recording && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/45 px-4">
              <p className="text-sm font-semibold text-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)] text-center">
                {t('livenessVerificationInProgress', { defaultValue: 'Идёт верификация...' })}
              </p>
            </div>
          )}

          <div className="absolute inset-0 pointer-events-none">
            <div
              className="absolute left-0 right-0 h-[2px] bg-cyan-300/80 shadow-[0_0_18px_rgba(34,211,238,0.9)]"
              style={{
                animation: recording ? 'kycScan 1.35s ease-in-out infinite' : undefined,
                top: 0,
              }}
            />
            <style>{`
              @keyframes kycScan {
                0% { transform: translateY(-10%); opacity: 0.15; }
                45% { opacity: 0.85; }
                50% { opacity: 0.95; }
                100% { transform: translateY(120%); opacity: 0.15; }
              }
            `}</style>
          </div>

          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute left-3 top-3 right-3 bottom-3 rounded-[18px] border border-cyan-400/25 shadow-[0_0_30px_rgba(34,211,238,0.15)]" />
          </div>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-slate-300">
          {t('livenessCaptureHint', {
            defaultValue: 'Position your face in the frame and hold still for a short clip.',
          })}
        </p>
      </div>

      {error && <p className="text-xs text-red-300">{error}</p>}

      <button
        type="button"
        disabled={disabled || !ready || recording}
        onClick={startRecording}
        className="w-full rounded-full px-5 py-3 text-[11px] font-black uppercase tracking-[0.2em] border border-cyan-400/35 text-cyan-100 bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
      >
        {recording
          ? t('livenessVerificationInProgress', { defaultValue: 'Идёт верификация...' })
          : t('livenessRecordNow', { defaultValue: 'Record (4s)' })}
      </button>
    </div>
  );
}

export default function VerificationModal(props: VerificationModalProps) {
  const { open, onClose, onSubmitted, userId: userIdProp } = props;
  const { t, i18n } = useTranslation();
  const isRu = (i18n.language || '').toLowerCase().startsWith('ru');

  const [statusLoading, setStatusLoading] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>('unverified');
  const [profileId, setProfileId] = useState<string | null>(null);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [docTypeSlug, setDocTypeSlug] = useState<string>(DOC_TYPES[0].slug);
  const [photoFront, setPhotoFront] = useState<File | null>(null);
  const [photoBack, setPhotoBack] = useState<File | null>(null);
  const [frontPreviewUrl, setFrontPreviewUrl] = useState<string | null>(null);
  const [backPreviewUrl, setBackPreviewUrl] = useState<string | null>(null);

  const [livenessBlob, setLivenessBlob] = useState<Blob | null>(null);
  const [livenessMime, setLivenessMime] = useState<string>('video/webm');
  const livenessPreviewUrl = useObjectUrl(livenessBlob);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const requiresBackSide = documentRequiresBackSide(docTypeSlug);
  const canContinueFromDocs = !!photoFront;

  useEffect(() => {
    if (userIdProp) setProfileId(userIdProp);
  }, [userIdProp]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const loadProfile = async () => {
      setStatusLoading(true);
      setSubmitError(null);
      setSubmitted(false);
      setStep(1);
      setVerificationStatus('unverified');

      try {
        const userId = await resolveAuthenticatedUserId(userIdProp ?? profileId);
        if (!userId) {
          if (!cancelled) setVerificationStatus('unverified');
          return;
        }

        if (!cancelled) setProfileId(userId);

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('verification_status, is_verified')
          .eq('id', userId)
          .maybeSingle();

        if (error) throw error;

        const rawStatus = (profile?.verification_status ?? null) as string | null;
        const fallback = profile?.is_verified ? 'verified' : 'unverified';
        const nextStatus = rawStatus || fallback;

        if (!cancelled) setVerificationStatus(nextStatus);
      } catch (e: any) {
        if (!cancelled) setSubmitError(e?.message || 'Failed to load verification status.');
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    };

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [open, userIdProp]);

  useEffect(() => {
    if (requiresBackSide) return;
    setPhotoBack(null);
    setBackPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, [requiresBackSide]);

  useEffect(() => {
    return () => {
      if (frontPreviewUrl) URL.revokeObjectURL(frontPreviewUrl);
      if (backPreviewUrl) URL.revokeObjectURL(backPreviewUrl);
    };
  }, [frontPreviewUrl, backPreviewUrl]);

  const resetMedia = () => {
    setLivenessBlob(null);
    setLivenessMime('video/webm');
  };

  const onPickFront = (file: File | null) => {
    setSubmitError(null);
    if (frontPreviewUrl) URL.revokeObjectURL(frontPreviewUrl);
    if (file) setFrontPreviewUrl(URL.createObjectURL(file));
    else setFrontPreviewUrl(null);
    setPhotoFront(file);
  };

  const onPickBack = (file: File | null) => {
    setSubmitError(null);
    if (backPreviewUrl) URL.revokeObjectURL(backPreviewUrl);
    if (file) setBackPreviewUrl(URL.createObjectURL(file));
    else setBackPreviewUrl(null);
    setPhotoBack(file);
  };

  const handleSubmit = async () => {
    if (submitting) return;

    if (!photoFront) {
      const msg = isRu ? 'Загрузите лицевую сторону документа.' : 'Upload document front.';
      setSubmitError(msg);
      alert(msg);
      setStep(1);
      return;
    }
    if (!livenessBlob) {
      const msg = isRu ? 'Запишите видео на проверку.' : 'Record liveness video.';
      setSubmitError(msg);
      alert(msg);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const uid = await resolveAuthenticatedUserId(userIdProp ?? profileId);
      if (!uid) throw new Error(isRu ? 'Войдите в аккаунт.' : 'Not authenticated.');

      const ts = Date.now();
      const frontExt = extFromMime(photoFront.type);
      const backExt = photoBack?.type ? extFromMime(photoBack.type) : 'jpg';

      const safeDocType = String(docTypeSlug || DOC_TYPES[0].slug).replace(/[^a-z0-9_-]/gi, '_');

      const frontObjectName = `kyc/${uid}/docs/${safeDocType}/front_${ts}.${frontExt}`;
      const backObjectName =
        requiresBackSide && photoBack ? `kyc/${uid}/docs/${safeDocType}/back_${ts}.${backExt}` : null;
      const liveExt = extFromMime(livenessMime || livenessBlob.type);
      const livenessObjectName = `kyc/${uid}/liveness/liveness_${ts}.${liveExt}`;

      const { error: frontUploadErr } = await supabase.storage
        .from('kyc_documents')
        .upload(frontObjectName, photoFront, {
          upsert: false,
          contentType: normalizeStorageContentType(photoFront.type, 'image'),
        });
      if (frontUploadErr) {
        console.error('[KYC submit] front upload failed', frontUploadErr);
        throw new Error(frontUploadErr.message);
      }

      if (backObjectName && photoBack) {
        const { error: backUploadErr } = await supabase.storage
          .from('kyc_documents')
          .upload(backObjectName, photoBack, {
            upsert: false,
            contentType: normalizeStorageContentType(photoBack.type, 'image'),
          });
        if (backUploadErr) {
          console.error('[KYC submit] back upload failed', backUploadErr);
          throw new Error(backUploadErr.message);
        }
      }

      const videoContentType = normalizeStorageContentType(livenessMime || livenessBlob.type, 'video');
      const { error: liveUploadErr } = await supabase.storage
        .from('kyc_documents')
        .upload(livenessObjectName, livenessBlob, {
          upsert: false,
          contentType: videoContentType,
        });
      if (liveUploadErr) {
        console.error('[KYC submit] liveness upload failed', liveUploadErr);
        throw new Error(liveUploadErr.message);
      }

      const { error: rpcErr } = await supabase.rpc('submit_kyc_verification', {
        p_doc_type: safeDocType,
        p_photo_front_object_name: frontObjectName,
        p_photo_back_object_name: backObjectName,
        p_liveness_video_object_name: livenessObjectName,
      });
      if (rpcErr) {
        console.error('[KYC submit] RPC failed', rpcErr);
        throw new Error(rpcErr.message);
      }

      setVerificationStatus('pending');
      onSubmitted?.();
      onClose();
    } catch (e: any) {
      const message =
        e?.message || (isRu ? 'Ошибка отправки заявки.' : 'Failed to submit verification.');
      console.error('[KYC submit] failed', e);
      setSubmitError(message);
      alert(message);
    } finally {
      setSubmitting(false);
    }
  };

  const statusBadge = useMemo(() => {
    const s = String(verificationStatus || '').toLowerCase();
    if (s === 'verified') {
      return (
        <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-emerald-200">
          {t('kycTrustedBadge', { defaultValue: 'Trusted' })}
        </span>
      );
    }
    if (s === 'pending') {
      return (
        <span className="inline-flex items-center rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-amber-200">
          {t('kycUnderReviewBadge', { defaultValue: 'Under Review' })}
        </span>
      );
    }
    if (s === 'rejected') {
      return (
        <span className="inline-flex items-center rounded-full border border-red-400/30 bg-red-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-red-200">
          {t('kycRejectedBadge', { defaultValue: 'Rejected' })}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-slate-200">
        {t('kycUnverifiedBadge', { defaultValue: 'Unverified' })}
      </span>
    );
  }, [t, verificationStatus]);

  if (!open) return null;

  const isBlockedByStatus =
    String(verificationStatus || '').toLowerCase() === 'pending' ||
    String(verificationStatus || '').toLowerCase() === 'verified';

  const showFlowFooter = !statusLoading && !submitted && !isBlockedByStatus;

  return (
    <div
      className="fixed inset-0 z-[10080] flex items-end justify-center bg-black/80 px-0 pt-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="ce-bottom-sheet relative flex w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-cyan-500/20 bg-cyan-950/95 shadow-[0_4px_30px_rgba(6,182,212,0.1)] backdrop-blur-md sm:rounded-3xl"
        style={{ maxHeight: 'min(85svh, 85dvh, 90vh)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-cyan-500/20 p-5 sm:p-6 pb-4">
          <div className="min-w-0 pr-2">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">
              {t('kycTitleSmall', { defaultValue: 'Identity Verification' })}
            </p>
            <h2 className="text-lg sm:text-xl font-black text-white leading-snug">
              {t('kycTitle', { defaultValue: 'Verify to accept Home / Private missions' })}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-10 w-10 shrink-0 rounded-full border border-white/15 text-slate-300 hover:text-white hover:bg-white/10 transition-all active:scale-95"
            aria-label={t('close', { defaultValue: 'Close' })}
          >
            ✕
          </button>
        </div>

        <div className="ce-bottom-sheet-body min-h-0 flex-1 px-5 py-4 sm:px-6 [scrollbar-width:thin]">
          {statusLoading ? (
            <div className="py-10 text-center text-slate-300">{t('loading', { defaultValue: 'Loading…' })}</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                {statusBadge}
                <div className="text-right text-[11px] text-slate-400">
                  {String(verificationStatus || '').toLowerCase() === 'pending' ? (
                    <span>{t('kycPendingHint', { defaultValue: 'Your documents are under review. Please wait.' })}</span>
                  ) : (
                    <span>{t('kycUnverifiedHint', { defaultValue: 'Upload documents to get access.' })}</span>
                  )}
                </div>
              </div>

              {submitted ? (
                <div className="py-6 text-center space-y-4">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-400/25 text-emerald-300 shadow-[0_0_25px_rgba(52,211,153,0.2)]">
                    ✓
                  </div>
                  <p className="text-white font-black">{t('kycSubmittedTitle', { defaultValue: 'Verification submitted' })}</p>
                  <p className="text-sm text-slate-300">
                    {t('kycSubmittedBody', { defaultValue: 'We will review your documents. Status updated to Pending.' })}
                  </p>
                </div>
              ) : isBlockedByStatus ? (
                <div className="py-6 text-center space-y-4">
                  <p className="text-white font-black text-lg">
                    {String(verificationStatus || '').toLowerCase() === 'pending'
                      ? t('kycPendingTitle', { defaultValue: 'Under Review' })
                      : t('kycTrustedTitle', { defaultValue: 'Trusted Worker' })}
                  </p>
                  <p className="text-sm text-slate-300">
                    {String(verificationStatus || '').toLowerCase() === 'pending'
                      ? t('kycPendingBody', { defaultValue: 'You cannot resubmit while your verification is pending.' })
                      : t('kycTrustedBody', { defaultValue: 'You are already verified and can accept restricted missions.' })}
                  </p>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                    <span className={step === 1 ? 'text-cyan-300' : ''}>1</span>
                    <span aria-hidden>·</span>
                    <span className={step === 2 ? 'text-cyan-300' : ''}>2</span>
                    <span aria-hidden>·</span>
                    <span className={step === 3 ? 'text-cyan-300' : ''}>3</span>
                  </div>

                  {step === 1 && (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                          {t('kycDocTypeLabel', { defaultValue: 'Document Type' })}
                        </label>
                        <select
                          value={docTypeSlug}
                          onChange={(e) => {
                            setSubmitError(null);
                            setDocTypeSlug(e.target.value);
                          }}
                          className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-white focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-500/40"
                        >
                          {DOC_TYPES.map((opt) => (
                            <option key={opt.slug} value={opt.slug} className="text-black">
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="rounded-2xl border border-cyan-400/25 bg-cyan-500/10 px-4 py-3" aria-live="polite">
                        <p className="text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)] text-sm font-semibold">
                          Ваше лицо должно совпадать с лицом на документах
                        </p>
                      </div>

                      <div className={`grid grid-cols-1 gap-4 ${requiresBackSide ? 'sm:grid-cols-2' : ''}`}>
                        <div className="space-y-2">
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                            {t('kycFrontLabel', { defaultValue: 'Front Side' })}
                          </p>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => onPickFront(e.target.files?.[0] ?? null)}
                            className="w-full text-slate-300 text-sm"
                          />
                          {frontPreviewUrl && (
                            <img
                              src={frontPreviewUrl}
                              alt="Front preview"
                              className="w-full max-h-36 sm:max-h-40 rounded-2xl object-cover border border-white/10"
                            />
                          )}
                        </div>

                        {requiresBackSide && (
                          <div className="space-y-2">
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                              {t('kycBackLabel', { defaultValue: 'Back Side (optional)' })}
                            </p>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => onPickBack(e.target.files?.[0] ?? null)}
                              className="w-full text-slate-300 text-sm"
                            />
                            {backPreviewUrl && (
                              <img
                                src={backPreviewUrl}
                                alt="Back preview"
                                className="w-full max-h-36 sm:max-h-40 rounded-2xl object-cover border border-white/10"
                              />
                            )}
                          </div>
                        )}
                      </div>

                      {!requiresBackSide && (
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          {t('kycFrontOnlyDocHint', {
                            defaultValue: 'For passport and residence permit, only the main photo page is required.',
                          })}
                        </p>
                      )}
                    </div>
                  )}

                  {step === 2 && (
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                        <p className="text-white font-black">
                          {t('kycLivenessStepTitle', { defaultValue: 'Liveness check' })}
                        </p>
                        <p className="mt-2 text-sm text-slate-300 leading-relaxed">
                          {t('kycLivenessStepBody', {
                            defaultValue:
                              'Allow camera access. You will record a short video clip to confirm your identity.',
                          })}
                        </p>
                      </div>
                      {livenessBlob && livenessPreviewUrl && (
                        <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                          <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                            {t('livenessPreviewLabel', { defaultValue: 'Captured Preview' })}
                          </p>
                          <video src={livenessPreviewUrl} controls playsInline className="mt-2 w-full max-h-48 rounded-2xl border border-white/10" />
                        </div>
                      )}
                    </div>
                  )}

                  {step === 3 && (
                    <div className="space-y-4">
                      <KycLivenessCapture
                        disabled={submitting}
                        onCaptured={(res) => {
                          setSubmitError(null);
                          setLivenessBlob(res.blob);
                          setLivenessMime(res.mimeType);
                        }}
                      />

                      {livenessBlob && livenessPreviewUrl && (
                        <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                          <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                            {t('livenessCapturedTitle', { defaultValue: 'Video captured' })}
                          </p>
                          <video src={livenessPreviewUrl} controls playsInline className="mt-2 w-full max-h-40 rounded-2xl border border-white/10" />
                        </div>
                      )}

                      {!livenessBlob && (
                        <p className="text-xs text-slate-400">
                          {t('livenessNotCapturedYet', { defaultValue: 'Record the video to enable submission.' })}
                        </p>
                      )}
                    </div>
                  )}

                  {submitError && <p className="text-xs text-red-300">{submitError}</p>}
                </div>
              )}
            </>
          )}
        </div>

        {(showFlowFooter || submitted || isBlockedByStatus) && (
          <div className="ce-bottom-sheet-footer border-t border-cyan-500/20 bg-cyan-950/98 px-4 pt-3 backdrop-blur-md sm:px-6">
            {submitError && showFlowFooter && !submitted && !isBlockedByStatus && (
              <p className="mb-2 text-center text-xs text-red-300" role="alert">
                {submitError}
              </p>
            )}
            {submitted || isBlockedByStatus ? (
              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 rounded-full border border-white/15 bg-white/5 text-slate-200 font-black uppercase tracking-[0.12em] hover:bg-white/10 transition-colors"
              >
                {t('close', { defaultValue: 'Close' })}
              </button>
            ) : step === 1 ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="flex-1 py-3 rounded-full border border-white/15 bg-white/5 text-slate-200 font-black uppercase tracking-[0.12em] hover:bg-white/10 transition-colors"
                  onClick={onClose}
                >
                  {t('close', { defaultValue: 'Close' })}
                </button>
                <button
                  type="button"
                  disabled={!canContinueFromDocs}
                  className="flex-1 py-3 rounded-full border border-cyan-400/35 bg-cyan-600/90 text-white font-black uppercase tracking-[0.12em] hover:bg-cyan-500/95 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  onClick={() => setStep(2)}
                >
                  {t('continueToLiveness', { defaultValue: 'Continue' })}
                </button>
              </div>
            ) : step === 2 ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="flex-1 py-3 rounded-full border border-white/15 bg-white/5 text-slate-200 font-black uppercase tracking-[0.12em] hover:bg-white/10 transition-colors"
                  onClick={() => setStep(1)}
                >
                  {t('back', { defaultValue: 'Back' })}
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="flex-1 py-3 rounded-full border border-cyan-400/35 bg-cyan-600/90 text-white font-black uppercase tracking-[0.12em] hover:bg-cyan-500/95 transition-colors"
                >
                  {t('startLivenessCapture', { defaultValue: 'Start verification' })}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  className="min-w-0 py-2.5 px-1 rounded-full border border-white/15 bg-white/5 text-slate-200 text-xs font-semibold hover:bg-white/10 transition-colors disabled:opacity-60"
                  onClick={() => {
                    resetMedia();
                    setStep(2);
                  }}
                >
                  {t('back', { defaultValue: 'Назад' })}
                </button>
                {livenessBlob ? (
                  <>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={resetMedia}
                      className="min-w-0 py-2.5 px-1 rounded-full border border-white/15 bg-white/5 text-slate-200 text-xs font-semibold hover:bg-white/10 transition-colors disabled:opacity-60"
                    >
                      {t('retake', { defaultValue: 'Повторить' })}
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void handleSubmit()}
                      className="min-w-0 py-2.5 px-1 rounded-full border border-emerald-400/30 bg-emerald-500/15 text-emerald-100 text-xs font-semibold hover:bg-emerald-500/25 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                    >
                      {submitting
                        ? t('submitting', { defaultValue: 'Отправка...' })
                        : t('submitForReview', { defaultValue: 'Отправить' })}
                    </button>
                  </>
                ) : (
                  <div className="col-span-2 flex items-center justify-center text-[11px] text-slate-500 text-center px-1">
                    {t('livenessNotCapturedYet', { defaultValue: 'Запишите видео' })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
