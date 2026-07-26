/**
 * Read-only contractor storefront card for PublicProfile / profile overlays.
 */
import React, { useEffect, useState } from 'react';
import { MapPin, Share2, Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { findServiceOption } from '../src/lib/serviceSectors';
import {
  fetchContractorStore,
  fetchStoreSupplies,
  type ContractorStore,
  type StoreSupply,
} from '../src/lib/contractorStore';
import {
  computeTrustBadges,
  fetchTrustBadgeContext,
  shareStoreLink,
  type TrustBadgeId,
} from '../src/lib/trustBadges';
import {
  StoreBundlesShowcase,
  StoreRecurrenceBadge,
  StoreSuppliesShowcase,
} from './StoreShowcaseSections';
import StoreCoverageMap from './StoreCoverageMap';
import TrustBadgeRow from './TrustBadgeRow';

export type PublicStoreCardProps = {
  ownerId: string;
  /** When true, hide the card if the store is unpublished / missing. */
  requirePublished?: boolean;
  /** Show Share Store CTA (default true). */
  showShare?: boolean;
};

const PublicStoreCard: React.FC<PublicStoreCardProps> = ({
  ownerId,
  requirePublished = true,
  showShare = true,
}) => {
  const { t } = useTranslation();
  const [store, setStore] = useState<ContractorStore | null>(null);
  const [supplies, setSupplies] = useState<StoreSupply[]>([]);
  const [badges, setBadges] = useState<TrustBadgeId[]>([]);
  const [loading, setLoading] = useState(true);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const row = await fetchContractorStore(ownerId);
        if (cancelled) return;
        if (row && (!requirePublished || row.is_published)) {
          setStore(row);
          try {
            const [supplyRows, ctx] = await Promise.all([
              fetchStoreSupplies(row.id),
              fetchTrustBadgeContext(ownerId),
            ]);
            if (cancelled) return;
            setSupplies(supplyRows);
            setBadges(
              computeTrustBadges({
                ...ctx,
                store: row,
                supplies: supplyRows,
              })
            );
          } catch (err) {
            console.warn('PublicStoreCard supplies/badges load failed', err);
            if (!cancelled) {
              setSupplies([]);
              setBadges([]);
            }
          }
        } else {
          setStore(null);
          setSupplies([]);
          setBadges([]);
        }
      } catch (err) {
        console.warn('PublicStoreCard load failed', err);
        if (!cancelled) {
          setStore(null);
          setSupplies([]);
          setBadges([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerId, requirePublished]);

  const handleShare = async () => {
    if (!store) return;
    const result = await shareStoreLink({
      ownerId: store.owner_id,
      storeName: store.store_name,
      t,
    });
    if (result === 'shared') {
      setShareMsg(t('storeShareDone', { defaultValue: 'Shared!' }));
    } else if (result === 'copied') {
      setShareMsg(t('storeShareCopied', { defaultValue: 'Store link copied.' }));
    } else {
      setShareMsg(t('storeShareFailed', { defaultValue: 'Could not share link.' }));
    }
    window.setTimeout(() => setShareMsg(null), 2500);
  };

  if (loading || !store) return null;

  const title =
    store.store_name?.trim() ||
    t('storeDefaultName', { defaultValue: 'Contractor store' });

  return (
    <section className="mt-4 space-y-4 rounded-2xl border border-emerald-400/25 bg-emerald-500/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Store className="h-5 w-5 text-emerald-300" aria-hidden />
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-emerald-100">
            {t('storeTab', { defaultValue: 'Store' })}
          </h2>
        </div>
        {showShare && (
          <button
            type="button"
            onClick={() => void handleShare()}
            className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/45 bg-violet-500/20 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-violet-100"
          >
            <Share2 className="h-3.5 w-3.5" />
            {t('storeShareCta', { defaultValue: 'Share Store' })}
          </button>
        )}
      </div>
      {shareMsg && (
        <p className="text-[11px] font-bold text-emerald-300">{shareMsg}</p>
      )}

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

      <TrustBadgeRow badges={badges} />

      <StoreRecurrenceBadge
        supported={store.supported_recurrence_types}
        primary={store.recurrence_type}
      />

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
            {store.offered_services.map((sid) => {
              const opt = findServiceOption(sid);
              return (
                <span
                  key={sid}
                  className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-100"
                >
                  {opt ? t(opt.labelKey) : sid}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <StoreBundlesShowcase bundles={store.service_bundles} />
      <StoreSuppliesShowcase supplies={supplies} />

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
