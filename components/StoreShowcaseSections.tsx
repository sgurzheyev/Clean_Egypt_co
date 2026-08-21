/**
 * Read-only Professional Supplies + Service Bundles showcase blocks
 * for public storefronts and mission briefing.
 */
import React from 'react';
import { Package, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { findServiceOption } from '../src/lib/serviceSectors';
import {
  type RecurrenceType,
  type ServiceBundle,
  type StoreServiceSku,
  type StoreServiceUnit,
  type StoreSupply,
} from '../src/lib/contractorStore';
import { formatWorkBudgetUsd } from '../src/lib/formatMoney';

const RECURRENCE_LABEL_KEYS: Record<RecurrenceType, string> = {
  one_time: 'recurrenceOneTime',
  weekly: 'recurrenceWeekly',
  bi_weekly: 'recurrenceBiWeekly',
  monthly: 'recurrenceMonthly',
};

const UNIT_LABEL_KEYS: Record<StoreServiceUnit, string> = {
  job: 'storeSkuUnit_job',
  hour: 'storeSkuUnit_hour',
  sqm: 'storeSkuUnit_sqm',
};

export function recurrenceLabelKey(type: RecurrenceType): string {
  return RECURRENCE_LABEL_KEYS[type] ?? 'recurrenceOneTime';
}

export function storeSkuUnitLabelKey(unit: StoreServiceUnit): string {
  return UNIT_LABEL_KEYS[unit] ?? 'storeSkuUnit_job';
}

export type StoreServiceSkusShowcaseProps = {
  skus: StoreServiceSku[];
  compact?: boolean;
  /** When set, SKU rows become request CTAs (store → mission draft). */
  onSelectSku?: (sku: StoreServiceSku) => void;
};

/** Public priced service catalog (floor prices). */
export const StoreServiceSkusShowcase: React.FC<StoreServiceSkusShowcaseProps> = ({
  skus,
  compact = false,
  onSelectSku,
}) => {
  const { t } = useTranslation();
  if (!skus.length) return null;

  const priceUnitLabel = (sku: StoreServiceSku) => {
    const unit = t(storeSkuUnitLabelKey(sku.unit), {
      defaultValue:
        sku.unit === 'hour' ? 'Per hour' : sku.unit === 'sqm' ? 'Per m²' : 'Per job',
    });
    if (sku.base_price > 0) {
      return t('storeSkuChipPrice', {
        defaultValue: 'From {{price}} / {{unit}}',
        price: formatWorkBudgetUsd(sku.base_price),
        unit: unit.toLowerCase(),
      });
    }
    return t('storeSkuPriceOnRequest', { defaultValue: 'On request' });
  };

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1">
        {skus.slice(0, 6).map((sku) => {
          const opt = findServiceOption(sku.id);
          const label = opt ? t(opt.labelKey) : sku.name || sku.id;
          const body = (
            <>
              <span>{label}</span>
              <span className="font-black text-emerald-50/90">
                · {priceUnitLabel(sku)}
              </span>
            </>
          );
          const className =
            'inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-emerald-100';
          if (onSelectSku) {
            return (
              <button
                key={sku.id}
                type="button"
                onClick={() => onSelectSku(sku)}
                className={`${className} transition-colors hover:border-emerald-300/70 hover:bg-emerald-500/25`}
              >
                {body}
              </button>
            );
          }
          return (
            <span key={sku.id} className={className}>
              {body}
            </span>
          );
        })}
        {skus.length > 6 && (
          <span className="rounded-full border border-white/20 bg-black/40 px-2 py-0.5 text-[9px] font-bold text-slate-300">
            +{skus.length - 6}
          </span>
        )}
      </div>
    );
  }

  return (
    <div>
      <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
        {t('storeServicesSection', { defaultValue: 'Services offered' })}
      </p>
      <div className="space-y-2">
        {skus.map((sku) => {
          const opt = findServiceOption(sku.id);
          const name = opt ? t(opt.labelKey) : sku.name || sku.id;
          const unit = t(storeSkuUnitLabelKey(sku.unit), {
            defaultValue:
              sku.unit === 'hour'
                ? 'Per hour'
                : sku.unit === 'sqm'
                  ? 'Per m²'
                  : 'Per job',
          });
          const className =
            'flex w-full items-start justify-between gap-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2.5 text-left transition-colors';
          const inner = (
            <>
              <div className="min-w-0">
                <p className="text-sm font-bold text-white">{name}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-emerald-100/85">
                  {sku.base_price > 0
                    ? t('storeSkuCardLine', {
                        defaultValue: 'From {{price}} / {{unit}}',
                        price: formatWorkBudgetUsd(sku.base_price),
                        unit: unit.toLowerCase(),
                      })
                    : t('storeSkuPriceOnRequest', {
                        defaultValue: 'On request',
                      })}
                </p>
                {onSelectSku && (
                  <p className="mt-1 text-[9px] font-black uppercase tracking-[0.14em] text-emerald-300/80">
                    {t('storeSkuTapToRequest', {
                      defaultValue: 'Tap to request',
                    })}
                  </p>
                )}
              </div>
              {sku.base_price > 0 ? (
                <span className="shrink-0 rounded-full border border-emerald-400/45 bg-emerald-500/25 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-50">
                  {t('storeBundleFrom', {
                    defaultValue: 'From {{price}}',
                    price: formatWorkBudgetUsd(sku.base_price),
                  })}
                </span>
              ) : (
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  {t('storeSkuPriceOnRequest', {
                    defaultValue: 'On request',
                  })}
                </span>
              )}
            </>
          );
          if (onSelectSku) {
            return (
              <button
                key={sku.id}
                type="button"
                onClick={() => onSelectSku(sku)}
                className={`${className} hover:border-emerald-300/55 hover:bg-emerald-500/20 active:scale-[0.99]`}
              >
                {inner}
              </button>
            );
          }
          return (
            <div key={sku.id} className={className}>
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export type StoreSuppliesShowcaseProps = {
  supplies: StoreSupply[];
  compact?: boolean;
};

export const StoreSuppliesShowcase: React.FC<StoreSuppliesShowcaseProps> = ({
  supplies,
  compact = false,
}) => {
  const { t } = useTranslation();
  if (supplies.length === 0) return null;

  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
        <Package className="h-3.5 w-3.5 text-cyan-300" aria-hidden />
        {t('storeSuppliesSection', {
          defaultValue: 'Professional supplies',
        })}
      </p>
      <div
        className={
          compact
            ? 'flex gap-2 overflow-x-auto pb-1'
            : 'grid grid-cols-2 gap-2 sm:grid-cols-3'
        }
      >
        {supplies.map((item) => (
          <div
            key={item.id}
            className={`overflow-hidden rounded-xl border border-cyan-400/25 bg-cyan-500/5 ${
              compact ? 'w-36 shrink-0' : ''
            }`}
          >
            {item.image_url ? (
              <img
                src={item.image_url}
                alt=""
                className={`w-full object-cover ${compact ? 'h-20' : 'h-24'}`}
              />
            ) : (
              <div
                className={`flex w-full items-center justify-center bg-slate-900/80 ${
                  compact ? 'h-20' : 'h-24'
                }`}
              >
                <Package className="h-6 w-6 text-cyan-500/60" aria-hidden />
              </div>
            )}
            <div className="space-y-1 p-2">
              <p className="truncate text-xs font-bold text-white">{item.name}</p>
              {(item.brand || item.category) && (
                <p className="truncate text-[10px] text-slate-400">
                  {[item.brand, item.category].filter(Boolean).join(' · ')}
                </p>
              )}
              <p
                className={`text-[9px] font-black uppercase tracking-[0.12em] ${
                  item.is_included_in_service
                    ? 'text-emerald-300'
                    : 'text-amber-300'
                }`}
              >
                {item.is_included_in_service
                  ? t('storeSupplyIncluded', { defaultValue: 'Included' })
                  : t('storeSupplyAddOn', {
                      defaultValue: 'Add-on{{price}}',
                      price:
                        item.extra_price != null
                          ? ` · ${formatWorkBudgetUsd(item.extra_price)}`
                          : '',
                    })}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export type StoreBundlesShowcaseProps = {
  bundles: ServiceBundle[];
};

export const StoreBundlesShowcase: React.FC<StoreBundlesShowcaseProps> = ({
  bundles,
}) => {
  const { t } = useTranslation();
  if (bundles.length === 0) return null;

  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
        <Sparkles className="h-3.5 w-3.5 text-violet-300" aria-hidden />
        {t('storeBundlesSection', { defaultValue: 'Service bundles' })}
      </p>
      <div className="space-y-2">
        {bundles.map((bundle) => (
          <div
            key={bundle.id}
            className="rounded-xl border border-violet-400/30 bg-violet-500/10 p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-bold text-white">{bundle.title}</p>
              {bundle.starting_price > 0 && (
                <span className="shrink-0 rounded-full border border-violet-400/45 bg-violet-500/25 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-violet-100">
                  {t('storeBundleFrom', {
                    defaultValue: 'From {{price}}',
                    price: formatWorkBudgetUsd(bundle.starting_price),
                  })}
                </span>
              )}
            </div>
            {bundle.description && (
              <p className="mt-1 text-xs leading-relaxed text-slate-300">
                {bundle.description}
              </p>
            )}
            {bundle.service_ids.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {bundle.service_ids.map((id) => {
                  const opt = findServiceOption(id);
                  return (
                    <span
                      key={id}
                      className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-300"
                    >
                      {opt ? t(opt.labelKey) : id}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export type StoreRecurrenceBadgeProps = {
  supported: RecurrenceType[];
  primary?: RecurrenceType;
};

export const StoreRecurrenceBadge: React.FC<StoreRecurrenceBadgeProps> = ({
  supported,
  primary,
}) => {
  const { t } = useTranslation();
  const recurring = supported.filter((r) => r !== 'one_time');
  if (recurring.length === 0) return null;

  return (
    <div className="rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/10 px-3 py-2.5">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-fuchsia-200">
        {t('storeRecurringAvailable', {
          defaultValue: 'Subscribe & Save available',
        })}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {recurring.map((r) => (
          <span
            key={r}
            className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] ${
              r === primary
                ? 'border-fuchsia-400/55 bg-fuchsia-500/25 text-fuchsia-50'
                : 'border-white/15 bg-white/5 text-fuchsia-100/90'
            }`}
          >
            {t(recurrenceLabelKey(r), { defaultValue: r })}
          </span>
        ))}
      </div>
    </div>
  );
};
