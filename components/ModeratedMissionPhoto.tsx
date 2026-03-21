import React from 'react';
import { isCensoredMissionPhotoUrl } from '../src/lib/missionPhotoModeration';

type Props = {
  url: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  /** Show green waste-style check on safe photos */
  showSafeBadge?: boolean;
  /** Censored: allow creator to remove slot */
  canDelete?: boolean;
  onDeleteCensored?: () => void | Promise<void>;
  deleting?: boolean;
};

/**
 * Renders a mission photo: real image + optional safe badge, or censored placeholder + delete.
 */
const ModeratedMissionPhoto: React.FC<Props> = ({
  url,
  alt,
  className = '',
  imgClassName = 'w-full h-48 object-cover rounded-xl shadow-md bg-slate-800',
  showSafeBadge = true,
  canDelete = false,
  onDeleteCensored,
  deleting = false,
}) => {
  const censored = isCensoredMissionPhotoUrl(url);

  if (censored) {
    return (
      <div className={`relative h-full min-h-[12rem] overflow-hidden rounded-xl ${className}`}>
        <div className="relative flex h-full min-h-[12rem] w-full flex-col items-center justify-center bg-black px-4 py-8">
          <p className="text-center text-sm font-bold text-white">Sexual photo forbidden 🙈</p>
          {canDelete && onDeleteCensored && (
            <button
              type="button"
              disabled={deleting}
              onClick={(e) => {
                e.stopPropagation();
                void onDeleteCensored();
              }}
              className="absolute right-2 top-2 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-lg font-black text-white shadow-lg ring-2 ring-red-400/50 transition hover:bg-red-500 hover:scale-105 disabled:opacity-50"
              aria-label="Remove censored slot"
              title="Remove"
            >
              ×
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <img
        src={url}
        alt={alt}
        className={imgClassName}
        onError={(e) => {
          const el = e.currentTarget;
          el.onerror = null;
          el.src =
            'data:image/svg+xml,' +
            encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><rect fill="%23334155" width="400" height="200"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%2394a3b8" font-size="14" font-family="system-ui">Image unavailable</text></svg>'
            );
          el.classList.add('object-contain');
        }}
      />
      {showSafeBadge && (
        <span
          className="pointer-events-none absolute left-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/90 text-base shadow-[0_0_12px_rgba(16,185,129,0.85)] ring-2 ring-emerald-300/60 animate-moderation-safe-pulse"
          aria-hidden
          title="Verified"
        >
          ✔️
        </span>
      )}
    </div>
  );
};

export default ModeratedMissionPhoto;
