/**
 * Compact store preview card shown when a map store pin is selected.
 * Shows lilac coverage zone context via the parent map layer.
 */
import React from 'react';
import { MapPin, Store, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { findServiceOption } from '../src/lib/serviceSectors';
import type { ContractorStore } from '../src/lib/contractorStore';
import { PROFILE_GLASS_PANEL } from '../constants';

export type MapStorePreviewCardProps = {
  store: ContractorStore;
  onClose: () => void;
};

const MapStorePreviewCard: React.FC<MapStorePreviewCardProps> = ({ store, onClose }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const title =
    store.store_name?.trim() ||
    t('storeDefaultName', { defaultValue: 'Contractor store' });
  const hero = store.store_photos[0] ?? null;
  const services = store.offered_services.slice(0, 6);

  return (
    <div
      className={`pointer-events-auto fixed inset-x-3 bottom-[max(5.5rem,calc(env(safe-area-inset-bottom,0px)+4.5rem))] z-[10025] mx-auto w-auto max-w-md overflow-hidden rounded-2xl border border-violet-400/35 shadow-[0_0_28px_rgba(168,85,247,0.28)] ${PROFILE_GLASS_PANEL}`}
      role="dialog"
      aria-label={title}
    >
      <div className="relative">
        {hero ? (
          <img src={hero} alt="" className="h-28 w-full object-cover" />
        ) : (
          <div className="flex h-20 w-full items-center justify-center bg-gradient-to-br from-violet-600/40 to-fuchsia-500/20">
            <Store className="h-8 w-8 text-violet-100" aria-hidden />
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white backdrop-blur-md"
          aria-label={t('close', { defaultValue: 'Close' })}
        >
          <X className="h-4 w-4" />
        </button>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-slate-950 to-transparent" />
      </div>

      <div className="space-y-2.5 p-3.5">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-violet-400/50 bg-violet-500/20 text-violet-100">
            <Store className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-black text-white">{title}</p>
            {store.office_address && (
              <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-violet-100/85">
                <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                {store.office_address}
              </p>
            )}
          </div>
        </div>

        {store.store_bio && (
          <p className="line-clamp-2 text-xs leading-relaxed text-slate-300">
            {store.store_bio}
          </p>
        )}

        {services.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {services.map((id) => {
              const opt = findServiceOption(id);
              return (
                <span
                  key={id}
                  className="rounded-full border border-violet-400/40 bg-violet-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-violet-100"
                >
                  {opt ? t(opt.labelKey) : id}
                </span>
              );
            })}
            {store.offered_services.length > services.length && (
              <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[9px] font-bold text-slate-400">
                +{store.offered_services.length - services.length}
              </span>
            )}
          </div>
        )}

        {(store.service_bundles.length > 0 ||
          store.supported_recurrence_types.some((r) => r !== 'one_time')) && (
          <div className="flex flex-wrap gap-1">
            {store.service_bundles.length > 0 && (
              <span className="rounded-full border border-violet-400/40 bg-violet-500/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-violet-100">
                {t('storeBundlesBadge', {
                  defaultValue: '{{count}} bundles',
                  count: store.service_bundles.length,
                })}
              </span>
            )}
            {store.supported_recurrence_types.some((r) => r !== 'one_time') && (
              <span className="rounded-full border border-fuchsia-400/40 bg-fuchsia-500/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-fuchsia-100">
                {t('storeSubscribeSaveBadge', {
                  defaultValue: 'Subscribe & Save',
                })}
              </span>
            )}
          </div>
        )}

        {store.service_radius_polygon && (
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-300/90">
            {t('storeZoneVisibleHint', {
              defaultValue: 'Service zone highlighted on the map',
            })}
          </p>
        )}

        <button
          type="button"
          onClick={() => {
            onClose();
            navigate(`/store/${store.owner_id}`);
          }}
          className="w-full rounded-full border border-violet-400/50 bg-violet-500/25 py-2.5 text-[11px] font-black uppercase tracking-[0.16em] text-violet-50 shadow-[0_0_16px_rgba(168,85,247,0.3)]"
        >
          {t('storeOpenProfile', { defaultValue: 'Open store profile' })}
        </button>
      </div>
    </div>
  );
};

export default MapStorePreviewCard;
