import React from 'react';
import { MapPin } from 'lucide-react';
import TranslatableMissionDescription from './TranslatableMissionDescription';
import { useMissionTextTranslation } from '../src/hooks/useMissionTextTranslation';
import {
  missionFeedPlaceholderGradient,
  type MissionFeedPlaceholderVariant,
} from '../src/lib/missionFeedVisuals';
import LazyMissionPhoto from './LazyMissionPhoto';

export type { MissionFeedPlaceholderVariant };

export interface MissionFeedCardProps {
  photo?: React.ReactNode;
  photoUrl?: string | null;
  placeholderVariant?: MissionFeedPlaceholderVariant;
  placeholderIcon?: string;
  budgetValue: string;
  locationLine?: string;
  /** Short description with smart hashtags (rendered below location). */
  description?: string;
  statusBadge?: React.ReactNode;
  topLeftBadge?: React.ReactNode;
  /** Prominent urgency / social-proof line under the main card content. */
  callout?: React.ReactNode;
  metaLine?: string;
  /** Human-readable submission time, e.g. "Submitted: 2 hours ago". */
  submittedLabel?: string;
  footer?: React.ReactNode;
  highlighted?: boolean;
  onClick?: () => void;
  /** Tap on the photo area itself (e.g. enter the Immersive Visual Feed). */
  onPhotoClick?: () => void;
  photoAriaLabel?: string;
  onLocate?: () => void;
  locateAriaLabel?: string;
  /** Creator avatar URL (falls back to letter placeholder). */
  creatorAvatarUrl?: string | null;
  /** Creator name/label — used for the avatar fallback letter + aria label. */
  creatorName?: string | null;
  /** Click handler for the creator avatar (e.g. navigate to public profile). */
  onCreatorClick?: () => void;
  creatorAriaLabel?: string;
  /** Zero-KYC trust badges for the creator (when they have a contractor store). */
  trustBadges?: React.ReactNode;
}

