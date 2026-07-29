import React from 'react';
import LazyMissionPhoto from './LazyMissionPhoto';

type Props = {
  url: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  /** Show green verification checkmark on uploaded photos */
  showSafeBadge?: boolean;
};

/**
 * Renders a mission photo with lazy loading, glassmorphism skeleton,
 * and an optional green verification checkmark badge.
 */
const ModeratedMissionPhoto: React.FC<Props> = ({
  url,
  alt,
  className = '',
  imgClassName = 'w-full h-48 object-cover rounded-xl shadow-md bg-slate-800',
  showSafeBadge = true,
}) => (
  <div className={`relative ${className}`}>
    <LazyMissionPhoto
      src={url}
      alt={alt}
      imgClassName={imgClassName}
      loading="lazy"
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

export default ModeratedMissionPhoto;
