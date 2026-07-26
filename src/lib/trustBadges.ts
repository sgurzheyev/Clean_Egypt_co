/**
 * Zero-KYC community trust badges — derived from store completeness + activity.
 */
import {
  fetchContractorStore,
  fetchStoreSupplies,
  type ContractorStore,
  type StoreSupply,
} from './contractorStore';
import { supabase } from '../../services/supabase';

export type TrustBadgeId =
  | 'eco_expert'
  | 'verified_community'
  | 'fully_equipped'
  | 'custom_coverage';

export type TrustBadgeDef = {
  id: TrustBadgeId;
  labelKey: string;
  defaultLabel: string;
  hintKey: string;
  defaultHint: string;
  /** Tailwind accent classes for the glossy pill. */
  toneClass: string;
};

export const TRUST_BADGE_DEFS: Record<TrustBadgeId, TrustBadgeDef> = {
  eco_expert: {
    id: 'eco_expert',
    labelKey: 'badgeEcoExpert',
    defaultLabel: 'Eco-Expert',
    hintKey: 'badgeEcoExpertHint',
    defaultHint: 'Uses biodegradable / eco-chemical supplies',
    toneClass:
      'border-emerald-400/55 bg-gradient-to-r from-emerald-500/35 to-lime-500/20 text-emerald-50 shadow-[0_0_14px_rgba(16,185,129,0.35)]',
  },
  verified_community: {
    id: 'verified_community',
    labelKey: 'badgeVerifiedCommunity',
    defaultLabel: 'Verified by Community',
    hintKey: 'badgeVerifiedCommunityHint',
    defaultHint: '4.8+ rating with completed missions',
    toneClass:
      'border-amber-400/55 bg-gradient-to-r from-amber-500/35 to-orange-500/20 text-amber-50 shadow-[0_0_14px_rgba(251,191,36,0.35)]',
  },
  fully_equipped: {
    id: 'fully_equipped',
    labelKey: 'badgeFullyEquipped',
    defaultLabel: 'Fully Equipped',
    hintKey: 'badgeFullyEquippedHint',
    defaultHint: 'Lists heavy equipment & professional supplies',
    toneClass:
      'border-cyan-400/55 bg-gradient-to-r from-cyan-500/35 to-sky-500/20 text-cyan-50 shadow-[0_0_14px_rgba(34,211,238,0.35)]',
  },
  custom_coverage: {
    id: 'custom_coverage',
    labelKey: 'badgeCustomCoverage',
    defaultLabel: 'Custom Coverage',
    hintKey: 'badgeCustomCoverageHint',
    defaultHint: 'Published Idealista-style service zone',
    toneClass:
      'border-violet-400/55 bg-gradient-to-r from-violet-500/35 to-fuchsia-500/20 text-violet-50 shadow-[0_0_14px_rgba(168,85,247,0.35)]',
  },
};

export type TrustBadgeContext = {
  store: ContractorStore | null;
  supplies: StoreSupply[];
  rating: number | null;
  missionsCompleted: number;
};

const ECO_RE =
  /\b(eco|biodegrad|plant[- ]?based|green\s*clean|organic|non[- ]?toxic)\b/i;

export function computeTrustBadges(ctx: TrustBadgeContext): TrustBadgeId[] {
  const badges: TrustBadgeId[] = [];
  const { store, supplies, rating, missionsCompleted } = ctx;

  const ecoFromSupplies = supplies.some(
    (s) =>
      s.category === 'Eco-Chemical' ||
      ECO_RE.test(s.name) ||
      ECO_RE.test(s.brand || '')
  );
  const ecoFromMaterials =
    store?.materials_and_chemicals.some((m) => ECO_RE.test(m)) ?? false;
  if (ecoFromSupplies || ecoFromMaterials) {
    badges.push('eco_expert');
  }

  if (
    typeof rating === 'number' &&
    Number.isFinite(rating) &&
    rating >= 4.8 &&
    missionsCompleted >= 3
  ) {
    badges.push('verified_community');
  }

  const hasHeavy = supplies.some((s) => s.category === 'Heavy Equipment');
  if (hasHeavy || supplies.length >= 3) {
    badges.push('fully_equipped');
  }

  if (store?.service_radius_polygon) {
    badges.push('custom_coverage');
  }

  return badges;
}

export async function fetchTrustBadgeContext(
  ownerId: string
): Promise<TrustBadgeContext> {
  const [{ data: profile }, store] = await Promise.all([
    supabase
      .from('profiles')
      .select('rating')
      .eq('id', ownerId)
      .maybeSingle(),
    fetchContractorStore(ownerId).catch(() => null),
  ]);

  let supplies: StoreSupply[] = [];
  if (store?.id && store.is_published) {
    supplies = await fetchStoreSupplies(store.id).catch(() => []);
  }

  const { count } = await supabase
    .from('missions')
    .select('id', { count: 'exact', head: true })
    .eq('cleaner_id', ownerId)
    .in('status', ['completed', 'finished']);

  return {
    store: store?.is_published ? store : null,
    supplies,
    rating:
      profile?.rating == null || !Number.isFinite(Number(profile.rating))
        ? null
        : Number(profile.rating),
    missionsCompleted: typeof count === 'number' ? count : 0,
  };
}

export async function fetchTrustBadgesForOwner(
  ownerId: string
): Promise<TrustBadgeId[]> {
  const ctx = await fetchTrustBadgeContext(ownerId);
  if (!ctx.store) {
    // Still allow Verified by Community without a published store.
    return computeTrustBadges(ctx).filter((b) => b === 'verified_community');
  }
  return computeTrustBadges(ctx);
}

/** Batch helper for feed cards — returns map ownerId → badges. */
export async function fetchTrustBadgesForOwners(
  ownerIds: string[]
): Promise<Record<string, TrustBadgeId[]>> {
  const unique = [...new Set(ownerIds.filter(Boolean))];
  const out: Record<string, TrustBadgeId[]> = {};
  await Promise.all(
    unique.slice(0, 40).map(async (id) => {
      try {
        out[id] = await fetchTrustBadgesForOwner(id);
      } catch {
        out[id] = [];
      }
    })
  );
  return out;
}

export function storeShareUrl(ownerId: string, origin?: string): string {
  const base =
    origin ||
    (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/store/${ownerId}`;
}

export async function shareStoreLink(opts: {
  ownerId: string;
  storeName?: string | null;
  t: (key: string, opts?: Record<string, string>) => string;
}): Promise<'shared' | 'copied' | 'failed'> {
  const url = storeShareUrl(opts.ownerId);
  const title =
    opts.storeName?.trim() ||
    opts.t('storeDefaultName', { defaultValue: 'Contractor store' });
  const text = opts.t('storeShareText', {
    defaultValue: 'Check out my cleaning storefront on Garbagin',
  });

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      await navigator.share({ title, text, url });
      return 'shared';
    }
  } catch (err) {
    // User cancel → treat as soft fail without copy.
    if (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'AbortError') {
      return 'failed';
    }
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return 'copied';
    }
  } catch {
    /* fall through */
  }
  return 'failed';
}
