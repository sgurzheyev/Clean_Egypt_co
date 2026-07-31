/**
 * Shareable B2B mini-storefront landing at /store/:id and /cleaner/:id.
 * Amazon/eBay-style public page for a published contractor store.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, MapPin, Share2, Store } from 'lucide-react';
import {
  fetchContractorStore,
  fetchStoreSupplies,
  type ContractorStore,
  type StoreSupply,
} from '../src/lib/contractorStore';
import { findServiceOption } from '../src/lib/serviceSectors';
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

const StorefrontPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [store, setStore] = useState<ContractorStore | null>(null);
  const [supplies, setSupplies] = useState<StoreSupply[]>([]);
  const [badges, setBadges] = useState<TrustBadgeId[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setError(t('storefrontNotFound', { defaultValue: 'Store not found.' }));
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const row = await fetchContractorStore(id);
        if (cancelled) return;
        if (!row || !row.is_published) {
          setStore(null);
          setError(
            t('storefrontNotPublished', {
              defaultValue: 'This storefront is not published yet.',
            })
          );
          return;
        }
        setStore(row);
        const [supplyRows, ctx] = await Promise.all([
          fetchStoreSupplies(row.id).catch(() => [] as StoreSupply[]),
          fetchTrustBadgeContext(id),
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
        console.warn('StorefrontPage load failed', err);
        if (!cancelled) {
          setError(
            t('storefrontLoadFailed', {
              defaultValue: 'Could not load this storefront.',
            })
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, t]);

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
      setShareMsg(
        t('storeShareCopied', { defaultValue: 'Store link copied.' })
      );
    } else {
      setShareMsg(
        t('storeShareFailed', { defaultValue: 'Could not share link.' })
      );
    }
    window.setTimeout(() => setShareMsg(null), 2500);
  };

  const title =
    store?.store_name?.trim() ||
    t('storeDefaultName', { defaultValue: 'Contractor store' });

  return (
    <div className="scrollable-sheet-content h-full w-full overflow-x-hidden bg-slate-950 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(168,85,247,0.18),_transparent_55%),radial-gradient(ellipse_at_bottom,_rgba(16,185,129,0.12),_transparent_50%)]" />

      <header className="relative z-10 mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('back', { defaultValue: 'Back' })}
        </button>
        {store && (
          <button
            type="button"
            onClick={() => void handleShare()}
            className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/45 bg-violet-500/25 px-3 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-violet-50 shadow-[0_0_16px_rgba(168,85,247,0.3)]"
          >
            <Share2 className="h-3.5 w-3.5" />
            {t('storeShareCta', { defaultValue: 'Share Store' })}
          </button>
        )}
      </header>

      <main className="relative z-10 mx-auto max-w-3xl space-y-5 px-4 pb-16 pt-2">
        {loading && (
          <p className="text-sm italic text-slate-500">{t('loading')}</p>
        )}
        {error && !loading && (
          <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        )}
        {shareMsg && (
          <p className="text-center text-xs font-bold text-emerald-300">{shareMsg}</p>
        )}

        {store && !loading && (
          <>
            <section className="space-y-3 rounded-2xl border border-violet-400/30 bg-violet-500/10 p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-violet-400/50 bg-violet-500/25 text-violet-100">
                  <Store className="h-6 w-6" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-200/80">
                    {t('storefrontHeroEyebrow', {
                      defaultValue: 'B2B Storefront',
                    })}
                  </p>
                  <h1 className="mt-1 text-2xl font-black tracking-tight text-white">
                    {title}
                  </h1>
                  {store.office_address && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-violet-100/90">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {store.office_address}
                    </p>
                  )}
                </div>
              </div>
              {store.store_bio && (
                <p className="text-sm leading-relaxed text-slate-300">
                  {store.store_bio}
                </p>
              )}
              <TrustBadgeRow badges={badges} />
              <StoreRecurrenceBadge
                supported={store.supported_recurrence_types}
                primary={store.recurrence_type}
              />
              <button
                type="button"
                onClick={() => navigate(`/profile/${store.owner_id}`)}
                className="w-full rounded-full border border-white/20 bg-white/5 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] text-slate-200"
              >
                {t('storeOpenProfile', { defaultValue: 'Open store profile' })}
              </button>
            </section>

            {(store.office_lat != null || store.service_radius_polygon) && (
              <section className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                  {t('storeCoverageSection', {
                    defaultValue: 'Office & coverage zone',
                  })}
                </p>
                <StoreCoverageMap
                  officeLat={store.office_lat}
                  officeLng={store.office_lng}
                  polygon={store.service_radius_polygon}
                  zoneColor={store.color}
                  onOfficeChange={() => undefined}
                  onPolygonChange={() => undefined}
                  interactive={false}
                  heightClassName="h-56"
                />
              </section>
            )}

            {store.offered_services.length > 0 && (
              <section>
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
              </section>
            )}

            <StoreBundlesShowcase bundles={store.service_bundles} />
            <StoreSuppliesShowcase supplies={supplies} />

            {store.store_photos.length > 0 && (
              <section>
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
                      className="h-32 w-full rounded-xl border border-white/10 object-cover"
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default StorefrontPage;
