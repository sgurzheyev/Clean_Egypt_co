/**
 * Dark cyberpunk fallback when a mission feed / marketplace tree crashes.
 * Prefer full reload for OOM-class failures; also expose soft retry.
 */
import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ErrorBoundary, { type ErrorBoundaryFallbackProps } from './ErrorBoundary';

export type MissionFeedErrorBoundaryProps = {
  children: React.ReactNode;
  /** Remount / clear error when these change (e.g. open flag, startMissionId). */
  resetKeys?: readonly unknown[];
  /** Optional close when shown as a full-screen overlay. */
  onClose?: () => void;
  /** compact = inline sheet; fullscreen = covers viewport (immersive). */
  variant?: 'fullscreen' | 'sheet';
};

function MissionFeedCrashFallback({
  reset,
  onClose,
  variant,
}: ErrorBoundaryFallbackProps & {
  onClose?: () => void;
  variant: 'fullscreen' | 'sheet';
}) {
  const { t } = useTranslation();

  const isFullscreen = variant === 'fullscreen';

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-[10050] flex items-center justify-center bg-[#05060a] p-6'
          : 'fixed inset-0 z-[150] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4'
      }
      role="alert"
      aria-live="assertive"
    >
      <div
        className={
          isFullscreen
            ? 'relative z-[1] flex max-w-sm flex-col items-center gap-4 text-center'
            : 'relative z-[1] flex w-full max-w-xl flex-col items-center gap-4 rounded-t-2xl border-t border-white/10 bg-[#0A0A12] px-6 py-10 text-center shadow-[0_-12px_40px_rgba(0,0,0,0.45)] sm:rounded-2xl sm:border'
        }
      >
        {!isFullscreen && (
          <div className="mx-auto h-1 w-12 rounded-full bg-white/20" aria-hidden />
        )}
        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-rose-400/40 bg-rose-500/10 text-rose-300 shadow-[0_0_20px_rgba(244,63,94,0.25)]">
          <AlertTriangle className="h-6 w-6" aria-hidden />
        </span>
        <p className="text-sm font-semibold leading-relaxed text-slate-200">
          {t('feedDisplayError', {
            defaultValue: 'Feed display error. Try reloading the page.',
          })}
        </p>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => {
              try {
                window.location.reload();
              } catch {
                reset();
              }
            }}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-cyan-400/50 bg-cyan-500/15 px-5 py-2.5 text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100 shadow-[0_0_16px_rgba(34,211,238,0.25)] transition-transform active:scale-95"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {t('feedDisplayErrorRefresh', { defaultValue: 'Refresh' })}
          </button>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-[11px] font-black uppercase tracking-[0.16em] text-slate-300 transition-colors hover:bg-white/10"
          >
            {t('feedDisplayErrorRetry', { defaultValue: 'Try again' })}
          </button>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 hover:text-slate-300"
          >
            {t('close', { defaultValue: 'Close' })}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Wraps Service Marketplace / Immersive feed trees so a render crash shows a
 * recovery UI instead of a blank white screen.
 */
const MissionFeedErrorBoundary: React.FC<MissionFeedErrorBoundaryProps> = ({
  children,
  resetKeys,
  onClose,
  variant = 'fullscreen',
}) => (
  <ErrorBoundary
    resetKeys={resetKeys}
    onError={(error) => {
      console.error('[MissionFeed] render crash (WSOD guard):', error);
    }}
    fallback={({ error, reset }) => (
      <MissionFeedCrashFallback
        error={error}
        reset={reset}
        onClose={onClose}
        variant={variant}
      />
    )}
  >
    {children}
  </ErrorBoundary>
);

export default MissionFeedErrorBoundary;
