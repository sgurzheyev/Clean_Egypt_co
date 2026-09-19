/**
 * Compact store preview card shown when a map store pin is selected.
 * Hero is a snap carousel of `contractor_stores.store_photos` (cover first);
 * body uses light frost (.map-store-preview-card) so the published
 * service-zone fill stays visible through the sheet.
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { MapPin, Store, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  resolveStoreMediaUrl,
  type ContractorStore,
} from '../src/lib/contractorStore';
import { StoreServiceSkusShowcase } from './StoreShowcaseSections';

export type MapStorePreviewCardProps = {
  store: ContractorStore;
  onClose: () => void;
  /** Opens the full portaled store profile (double-tap / CTA). */
  onOpenFullProfile?: () => void;
};

function resolveStoreGalleryUrls(raw: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const url = resolveStoreMediaUrl(item);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

type StorePhotoCarouselProps = {
  urls: string[];
  storeTitle: string;
};

/**
 * Horizontal snap pager — same primitive as MissionBriefing / ImmersiveMissionFeed.
 * Touch uses native overflow swipe; mouse/pen can click-drag. Chrome (dots /
 * count) only renders when there are 2+ photos.
 */
const StorePhotoCarousel: React.FC<StorePhotoCarouselProps> = ({
  urls,
  storeTitle,
}) => {
  const { t } = useTranslation();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startLeft: number;
    moved: boolean;
  } | null>(null);
  const [index, setIndex] = useState(0);

  const syncIndexFromScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const width = Math.max(1, el.clientWidth);
    const next = Math.min(
      urls.length - 1,
      Math.max(0, Math.round(el.scrollLeft / width))
    );
    setIndex((prev) => (prev === next ? prev : next));
  }, [urls.length]);

  const goTo = useCallback(
    (next: number) => {
      const el = scrollerRef.current;
      if (!el) return;
      const clamped = Math.min(urls.length - 1, Math.max(0, next));
      const width = Math.max(1, el.clientWidth);
      el.scrollTo({ left: clamped * width, behavior: 'smooth' });
      setIndex(clamped);
    },
    [urls.length]
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    if (e.button !== 0) return;
    const el = e.currentTarget;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startLeft: el.scrollLeft,
      moved: false,
    };
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) < 6) return;
    drag.moved = true;
    e.currentTarget.scrollLeft = drag.startLeft - dx;
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const moved = drag.moved;
    dragRef.current = null;
    const el = e.currentTarget;
    if (el.hasPointerCapture(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
    if (!moved) {
      syncIndexFromScroll();
      return;
    }
    const width = Math.max(1, el.clientWidth);
    const next = Math.min(
      urls.length - 1,
      Math.max(0, Math.round(el.scrollLeft / width))
    );
    el.scrollTo({ left: next * width, behavior: 'smooth' });
    setIndex(next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      goTo(index + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goTo(index - 1);
    }
  };

  return (
    <>
      <div
        ref={scrollerRef}
        dir="ltr"
        tabIndex={0}
        role="region"
        aria-roledescription="carousel"
        aria-label={t('storePhotoGalleryLabel', {
          defaultValue: '{{name}} photos',
          name: storeTitle,
        })}
        onScroll={syncIndexFromScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        className="ce-hide-scrollbar relative z-0 flex h-full w-full cursor-grab snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain overscroll-y-none touch-pan-x active:cursor-grabbing"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {urls.map((url, photoIndex) => (
          <div
            key={`${url}-${photoIndex}`}
            className="relative h-full w-full min-w-full flex-[0_0_100%] snap-center snap-always overflow-hidden"
            aria-hidden={photoIndex !== index}
          >
            <img
              src={url}
              alt=""
              className="block h-full w-full select-none object-cover"
              loading={photoIndex === 0 ? 'eager' : 'lazy'}
              decoding="async"
              draggable={false}
              onDragStart={(ev) => ev.preventDefault()}
            />
          </div>
        ))}
      </div>

      <p className="pointer-events-none absolute left-2.5 top-2.5 z-20 rounded-full border border-white/20 bg-black/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-white/90 backdrop-blur-sm">
        {t('storePhotoCount', {
          defaultValue: '{{current}} / {{total}}',
          current: index + 1,
          total: urls.length,
        })}
      </p>

      <div
        className="pointer-events-auto absolute inset-x-0 bottom-2 z-20 flex items-center justify-center gap-1.5"
        role="tablist"
        aria-label={t('storePhotoGalleryLabel', {
          defaultValue: '{{name}} photos',
          name: storeTitle,
        })}
      >
        {urls.map((_, photoIndex) => (
          <button
            key={`dot-${photoIndex}`}
            type="button"
            role="tab"
            aria-selected={photoIndex === index}
            aria-label={t('storePhotoGoTo', {
              defaultValue: 'Photo {{n}}',
              n: photoIndex + 1,
            })}
            onClick={() => goTo(photoIndex)}
            className={`h-1.5 rounded-full transition-all duration-200 ${
              photoIndex === index
                ? 'w-5 bg-violet-200'
                : 'w-1.5 bg-white/45 hover:bg-white/70'
            }`}
          />
        ))}
      </div>
    </>
  );
};

type StoreBioBlockProps = {
  bio: string;
};

/** Clamped bio with expand/collapse; expanded text scrolls so the gallery stays on screen. */
const StoreBioBlock: React.FC<StoreBioBlockProps> = ({ bio }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [canToggle, setCanToggle] = useState(false);
  const textRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    setExpanded(false);
  }, [bio]);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    if (expanded) {
      setCanToggle(true);
      return;
    }
    setCanToggle(el.scrollHeight > el.clientHeight + 2);
  }, [bio, expanded]);

  return (
    <div className="space-y-1">
      <p
        ref={textRef}
        className={`text-xs leading-relaxed text-slate-100 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] ${
          expanded
            ? 'max-h-28 overflow-y-auto overscroll-contain [scrollbar-width:thin]'
            : 'line-clamp-3'
        }`}
      >
        {bio}
      </p>
      {canToggle && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="text-[10px] font-black uppercase tracking-[0.12em] text-violet-200 underline-offset-2 hover:text-violet-50 hover:underline"
          aria-expanded={expanded}
        >
          {expanded
            ? t('storeBioShowLess', { defaultValue: 'Show less' })
            : t('storeBioShowMore', { defaultValue: 'Show more' })}
        </button>
      )}
    </div>
  );
};

