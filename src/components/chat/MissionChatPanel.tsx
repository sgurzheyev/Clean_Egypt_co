/**
 * Phase 4 — mission-scoped P2P chat sheet (history + Realtime via useMissionChat).
 * Supports text + optional compressed photo attachments (R2 `chat/`).
 */
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Loader2, Send, X } from 'lucide-react';
import { useMissionChat } from '../../hooks/useMissionChat';
import { uploadChatPhoto } from '../../lib/chatPhotoUpload';
import { resolveChatPhotoUrl } from '../../lib/r2Media';
import { isUploadNetworkFailure } from '../../lib/offlineUploadQueue';

export type MissionChatPanelProps = {
  open: boolean;
  missionId: string;
  otherUserId: string;
  otherUserName?: string | null;
  onClose: () => void;
};

function formatChatTime(iso: string, locale: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale || 'en', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().slice(11, 16);
  }
}

const MissionChatPanel: React.FC<MissionChatPanelProps> = ({
  open,
  missionId,
  otherUserId,
  otherUserName,
  onClose,
}) => {
  const { t, i18n } = useTranslation();
  const {
    messages,
    loading,
    sending,
    error,
    currentUserId,
    sendMessage,
    markThreadRead,
  } = useMissionChat(open ? missionId : null, open ? otherUserId : null);

  const [draft, setDraft] = useState('');
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = sending || uploadingPhoto;

  useEffect(() => {
    if (!open) {
      setDraft('');
      setPendingFile(null);
      setPendingPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setLightboxUrl(null);
      setAttachError(null);
      return;
    }
    void markThreadRead();
    const tId = window.setTimeout(() => inputRef.current?.focus(), 180);
    return () => window.clearTimeout(tId);
  }, [open, markThreadRead, missionId, otherUserId]);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [open, messages.length, loading, pendingPreview]);

  useEffect(() => {
    if (!lightboxUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxUrl(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxUrl]);

  if (!open) return null;

  const titleName =
    (otherUserName || '').trim() ||
    t('publicProfileAnonymous', { defaultValue: 'Eco-Hero' });

  const clearPendingPhoto = () => {
    setPendingFile(null);
    setPendingPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onPickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      e.target.value = '';
      setAttachError(
        t('missionChatPhotoInvalid', {
          defaultValue: 'Please choose an image file.',
        })
      );
      return;
    }
    setAttachError(null);
    setPendingPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setPendingFile(file);
  };

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (busy || !currentUserId) return;
    if (!text && !pendingFile) return;

    let imageUrl: string | null = null;
    if (pendingFile) {
      setUploadingPhoto(true);
      setAttachError(null);
      try {
        imageUrl = await uploadChatPhoto({
          file: pendingFile,
          missionId,
          userId: currentUserId,
        });
      } catch (err) {
        console.error('[MissionChatPanel] photo upload failed', err);
        setAttachError(
          isUploadNetworkFailure(err)
            ? t('weakConnectionQueuedUpload', {
                defaultValue:
                  'Weak connection. Saving data — it will send automatically when the network is back.',
              })
            : t('missionChatUploadFailed', {
                defaultValue: 'Could not upload photo. Try again.',
              })
        );
        setUploadingPhoto(false);
        return;
      }
      setUploadingPhoto(false);
    }

    const sent = await sendMessage(text, imageUrl);
    if (sent) {
      setDraft('');
      clearPendingPhoto();
      setAttachError(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10080] flex items-end justify-center pointer-events-none sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('missionChatTitle', { defaultValue: 'Mission chat' })}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px] pointer-events-auto"
        aria-label={t('close')}
        onClick={onClose}
      />

      <div className="relative z-[1] flex h-[min(78dvh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-cyan-500/25 bg-slate-950 shadow-[0_-12px_48px_rgba(34,211,238,0.18)] pointer-events-auto sm:rounded-3xl sm:border-white/10">
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-400/90">
              {t('missionChatTitle', { defaultValue: 'Mission chat' })}
            </p>
            <p className="truncate text-sm font-bold text-white">{titleName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-slate-300 transition-colors hover:bg-white/10"
            aria-label={t('close')}
          >
            <X className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </div>

        <div
          ref={listRef}
          className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-width:thin]"
        >
          {loading && messages.length === 0 ? (
            <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-3 text-slate-400">
              <Loader2 className="h-7 w-7 animate-spin text-cyan-400" />
              <p className="text-xs">{t('loading')}</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full min-h-[12rem] flex-col items-center justify-center px-6 text-center">
              <p className="text-sm font-semibold text-slate-300">
                {t('missionChatEmpty', {
                  defaultValue: 'No messages yet. Start negotiating job details!',
                })}
              </p>
            </div>
          ) : (
            messages.map((m) => {
              const isMine = !!currentUserId && m.sender_id === currentUserId;
              const img = resolveChatPhotoUrl(m.image_url);
              const text = String(m.message || '').trim();
              return (
                <div
                  key={m.id}
                  className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ${
                      isMine
                        ? 'rounded-br-md border border-emerald-400/30 bg-emerald-600/85 text-white'
                        : 'rounded-bl-md border border-white/10 bg-white/10 text-slate-100'
                    }`}
                  >
                    {img ? (
                      <button
                        type="button"
                        onClick={() => setLightboxUrl(img)}
                        className="my-1 block w-full max-w-[240px] overflow-hidden rounded-xl border border-gray-800 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                        aria-label={t('missionChatOpenPhoto', {
                          defaultValue: 'Open photo',
                        })}
                      >
                        <img
                          src={img}
                          alt=""
                          loading="lazy"
                          className="h-auto w-full object-cover"
                          onLoad={() =>
                            bottomRef.current?.scrollIntoView({
                              behavior: 'smooth',
                              block: 'end',
                            })
                          }
                        />
                      </button>
                    ) : null}
                    {text ? (
                      <p className="whitespace-pre-wrap break-words">{text}</p>
                    ) : null}
                    <p
                      className={`mt-1 text-[9px] font-medium uppercase tracking-[0.08em] ${
                        isMine ? 'text-emerald-100/70' : 'text-slate-500'
                      }`}
                    >
                      {formatChatTime(m.created_at, i18n.language)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {(error || attachError) && (
          <p className="border-t border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-300">
            {attachError || error}
          </p>
        )}

        {pendingPreview && (
          <div className="flex items-center gap-2 border-t border-white/10 bg-slate-900/90 px-3 py-2">
            <div className="relative h-14 w-14 overflow-hidden rounded-xl border border-gray-800">
              <img src={pendingPreview} alt="" className="h-full w-full object-cover" />
            </div>
            <p className="min-w-0 flex-1 truncate text-[11px] text-slate-400">
              {t('missionChatPhotoReady', {
                defaultValue: 'Photo ready to send',
              })}
            </p>
            <button
              type="button"
              onClick={clearPendingPhoto}
              disabled={busy}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/5 text-slate-300 hover:bg-white/10 disabled:opacity-40"
              aria-label={t('missionChatRemovePhoto', {
                defaultValue: 'Remove photo',
              })}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <form
          onSubmit={(e) => void onSubmit(e)}
          className="flex items-end gap-2 border-t border-white/10 bg-slate-950/95 px-3 py-3 pb-safe-sm"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onPickPhoto}
            disabled={busy || !currentUserId}
          />
          <button
            type="button"
            disabled={busy || !currentUserId}
            onClick={() => fileInputRef.current?.click()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-400/25 bg-black/60 text-cyan-300/90 shadow-[0_0_14px_rgba(34,211,238,0.12)] backdrop-blur-md transition-all hover:border-cyan-400/50 hover:bg-white/5 hover:text-cyan-200 hover:shadow-[0_0_18px_rgba(34,211,238,0.28)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
            aria-label={t('missionChatAttachPhoto', {
              defaultValue: 'Attach photo',
            })}
            title={t('missionChatAttachPhoto', {
              defaultValue: 'Attach photo',
            })}
          >
            <ImagePlus className="h-4 w-4" strokeWidth={2.25} />
          </button>
          <input
            ref={inputRef}
            type="text"
            value={draft}
            disabled={busy || !currentUserId}
            maxLength={4000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void onSubmit();
              }
            }}
            placeholder={t('missionChatPlaceholder', {
              defaultValue: 'Type a message…',
            })}
            className="min-h-[44px] min-w-0 flex-1 rounded-2xl border border-white/12 bg-white/5 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400/40 focus:ring-1 focus:ring-cyan-500/30 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || (!draft.trim() && !pendingFile) || !currentUserId}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-400/35 bg-cyan-600/90 text-white shadow-[0_4px_16px_rgba(34,211,238,0.25)] transition-all hover:bg-cyan-500/95 active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
            aria-label={t('missionChatSend', { defaultValue: 'Send' })}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" strokeWidth={2.25} />
            )}
          </button>
        </form>
      </div>

      {lightboxUrl && (
        <div className="pointer-events-auto fixed inset-0 z-[10090] flex items-center justify-center bg-black/90 p-4">
          <button
            type="button"
            className="absolute inset-0 cursor-zoom-out"
            aria-label={t('close')}
            onClick={() => setLightboxUrl(null)}
          />
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-[1] flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white backdrop-blur-md"
            aria-label={t('close')}
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightboxUrl}
            alt=""
            className="relative z-[1] max-h-[90dvh] max-w-full rounded-xl object-contain shadow-[0_0_40px_rgba(0,0,0,0.6)]"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};

export default MissionChatPanel;
