/**
 * Compact store preview card shown when a map store pin is selected.
 * Photo fills the top half; body uses light frost (.map-store-preview-card)
 * so the published service-zone fill stays visible through the sheet.
 */
import React from 'react';
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
  const heroRaw = store.store_photos[0] ?? null;
  const hero = heroRaw ? resolveStoreMediaUrl(heroRaw) : null;
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
      {/* Top half — large cover photo */}
      <div className="relative h-[8rem] w-full shrink-0 overflow-hidden rounded-t-2xl bg-slate-950 sm:h-[9rem]">
        {hero ? (
          <img
            src={hero}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-600/45 to-fuchsia-500/25">
            <Store className="h-10 w-10 text-violet-100" aria-hidden />
          </div>
        )}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/85 via-black/40 to-transparent"
          aria-hidden
        />
        <button
          type="button"
          onClick={onClose}
          className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full border border-white/25 bg-black/55 text-white backdrop-blur-md"
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

        {store.store_bio && (
          <p className="line-clamp-2 text-xs leading-relaxed text-slate-100 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            {store.store_bio}
          </p>
        )}

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