const MapStorePreviewCard: React.FC<MapStorePreviewCardProps> = ({
  store,
  onClose,
  onOpenFullProfile,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const title =
    store.store_name?.trim() ||
    t('storeDefaultName', { defaultValue: 'Contractor store' });
  const photos = useMemo(
    () => resolveStoreGalleryUrls(store.store_photos),
    [store.store_photos]
  );
  const skus =
    store.store_service_skus.length > 0
      ? store.store_service_skus
      : store.offered_services.map((id) => ({
          id,
          name: id,
          base_price: 0,
          unit: 'job' as const,
        }));

  const openFull = () => {
    onClose();
    if (onOpenFullProfile) {
      onOpenFullProfile();
      return;
    }
    navigate(`/store/${store.owner_id}`);
  };

  return (
    <div
      className="map-store-preview-card pointer-events-auto fixed inset-x-3 bottom-[max(5.5rem,calc(env(safe-area-inset-bottom,0px)+4.5rem))] z-[10025] mx-auto flex w-auto max-w-md flex-col overflow-hidden rounded-2xl border border-white/25 shadow-[0_20px_50px_rgba(0,0,0,0.55)]"
      role="dialog"
      aria-label={title}
    >
      {/* Top half — gallery of store_photos (cover = index 0) */}
      <div className="relative h-[8rem] w-full shrink-0 overflow-hidden rounded-t-2xl bg-slate-950 sm:h-[9rem]">
        {photos.length === 0 ? (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-600/45 to-fuchsia-500/25">
            <Store className="h-10 w-10 text-violet-100" aria-hidden />
          </div>
        ) : photos.length === 1 ? (
          <img
            src={photos[0]}
            alt=""
            className="h-full w-full object-cover"
            loading="eager"
            decoding="async"
          />
        ) : (
          <StorePhotoCarousel key={store.id} urls={photos} storeTitle={title} />
        )}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-16 bg-gradient-to-t from-black/85 via-black/40 to-transparent"
          aria-hidden
        />
        <button
          type="button"
          onClick={onClose}
          className="absolute right-2.5 top-2.5 z-30 flex h-8 w-8 items-center justify-center rounded-full border border-white/25 bg-black/55 text-white backdrop-blur-md"
          aria-label={t('close', { defaultValue: 'Close' })}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Bottom half — light frost so the map zone peeks through copy */}
      <div className="map-store-preview-body relative space-y-2.5 px-3.5 py-3.5">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
          aria-hidden
        />
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-violet-400/55 bg-violet-600/55 text-violet-50">
            <Store className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-black text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
              {title}
            </p>
            {store.office_address && (
              <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-violet-100 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                {store.office_address}
              </p>
            )}
          </div>
        </div>

        {store.store_bio && <StoreBioBlock bio={store.store_bio} />}

        {skus.length > 0 && (
          <StoreServiceSkusShowcase skus={skus} compact solidChips />
        )}

        {(store.service_bundles.length > 0 ||
          store.supported_recurrence_types.some((r) => r !== 'one_time')) && (
          <div className="flex flex-wrap gap-1">
            {store.service_bundles.length > 0 && (
              <span className="rounded-full border border-violet-400/55 bg-violet-600/70 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-violet-50">
                {t('storeBundlesBadge', {
                  defaultValue: '{{count}} bundles',
                  count: store.service_bundles.length,
                })}
              </span>
            )}
            {store.supported_recurrence_types.some((r) => r !== 'one_time') && (
              <span className="rounded-full border border-fuchsia-400/55 bg-fuchsia-600/70 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-fuchsia-50">
                {t('storeSubscribeSaveBadge', {
                  defaultValue: 'Subscribe & Save',
                })}
              </span>
            )}
          </div>
        )}

        {store.service_radius_polygon && (
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-100 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            {t('storeZoneVisibleHint', {
              defaultValue: 'Service zone highlighted on the map',
            })}
          </p>
        )}

        <button
          type="button"
          onClick={openFull}
          className="w-full rounded-full border border-violet-300/70 bg-violet-600/85 py-2.5 text-[11px] font-black uppercase tracking-[0.16em] text-white shadow-[0_0_16px_rgba(168,85,247,0.45)]"
        >
          {t('storeOpenProfile', { defaultValue: 'Open store profile' })}
        </button>
      </div>
    </div>
  );
};

export default MapStorePreviewCard;
