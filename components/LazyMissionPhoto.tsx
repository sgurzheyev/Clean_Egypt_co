/**
 * LazyMissionPhoto — lazy-loading image with glassmorphism pulse skeleton.
 * Replaces plain <img> in all mission photo display sites:
 *   • ModeratedMissionPhoto
 *   • MissionFeedCard (photoUrl path)
 *   • ImmersiveMissionFeed slides
 *
 * Key behaviours:
 *   1. Shows an animated glassmorphism skeleton until the image is decoded.
 *   2. Uses native `loading="lazy"` to defer off-screen network requests.
 *   3. Falls back gracefully to a styled placeholder on network / decode errors.
 *   4. Skeleton dims out with a CSS transition; no layout shift (absolute overlay).
 */
import React, { useEffect, useRef, useState } from 'react';

export type LazyMissionPhotoProps = {
  src: string;
  alt?: string;
  className?: string;
  /** CSS class for the inner <img> (size + fit). Defaults to full-size object-cover. */
  imgClassName?: string;
  /** Render strategy passed to <img loading>. Default: "lazy". */
  loading?: 'lazy' | 'eager';
  /** Fired after the image loads. */
  onLoad?: () => void;
  draggable?: boolean;
};

const FALLBACK_SVG =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">' +
      '<rect fill="%230f1117" width="400" height="300"/>' +
      '<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%2394a3b8" font-size="13" font-family="system-ui">Image unavailable</text>' +
      '</svg>'
  );

const LazyMissionPhoto: React.FC<LazyMissionPhotoProps> = ({
  src,
  alt = '',
  className = '',
  imgClassName = 'h-full w-full object-cover',
  loading = 'lazy',
  onLoad,
  draggable = false,
}) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // If src is empty / invalid, skip to fallback immediately.
  const isValid =
    typeof src === 'string' && src.length > 0 && !src.startsWith('censored://');

  // If the image is already in the browser cache it might be decoded before the
  // React effect fires — check naturalWidth synchronously after mount.
  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    if (el.complete && el.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [src]);

  if (!isValid) {
    return (
      <div
        className={`relative overflow-hidden ${className}`}
        aria-hidden
      >
        <img src={FALLBACK_SVG} alt="" className={imgClassName} draggable={false} />
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={draggable}
        loading={loading}
        decoding="async"
        className={imgClassName}
        onLoad={() => {
          setLoaded(true);
          onLoad?.();
        }}
        onError={() => {
          setError(true);
          setLoaded(true);
          const el = imgRef.current;
          if (el) {
            el.src = FALLBACK_SVG;
            el.classList.add('object-contain');
          }
        }}
      />

      {/* Glassmorphism skeleton — sits above the image until decoded, then fades. */}
      {!loaded && !error && (
        <div
          aria-hidden
          className="skeleton-shimmer pointer-events-none absolute inset-0 overflow-hidden"
          style={{
            background:
              'linear-gradient(135deg, rgba(15,17,24,0.92) 0%, rgba(22,30,40,0.88) 100%)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
          }}
        >
          {/* Faint neon grid */}
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage:
                'linear-gradient(rgba(34,211,238,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.08) 1px, transparent 1px)',
              backgroundSize: '28px 28px',
            }}
          />
          {/* Shimmer sweep via inline keyframe */}
          <div
            className="skeleton-sweep absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(34,211,238,0.07) 40%, rgba(192,38,255,0.06) 60%, transparent 100%)',
            }}
          />
          {/* Corner pulse dot */}
          <span className="absolute right-3 top-3 h-1.5 w-1.5 animate-ping rounded-full bg-cyan-400/50" />
        </div>
      )}
    </div>
  );
};

export default LazyMissionPhoto;
