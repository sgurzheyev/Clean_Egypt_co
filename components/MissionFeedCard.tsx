import React from 'react';
import { MapPin } from 'lucide-react';
import MissionDescriptionText from './MissionDescriptionText';

export type MissionFeedPlaceholderVariant = 'home' | 'city' | 'default';

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
  metaLine?: string;
  footer?: React.ReactNode;
  highlighted?: boolean;
  onClick?: () => void;
  onLocate?: () => void;
  locateAriaLabel?: string;
}

function placeholderGradient(variant: MissionFeedPlaceholderVariant): string {
  if (variant === 'home') {
    return 'bg-gradient-to-br from-amber-500/50 via-orange-950/80 to-slate-950';
  }
  if (variant === 'city') {
    return 'bg-gradient-to-br from-emerald-500/45 via-cyan-950/75 to-slate-950';
  }
  return 'bg-gradient-to-br from-cyan-500/35 via-indigo-950/70 to-slate-950';
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
  metaLine,
  footer,
  highlighted = false,
  onClick,
  onLocate,
  locateAriaLabel = 'Locate on map',
}) => {
  const showLocate = !!(onLocate || onClick);

  const handleLocate = (e: React.MouseEvent) => {
    e.stopPropagation();
    (onLocate ?? onClick)?.();
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
    >
      <div
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={onClick}
        onKeyDown={handleKeyDown}
        className={`w-full text-left ${onClick ? 'cursor-pointer' : ''}`}
      >
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-slate-900">
          {photo ? (
            <div className="absolute inset-0">{photo}</div>
          ) : photoUrl ? (
            <img src={photoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div
              className={`flex h-full w-full items-center justify-center ${placeholderGradient(
                placeholderVariant
              )}`}
            >
              {placeholderIcon ? (
                <span className="text-4xl opacity-90" aria-hidden>
                  {placeholderIcon}
                </span>
              ) : (
                <span className="text-[10px] font-black uppercase tracking-[0.28em] text-white/35">
                  CleanEgypt
                </span>
              )}
            </div>
          )}

          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-black/5"
            aria-hidden
          />

          {topLeftBadge && (
            <div className="absolute left-2.5 top-2.5 z-10 flex max-w-[70%] flex-wrap gap-1.5">
              {topLeftBadge}
            </div>
          )}

          {showLocate && (
            <button
              type="button"
              onClick={handleLocate}
              className="absolute right-2.5 top-2.5 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/25 bg-black/55 text-cyan-200 shadow-lg backdrop-blur-md transition-transform hover:bg-black/70 active:scale-95"
              aria-label={locateAriaLabel}
            >
              <MapPin className="h-4 w-4" strokeWidth={2.25} />
            </button>
          )}

          <div className="absolute inset-x-0 bottom-0 z-[1] p-3 pt-8">
            {metaLine && (
              <p className="mb-1 truncate text-[10px] font-medium uppercase tracking-[0.14em] text-slate-300/80">
                {metaLine}
              </p>
            )}
            <p className="text-2xl font-black leading-none tracking-tight text-orange-300 drop-shadow-[0_2px_12px_rgba(0,0,0,0.55)]">
              {budgetValue}
            </p>
            {locationLine && (
              <p className="mt-1.5 truncate text-xs font-medium text-slate-100/90">{locationLine}</p>
            )}
            {description && (
              <div className="mt-1.5">
                <MissionDescriptionText text={description} clampClassName="line-clamp-2" />
              </div>
            )}
            {statusBadge && <div className="mt-2 flex flex-wrap gap-1.5">{statusBadge}</div>}
          </div>
        </div>

        {footer && <div className="px-0.5 pt-2 text-xs text-slate-400">{footer}</div>}
      </div>
    </article>
  );
};

export default MissionFeedCard;
