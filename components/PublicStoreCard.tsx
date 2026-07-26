/**
 * Read-only contractor storefront card for PublicProfile / profile overlays.
 */
import React, { useEffect, useState } from 'react';
import { MapPin, Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { findServiceOption } from '../src/lib/serviceSectors';
import {
  fetchContractorStore,
  type ContractorStore,
} from '../src/lib/contractorStore';
import StoreCoverageMap from './StoreCoverageMap';

export type PublicStoreCardProps = {
  ownerId: string;
  /** When true, hide the card if the store is unpublished / missing. */
  requirePublished?: boolean;
};

const PublicStoreCard: React.FC<PublicStoreCardProps> = ({
  ownerId,
  requirePublished = true,
}) => {
  const { t } = useTranslation();
  const [store, setStore] = useState<ContractorStore | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchContractorStore(ownerId)
      .then((row) => {
        if (cancelled) return;
        if (row && (!requirePublished || row.is_published)) {
          setStore(row);
        } else {
          setStore(null);
        }
      })
      .catch((err) => {
        console.warn('PublicStoreCard load failed', err);
        if (!cancelled) setStore(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ownerId, requirePublished]);

  if (loading || !store) return null;

  const title =
    store.store_name?.trim() ||
    t('storeDefaultName', { defaultValue: 'Contractor store' });

  return (
    <section className="mt-6 space-y-4 rounded-2xl border border-emerald-400/25 bg-emerald-500/5 p-4">
      <div className="flex items-center gap-2">
        <Store className="h-5 w-5 text-emerald-300" aria-hidden />
        <h2 className="text-sm font-black uppercase tracking-[0.18em] text-emerald-100">
          {t('storeTab', { defaultValue: 'Store' })}
        </h2>
      </div>

      <div>
        <p className="text-lg font-bold text-white">{title}</p>
        {store.store_bio && (
          <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
            {store.store_bio}
          </p>
        )}
        {store.office_address && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-cyan-200/90">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {store.office_address}
          </p>
        )}
      </div>

      {(store.office_lat != null || store.service_radius_polygon) && (
        <StoreCoverageMap
          officeLat={store.office_lat}
          officeLng={store.office_lng}
          polygon={store.service_radius_polygon}
          onOfficeChange={() => undefined}
          onPolygonChange={() => undefined}
          interactive={false}
          heightClassName="h-48"
        />
      )}

      {store.offered_services.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
            {t('storeServicesSection', { defaultValue: 'Services offered' })}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {store.offered_services.map((id) => {
              const opt = findServiceOption(id);
              return (
                <span
                  key={id}
                  className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-100"
                >
                  {opt ? t(opt.labelKey) : id}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {store.materials_and_chemicals.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
            {t('storeMaterialsSection', {
              defaultValue: 'Materials & chemicals',
            })}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {store.materials_and_chemicals.map((item) => (
              <span
                key={item}
                className="rounded-full border border-violet-400/35 bg-violet-500/15 px-2.5 py-0.5 text-[11px] text-violet-100"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      )}

      {store.store_photos.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
            {t('storePhotosSection', {
              defaultValue: 'Office / team / hygiene photos',
            })}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {store.store_photos.map((url) => (
              <img
                key={url}
                src={url}
                alt=""
                className="h-28 w-full rounded-lg border border-white/10 object-cover"
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

export default PublicStoreCard;
