/**
 * Portaled full contractor storefront overlay (Profile-style glass sheet).
 * Opened from map double-tap / "Open store" — keeps the user on the map shell.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PublicStoreCard from './PublicStoreCard';

export type StoreProfileOverlayProps = {
  ownerId: string;
  onClose: () => void;
};

const StoreProfileOverlay: React.FC<StoreProfileOverlayProps> = ({
  ownerId,
  onClose,
}) => {
  const { t } = useTranslation();

  return createPortal(
    <div
      className="fixed inset-0 z-[10035] flex max-w-[100vw] items-end justify-center overflow-hidden sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('storeTab', { defaultValue: 'Store' })}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        aria-label={t('close', { defaultValue: 'Close' })}
        onClick={onClose}
      />
      <div
        className="ce-bottom-sheet relative z-[1] flex w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-violet-400/30 bg-slate-950/95 shadow-[0_-16px_48px_rgba(168,85,247,0.22)] sm:rounded-3xl"
        style={{
          maxHeight: 'min(88svh, 88dvh, 42rem)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 pb-3 pt-3">
          <div className="mx-auto h-1.5 w-14 rounded-full bg-white/15 sm:hidden" aria-hidden />
          <p className="hidden text-[10px] font-black uppercase tracking-[0.18em] text-violet-200 sm:block">
            {t('storeTab', { defaultValue: 'Store' })}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white"
            aria-label={t('close', { defaultValue: 'Close' })}
          >
            <X className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </div>
        <div className="ce-bottom-sheet-body min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <PublicStoreCard ownerId={ownerId} requirePublished showShare />
        </div>
      </div>
    </div>,
    document.body
  );
};

export default StoreProfileOverlay;
