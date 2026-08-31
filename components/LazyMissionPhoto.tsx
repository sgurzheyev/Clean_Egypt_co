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
 *   4. Remembers successfully loaded URLs in a module Set so virtualized
 *      remounts skip the skeleton (no flicker on scroll recycle).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { resolveMissionPhotoUrl } from '../src/lib/r2Media';

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

/** URLs that have already decoded successfully this session — survives Virtuoso remounts. */
const loadedMissionPhotoUrls = new Set<string>();

function markPhotoLoaded(url: string) {
  if (url) loadedMissionPhotoUrls.add(url);
}

function isPhotoCached(url: string): boolean {
  return Boolean(url) && loadedMissionPhotoUrls.has(url);
}

const LazyMissionPhoto: React.FC<LazyMissionPhotoProps> = ({
  src,
  alt = '',
  className = '',
  imgClassName = 'h-full w-full object-cover',
  loading = 'lazy',
  onLoad,
  draggable = false,
}) => {
  // R2 object keys → public CDN URL; legacy Supabase https URLs pass through.
  const resolvedSrc = useMemo(
    () => resolveMissionPhotoUrl(typeof src === 'string' ? src : String(src ?? '')),
    [src]
  );
  const rawSrc = typeof src === 'string' ? src : '';
  const isValid =
    typeof resolvedSrc === 'string' &&
    resolvedSrc.length > 0 &&
    !rawSrc.startsWith('censored://');

  const [loaded, setLoaded] = useState(() => isValid && isPhotoCached(resolvedSrc));
  const [error, setError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Sync with module cache / browser decode cache when src changes or cell remounts.
  useEffect(() => {
    if (!isValid) {
      setLoaded(false);
      setError(false);
      return;
    }
    if (isPhotoCached(resolvedSrc)) {
      setLoaded(true);
      setError(false);
      return;
    }
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) {
      markPhotoLoaded(resolvedSrc);
      setLoaded(true);
      setError(false);
      return;
    }
    setLoaded(false);
    setError(false);
  }, [resolvedSrc, isValid]);

  if (!isValid) {
    return (
      <div className={`relative overflow-hidden ${className}`} aria-hidden>
        <img src={FALLBACK_SVG} alt="" className={imgClassName} draggable={false} />
      </div>
    );
  }

  const showSkeleton = !loaded && !error;

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
      }}
    >
      <img
        ref={imgRef}
        src={resolvedSrc}
        alt={alt}
        draggable={draggable}
        loading={isPhotoCached(resolvedSrc) ? 'eager' : loading}
        decoding="async"
        className={imgClassName}
        style={{
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
        }}
        onLoad={() => {
          markPhotoLoaded(resolvedSrc);
          setLoaded(true);
          setError(false);
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

      {/* Skeleton only on first decode — never on Virtuoso recycle of a known URL. */}
      {showSkeleton && (
        <div
          aria-hidden
          className="skeleton-shimmer pointer-events-none absolute inset-0 overflow-hidden"
          style={{
            background:
              'linear-gradient(135deg, rgba(15,17,24,0.92) 0%, rgba(22,30,40,0.88) 100%)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
            transform: 'translateZ(0)',
            backfaceVisibility: 'hidden',
          }}
        >
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage:
                'linear-gradient(rgba(34,211,238,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.08) 1px, transparent 1px)',
              backgroundSize: '28px 28px',
            }}
          />
          <div
            className="skeleton-sweep absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(34,211,238,0.07) 40%, rgba(192,38,255,0.06) 60%, transparent 100%)',
            }}
          />
          <span className="absolute right-3 top-3 h-1.5 w-1.5 animate-ping rounded-full bg-cyan-400/50" />
        </div>
      )}
    </div>
  );
};

export default LazyMissionPhoto;
