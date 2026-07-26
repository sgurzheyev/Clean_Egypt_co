/**
 * Tiered / eBay-style counter-offer packages attached to mission bids.
 */
export type BidOfferTier = 'basic' | 'all_inclusive' | 'custom';

export type BidOfferPackage = {
  id: string;
  tier: BidOfferTier | string;
  title: string;
  description: string;
  price: number;
  includes_supplies: boolean;
  supply_labels?: string[];
};

export const BID_PACKAGES_MAX = 3;

export function newPackageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultBidPackages(
  basicPrice: number,
  premiumPrice?: number
): BidOfferPackage[] {
  const basic = Math.max(1, Math.floor(basicPrice) || 1);
  const premium = Math.max(
    basic,
    Math.floor(premiumPrice ?? Math.ceil(basic * 1.35))
  );
  return [
    {
      id: newPackageId(),
      tier: 'basic',
      title: 'Option A — Basic labor',
      description: 'Labor only. Customer provides cleaning supplies.',
      price: basic,
      includes_supplies: false,
      supply_labels: [],
    },
    {
      id: newPackageId(),
      tier: 'all_inclusive',
      title: 'Option B — All-inclusive',
      description:
        'Professional eco-chemicals & equipment from contractor inventory included.',
      price: premium,
      includes_supplies: true,
      supply_labels: [],
    },
  ];
}

export function normalizeBidOfferPackages(value: unknown): BidOfferPackage[] {
  if (!Array.isArray(value)) return [];
  const out: BidOfferPackage[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const title = String(row.title ?? '').trim();
    const price = Math.floor(Number(row.price));
    if (!title || !Number.isFinite(price) || price < 1) continue;
    const labels = Array.isArray(row.supply_labels)
      ? row.supply_labels
          .map((s) => String(s ?? '').trim())
          .filter(Boolean)
          .slice(0, 12)
      : [];
    const tierRaw = String(row.tier ?? 'custom').trim() || 'custom';
    out.push({
      id: String(row.id ?? newPackageId()),
      tier: tierRaw,
      title: title.slice(0, 80),
      description: String(row.description ?? '').trim().slice(0, 400),
      price,
      includes_supplies: Boolean(row.includes_supplies),
      supply_labels: labels,
    });
    if (out.length >= BID_PACKAGES_MAX) break;
  }
  return out;
}

export function packagesToRpcPayload(packages: BidOfferPackage[]): unknown[] {
  return normalizeBidOfferPackages(packages).map((p) => ({
    id: p.id,
    tier: p.tier,
    title: p.title,
    description: p.description,
    price: p.price,
    includes_supplies: p.includes_supplies,
    supply_labels: p.supply_labels ?? [],
  }));
}
