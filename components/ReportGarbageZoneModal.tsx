/**
 * Lightweight "Report Garbage Zone" sheet — up to 5 photos.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Camera, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MISSION_SHORT_DESCRIPTION_MAX } from '../src/lib/missionDescription';
import {
  MAX_GARBAGE_ZONE_REPORT_PHOTOS,
  createGarbageZoneReport,
} from '../src/lib/garbageZoneReport';
import { reverseGeocodePinLocation } from '../src/lib/mapboxReverseGeocode';
import {
  BOTTOM_SHEET_FOOTER_PB,
  BOTTOM_SHEET_MAX_HEIGHT_STYLE,
  STEEL_GLASS_PANEL,
  STEEL_GLASS_PANEL_STYLE,
} from '../constants';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

const QUICK_TAGS = ['#BeachTrash', '#DumpingGround', '#StreetLitter', '#HazardZone'] as const;

type PhotoItem = {
  id: string;
  file: File;
  previewUrl: string;
};

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
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  if (!open) return null;

  const showToast = (message: string) => {
    setToastMsg(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMsg(null), 2800);
  };

  const resetLocal = () => {
    photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setPhotos([]);
    setDescription('');
    setError(null);
    setSubmitting(false);
    setToastMsg(null);
  };

  const handleClose = () => {
    resetLocal();
    onClose();
  };

  const onPickPhotos = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const incoming = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    if (incoming.length === 0) return;

    const room = Math.max(0, MAX_GARBAGE_ZONE_REPORT_PHOTOS - photos.length);
    if (room <= 0 || incoming.length > room) {
      showToast(
        t('reportZonePhotoMax', {
          defaultValue: 'Maximum 5 photos for free reports',
        })
      );
    }
    if (room <= 0) return;

    const accepted = incoming.slice(0, room);
    const next: PhotoItem[] = accepted.map((file) => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setPhotos((prev) => [...prev, ...next].slice(0, MAX_GARBAGE_ZONE_REPORT_PHOTOS));
    setError(null);
  };

  const removePhoto = (id: string) => {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const submit = async () => {
    if (submitting) return;
    if (photos.length < 1) {
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
      const geo = await reverseGeocodePinLocation(safeLat, safeLng, MAPBOX_TOKEN);
      const id = await createGarbageZoneReport({
        lat: safeLat,
        lng: safeLng,
        description,
        photoFiles: photos.map((p) => p.file).slice(0, MAX_GARBAGE_ZONE_REPORT_PHOTOS),
        country: geo?.country ?? null,
        city: geo?.city ?? null,
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

  const canAddMore = photos.length < MAX_GARBAGE_ZONE_REPORT_PHOTOS;

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
        className={`ce-bottom-sheet relative z-[1] w-full max-w-md rounded-t-2xl border-t border-rose-400/30 shadow-[0_-16px_48px_rgba(244,63,94,0.22)] ${STEEL_GLASS_PANEL}`}
        style={{ ...STEEL_GLASS_PANEL_STYLE, ...BOTTOM_SHEET_MAX_HEIGHT_STYLE }}
        onClick={(e) => e.stopPropagation()}
      >
        {toastMsg && (
          <div
            role="status"
            className="absolute left-3 right-3 top-3 z-20 rounded-xl border border-rose-400/40 bg-rose-950/95 px-3 py-2 text-center text-[11px] font-semibold text-rose-100 shadow-[0_8px_24px_rgba(244,63,94,0.35)] backdrop-blur-md"
          >
            {toastMsg}
          </div>
        )}

        <div className="ce-bottom-sheet-body p-4 pb-3">
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

          {photos.length === 0 ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mb-1 flex w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-dashed border-rose-400/40 bg-rose-500/10 py-6 text-rose-100 transition-colors hover:bg-rose-500/15 active:scale-[0.99]"
            >
              <Camera className="h-6 w-6" strokeWidth={2.25} />
              <span className="text-[10px] font-black uppercase tracking-[0.16em]">
                {t('reportZoneAddPhoto', { defaultValue: 'Add photos' })}
              </span>
            </button>
          ) : (
            <div className="mb-1">
              <div className="grid grid-cols-3 gap-2">
                {photos.map((photo, index) => (
                  <div
                    key={photo.id}
                    className="relative aspect-square overflow-hidden rounded-xl border border-rose-400/30 bg-black/40"
                  >
                    <img
                      src={photo.previewUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-white/90">
                      {index + 1}/{photos.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => removePhoto(photo.id)}
                      className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full border border-white/25 bg-black/70 text-white active:scale-95"
                      aria-label={t('close')}
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </button>
                  </div>
                ))}
                {canAddMore ? (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-rose-400/40 bg-rose-500/10 text-rose-100 transition-colors hover:bg-rose-500/15 active:scale-[0.98]"
                    aria-label={t('reportZoneAddPhoto', { defaultValue: 'Add photos' })}
                  >
                    <Plus className="h-5 w-5" strokeWidth={2.25} />
                    <span className="text-[9px] font-black uppercase tracking-[0.12em]">
                      {t('reportZoneAddPhoto', { defaultValue: 'Add' })}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      showToast(
                        t('reportZonePhotoMax', {
                          defaultValue: 'Maximum 5 photos for free reports',
                        })
                      )
                    }
                    className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-white/5 bg-white/5 text-gray-500 opacity-60"
                    aria-label={t('reportZonePhotoMax', {
                      defaultValue: 'Maximum 5 photos for free reports',
                    })}
                  >
                    <Plus className="h-5 w-5" strokeWidth={2.25} />
                    <span className="text-[9px] font-black uppercase tracking-[0.12em]">5/5</span>
                  </button>
                )}
              </div>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              onPickPhotos(e.target.files);
              e.target.value = '';
            }}
          />
          <p className="mb-3 mt-1.5 text-center text-[10px] font-medium text-slate-500">
            {t('reportZonePhotoHint', { defaultValue: 'Up to 5 photos' })}
            {photos.length > 0
              ? ` · ${photos.length}/${MAX_GARBAGE_ZONE_REPORT_PHOTOS}`
              : ''}
          </p>

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
          <div className="mb-2 flex flex-wrap gap-1.5">
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

          {error && <p className="mb-1 text-[11px] font-medium text-red-400">{error}</p>}
        </div>

        <div
          className={`ce-bottom-sheet-footer border-t border-white/10 px-4 pt-3 ${BOTTOM_SHEET_FOOTER_PB}`}
          style={STEEL_GLASS_PANEL_STYLE}
        >
          <button
            type="button"
            onClick={submit}
            disabled={submitting || photos.length < 1}
            className="w-full rounded-full border border-rose-400/50 bg-rose-500/90 py-3.5 text-[11px] font-black uppercase tracking-[0.18em] text-white shadow-[0_0_20px_rgba(244,63,94,0.35)] transition-transform active:scale-[0.98] disabled:cursor-wait disabled:opacity-50"
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