const MissionFeedCard: React.FC<MissionFeedCardProps> = ({
  photo,
  photoUrl,
  placeholderVariant = 'default',
  placeholderIcon,
  budgetValue,
  locationLine,
  description,
  statusBadge,
  topLeftBadge,
  callout,
  metaLine,
  submittedLabel,
  footer,
  highlighted = false,
  onClick,
  onPhotoClick,
  photoAriaLabel,
  onLocate,
  locateAriaLabel = 'Locate on map',
  creatorAvatarUrl,
  creatorName,
  onCreatorClick,
  creatorAriaLabel = 'View creator profile',
  trustBadges,
}) => {
  const locationTranslation = useMissionTextTranslation(locationLine);
  const showLocate = !!(onLocate || onClick);
  // Show the creator avatar whenever we have identity info — click is optional.
  const showCreator = !!(onCreatorClick || creatorAvatarUrl || creatorName);
  const creatorInitial = (creatorName || '?').trim().charAt(0).toUpperCase() || '?';

  const handleLocate = (e: React.MouseEvent) => {
    e.stopPropagation();
    (onLocate ?? onClick)?.();
  };

  const handleCreator = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCreatorClick?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!onClick) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <article
      className={`w-full overflow-hidden rounded-xl ${
        highlighted ? 'ring-1 ring-emerald-400/45' : ''
      }`}
      style={{
        transform: 'translateZ(0)',
        willChange: 'transform, opacity',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
      }}
    >
      <div
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={onClick}
        onKeyDown={handleKeyDown}
        className={`w-full text-left ${onClick ? 'cursor-pointer' : ''}`}
      >
        <div
          className="relative aspect-[4/3] w-full touch-pan-y overflow-hidden rounded-xl bg-slate-900 sm:aspect-video"
          onClick={
            onPhotoClick
              ? (e) => {
                  e.stopPropagation();
                  onPhotoClick();
                }
              : undefined
          }
          aria-label={onPhotoClick ? photoAriaLabel : undefined}
        >
          {photo ? (
            <div className="pointer-events-none absolute inset-0 select-none [&_img]:h-full [&_img]:w-full [&_img]:object-cover">
              {photo}
            </div>
          ) : photoUrl ? (
            <LazyMissionPhoto
              src={photoUrl}
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full"
              imgClassName="h-full w-full select-none object-cover"
              loading="lazy"
            />
          ) : (
            <div
              className={`pointer-events-none flex h-full w-full select-none items-center justify-center ${missionFeedPlaceholderGradient(
                placeholderVariant
              )}`}
            >
              {placeholderIcon ? (
                <span className="text-3xl opacity-90" aria-hidden>
                  {placeholderIcon}
                </span>
              ) : (
                <span className="text-[10px] font-black uppercase tracking-[0.28em] text-white/35">
                  Garbagin
                </span>
              )}
            </div>
          )}

          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-black/5"
            aria-hidden
          />

          {topLeftBadge && (
            <div className="pointer-events-none absolute left-2.5 top-2.5 z-10 flex max-w-[70%] flex-wrap gap-1.5">
              {topLeftBadge}
            </div>
          )}

          <div className="absolute right-2.5 top-2.5 z-10 flex flex-col items-center gap-2">
            {showLocate && (
              <button
                type="button"
                onClick={handleLocate}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/25 bg-black/55 text-cyan-200 shadow-lg backdrop-blur-md transition-transform hover:bg-black/70 active:scale-95"
                aria-label={locateAriaLabel}
              >
                <MapPin className="h-4 w-4" strokeWidth={2.25} />
              </button>
            )}
            {showCreator && (
              <button
                type="button"
                onClick={handleCreator}
                disabled={!onCreatorClick}
                className={`flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-emerald-300/50 bg-black/55 text-emerald-100 shadow-lg backdrop-blur-md transition-transform ${
                  onCreatorClick
                    ? 'hover:border-emerald-200/80 active:scale-95'
                    : 'cursor-default'
                }`}
                aria-label={creatorAriaLabel}
              >
                {creatorAvatarUrl ? (
                  <img
                    src={creatorAvatarUrl}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-xs font-black uppercase">{creatorInitial}</span>
                )}
              </button>
            )}
            {trustBadges && (
              <div className="pointer-events-none max-w-[4.75rem]">{trustBadges}</div>
            )}
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] p-3 pt-8">
            {metaLine && (
              <p className="mb-1.5 truncate text-[10px] font-medium leading-snug uppercase tracking-[0.14em] text-slate-300/80">
                {metaLine}
              </p>
            )}
            {/* Keep the mission identity stack in normal flow with explicit
                rhythm. `leading-none` clipped large currency glyphs and left
                the following location line visually attached to the price. */}
            <div className="space-y-1.5">
              <p className="break-words text-[clamp(1.5rem,7vw,2rem)] font-black leading-[1.15] tracking-tight text-orange-300 [font-variant-numeric:tabular-nums] drop-shadow-[0_2px_12px_rgba(0,0,0,0.55)]">
                {budgetValue}
              </p>
              {locationLine && (
                <p className="truncate text-xs font-medium leading-snug text-slate-100/90">
                  {locationTranslation.displayText}
                </p>
              )}
              {description && (
                <TranslatableMissionDescription
                  text={description}
                  autoTranslate
                  clampClassName="line-clamp-2"
                />
              )}
            </div>
            {statusBadge && <div className="mt-2 flex flex-wrap gap-1.5">{statusBadge}</div>}
            {callout && <div className="mt-2">{callout}</div>}
            {submittedLabel && (
              <p className="mt-1.5 truncate text-[10px] font-medium uppercase tracking-[0.1em] text-slate-300/70">
                {submittedLabel}
              </p>
            )}
          </div>
        </div>

        {footer && <div className="px-0.5 pt-2 text-xs text-slate-400">{footer}</div>}
      </div>
    </article>
  );
};

export default MissionFeedCard;
