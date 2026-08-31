/**
 * Viral 9:16 cyberpunk Impact Card for completed missions (Stories share).
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Download, Share2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toPng } from 'html-to-image';
import { extractMissionFeedDescription } from '../src/lib/missionDescription';
import { missionSector } from '../src/lib/serviceSectors';
import { firstStoredMediaUrl, resolveMissionPhotoUrl } from '../src/lib/r2Media';

export type ImpactCardMission = {
  id: string;
  category?: string | null;
  service_type?: string | null;
  description?: string | null;
  photo_urls?: string[] | null;
  after_photo_urls?: string[] | null;
  location_lat?: number;
  location_lng?: number;
};

type Props = {
  open: boolean;
  mission: ImpactCardMission;
  locationLabel: string;
  serviceLabel: string;
  onClose: () => void;
};

function fileFromDataUrl(dataUrl: string, filename: string): File {
  const [header, data] = dataUrl.split(',');
  const mime = /data:(.*?);/.exec(header)?.[1] || 'image/png';
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

const ImpactCardModal: React.FC<Props> = ({
  open,
  mission,
  locationLabel,
  serviceLabel,
  onClose,
}) => {
  const { t, i18n } = useTranslation();
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const beforeUrl = useMemo(() => {
    const raw = firstStoredMediaUrl(mission.photo_urls);
    return raw ? resolveMissionPhotoUrl(raw) : null;
  }, [mission.photo_urls]);
  const afterUrl = useMemo(() => {
    const raw = firstStoredMediaUrl(mission.after_photo_urls);
    return raw ? resolveMissionPhotoUrl(raw) : null;
  }, [mission.after_photo_urls]);
  const hasSplit = !!(beforeUrl && afterUrl);
  const heroUrl = afterUrl || beforeUrl;
  const isHome = missionSector(mission.service_type, mission.category) === 'home';
  const tagline =
    extractMissionFeedDescription(mission.description)?.slice(0, 80) || locationLabel;
  const isRu = String(i18n.language || '').toLowerCase().startsWith('ru');

  const renderPng = useCallback(async () => {
    const node = cardRef.current;
    if (!node) throw new Error('Card not ready');
    return toPng(node, {
      cacheBust: true,
      pixelRatio: 2,
      quality: 1,
      backgroundColor: '#0A0A12',
    });
  }, []);

  const handleDownload = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await renderPng();
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `Garbagin-Impact-${mission.id.slice(0, 8)}.png`;
      a.click();
    } catch (err: any) {
      console.warn('[ImpactCard] download failed', err);
      setError(
        err?.message ||
          t('impactCardExportFailed', { defaultValue: 'Could not export the card.' })
      );
    } finally {
      setBusy(false);
    }
  };

  const handleShare = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await renderPng();
      const file = fileFromDataUrl(dataUrl, `Garbagin-Impact-${mission.id.slice(0, 8)}.png`);
      const shareData: ShareData = {
        title: 'Garbagin Impact',
        text: t('impactCardShareText', {
          defaultValue: 'I made this city cleaner on Garbagin — join me!',
        }),
        files: [file],
      };

      if (typeof navigator !== 'undefined' && navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
        return;
      }
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          await navigator.share({
            title: shareData.title,
            text: `${shareData.text}\nhttps://garbagin.com`,
          });
          return;
        } catch (shareErr: any) {
          if (shareErr?.name === 'AbortError') return;
        }
      }

      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `Garbagin-Impact-${mission.id.slice(0, 8)}.png`;
      a.click();
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.warn('[ImpactCard] share failed', err);
      setError(
        err?.message ||
          t('impactCardExportFailed', { defaultValue: 'Could not export the card.' })
      );
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-[10085] flex items-end justify-center pointer-events-auto sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
        aria-label={t('close')}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('impactCardTitle', { defaultValue: 'Share Impact Card' })}
        className="ce-bottom-sheet relative z-[1] flex w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-cyan-500/25 bg-[#020617]/98 shadow-[0_-20px_60px_rgba(34,211,238,0.2)] sm:rounded-3xl"
        style={{ maxHeight: 'min(85svh, 85dvh, 40rem)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-300">
            {t('impactCardTitle', { defaultValue: 'Share Impact Card' })}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-slate-200 active:scale-95"
            aria-label={t('close')}
          >
            <X className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </div>

        <div className="ce-bottom-sheet-body min-h-0 flex-1 px-4 py-4">
          {/* Preview — capture target */}
          <div
            ref={cardRef}
            className="relative mx-auto flex aspect-[9/16] w-full max-w-sm flex-col justify-between overflow-hidden rounded-3xl border border-cyan-500/30 bg-[#0A0A12] shadow-2xl"
          >
            {hasSplit ? (
              <div className="absolute inset-0 flex flex-col">
                <div className="relative min-h-0 flex-1 overflow-hidden">
                  <img
                    src={beforeUrl!}
                    alt=""
                    crossOrigin="anonymous"
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                  <span className="absolute left-3 top-3 rounded-full border border-white/25 bg-black/55 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-white backdrop-blur-sm">
                    {isRu ? 'ДО' : 'BEFORE'}
                  </span>
                </div>
                <div className="relative z-[1] h-1 shrink-0 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_18px_rgba(34,211,238,0.85)]" />
                <div className="relative min-h-0 flex-1 overflow-hidden">
                  <img
                    src={afterUrl!}
                    alt=""
                    crossOrigin="anonymous"
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                  <span className="absolute left-3 top-3 rounded-full border border-emerald-300/40 bg-emerald-600/70 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-white backdrop-blur-sm">
                    {isRu ? 'ПОСЛЕ' : 'AFTER'}
                  </span>
                </div>
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-[#0A0A12]" />
              </div>
            ) : (
              <div className="absolute inset-0">
                {heroUrl ? (
                  <img
                    src={heroUrl}
                    alt=""
                    crossOrigin="anonymous"
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <div className="h-full w-full bg-gradient-to-br from-cyan-900/50 via-slate-950 to-emerald-950" />
                )}
                <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/25 to-[#0A0A12]" />
              </div>
            )}

            <div className="relative z-10 flex items-start justify-between gap-2 p-4 pt-5">
              <div>
                <p className="text-sm font-black tracking-[0.08em] text-white drop-shadow-[0_0_12px_rgba(34,211,238,0.45)]">
                  Garbagin
                </p>
                <span className="mt-2 inline-flex rounded-full border border-cyan-400/50 bg-cyan-500/20 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-cyan-100 shadow-[0_0_14px_rgba(34,211,238,0.35)] backdrop-blur-sm">
                  {t('impactCardBadge', { defaultValue: 'Mission Completed' })}
                </span>
              </div>
              <span
                className={`rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] backdrop-blur-sm ${
                  isHome
                    ? 'border-amber-400/45 bg-amber-500/25 text-amber-100'
                    : 'border-emerald-400/45 bg-emerald-500/25 text-emerald-100'
                }`}
              >
                {serviceLabel}
              </span>
            </div>

            <div className="relative z-10 space-y-3 p-4 pb-5">
              <p className="line-clamp-2 text-xs font-medium leading-snug text-slate-200/95">
                📍 {locationLabel}
              </p>
              {tagline && tagline !== locationLabel && (
                <p className="line-clamp-2 text-[11px] leading-relaxed text-slate-300/90">{tagline}</p>
              )}
              <p className="text-[15px] font-black leading-tight tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.65)]">
                {t('impactCardHeadline', {
                  defaultValue: 'I made this city cleaner! Become a hero too on Garbagin',
                })}
              </p>
              <div className="rounded-2xl border border-cyan-400/35 bg-black/55 px-3 py-2.5 text-center backdrop-blur-md">
                <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-200">
                  GARBAGIN.COM
                </p>
              </div>
            </div>
          </div>

          {error && (
            <p className="mt-3 text-center text-[11px] font-medium text-red-400">{error}</p>
          )}
        </div>

        <div className="ce-bottom-sheet-footer shrink-0 space-y-2 border-t border-white/10 bg-[#020617] px-4 pt-3">
          <button
            type="button"
            onClick={handleShare}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-cyan-400/45 bg-cyan-500/90 py-3 text-[11px] font-black uppercase tracking-[0.16em] text-slate-950 shadow-[0_0_20px_rgba(34,211,238,0.3)] transition-transform active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
          >
            <Share2 className="h-4 w-4" strokeWidth={2.5} />
            {busy
              ? t('processing')
              : t('impactCardShare', { defaultValue: '📱 Share' })}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 py-3 text-[11px] font-black uppercase tracking-[0.16em] text-slate-100 transition-transform active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
          >
            <Download className="h-4 w-4" strokeWidth={2.5} />
            {t('impactCardDownload', { defaultValue: '💾 Download PNG' })}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImpactCardModal;
