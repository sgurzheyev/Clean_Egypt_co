/**
 * Lightweight 2-click "Report Garbage Zone" sheet.
 */
import React, { useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MISSION_SHORT_DESCRIPTION_MAX } from '../src/lib/missionDescription';
import { createGarbageZoneReport } from '../src/lib/garbageZoneReport';

const QUICK_TAGS = ['#BeachTrash', '#DumpingGround', '#StreetLitter', '#HazardZone'] as const;

type Props = {
  open: boolean;
  lat: number;
  lng: number;
  onClose: () => void;
  onCreated: (missionId: string) => void | Promise<void>;
};

const ReportGarbageZoneModal: React.FC<Props> = ({ open, lat, lng, onClose, onCreated }) => {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const resetLocal = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setDescription('');
    setPhotoFile(null);
    setPreviewUrl(null);
    setError(null);
    setSubmitting(false);
  };

  const handleClose = () => {
    resetLocal();
    onClose();
  };

  const onPickPhoto = (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPhotoFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setError(null);
  };

  const submit = async () => {
    if (submitting) return;
    if (!photoFile) {
      setError(t('reportZonePhotoRequired', { defaultValue: 'Add a photo of the zone.' }));
      return;
    }
    const safeLat = Number(lat);
    const safeLng = Number(lng);
    if (!Number.isFinite(safeLat) || !Number.isFinite(safeLng)) {
      setError(
        t('reportZoneCreateFailed', { defaultValue: 'Could not publish this report.' })
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const id = await createGarbageZoneReport({
        lat: safeLat,
        lng: safeLng,
        description,
        photoFile,
      });
      resetLocal();
      await onCreated(id);
    } catch (err: any) {
      setError(
        err?.message ||
          t('reportZoneCreateFailed', { defaultValue: 'Could not publish this report.' })
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="absolute inset-0 z-[10075] flex items-end justify-center pointer-events-auto">
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        aria-label={t('close')}
        onClick={handleClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('reportZoneTitle', { defaultValue: 'Report Garbage Zone' })}
        className="relative z-[1] w-full max-w-md overflow-hidden rounded-t-2xl border-t border-rose-400/30 bg-[#0A0A12]/95 shadow-[0_-16px_48px_rgba(244,63,94,0.22)] backdrop-blur-xl"
        style={{ maxHeight: 'min(85dvh, 85vh)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="overflow-y-auto overscroll-contain p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-white/15" aria-hidden />
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-rose-300">
                {t('reportZoneTitle', { defaultValue: 'Report Garbage Zone' })}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                {t('reportZoneHint', {
                  defaultValue: 'Free civic pin — photo + short note. No tokens required.',
                })}
              </p>
              <p className="mt-1 text-[10px] font-mono tabular-nums text-slate-500">
                {lat.toFixed(5)}, {lng.toFixed(5)}
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-slate-200 active:scale-95"
              aria-label={t('close')}
            >
              <X className="h-4 w-4" strokeWidth={2.25} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mb-3 flex w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-dashed border-rose-400/40 bg-rose-500/10 py-6 text-rose-100 transition-colors hover:bg-rose-500/15 active:scale-[0.99]"
          >
            {previewUrl ? (
              <img src={previewUrl} alt="" className="max-h-40 w-full object-cover" />
            ) : (
              <>
                <Camera className="h-6 w-6" strokeWidth={2.25} />
                <span className="text-[10px] font-black uppercase tracking-[0.16em]">
                  {t('reportZoneAddPhoto', { defaultValue: 'Add photo' })}
                </span>
              </>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              onPickPhoto(e.target.files);
              e.target.value = '';
            }}
          />

          <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
            {t('reportZoneDescriptionLabel', { defaultValue: 'What needs attention?' })}
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, MISSION_SHORT_DESCRIPTION_MAX))}
            rows={3}
            maxLength={MISSION_SHORT_DESCRIPTION_MAX}
            placeholder={t('reportZoneDescriptionPlaceholder', {
              defaultValue: 'e.g. Illegal dump near the beach ramp…',
            })}
            className="mb-2 w-full resize-none rounded-2xl border border-white/12 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-rose-400/45"
          />
          <div className="mb-4 flex flex-wrap gap-1.5">
            {QUICK_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => {
                  setDescription((prev) => {
                    if (prev.includes(tag)) return prev;
                    const next = `${prev.trim()} ${tag}`.trim();
                    return next.slice(0, MISSION_SHORT_DESCRIPTION_MAX);
                  });
                }}
                className="rounded-full border border-rose-400/30 bg-rose-500/10 px-2.5 py-1 text-[10px] font-bold text-rose-100"
              >
                {tag}
              </button>
            ))}
          </div>

          {error && <p className="mb-3 text-[11px] font-medium text-red-400">{error}</p>}

          <button
            type="button"
            onClick={submit}
            disabled={submitting || !photoFile}
            className="w-full rounded-full border border-rose-400/50 bg-rose-500/90 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-white shadow-[0_0_20px_rgba(244,63,94,0.35)] transition-transform active:scale-[0.98] disabled:cursor-wait disabled:opacity-50"
          >
            {submitting
              ? t('processing')
              : t('reportZoneSubmit', { defaultValue: 'Publish free report' })}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReportGarbageZoneModal;
