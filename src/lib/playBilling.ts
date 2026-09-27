/**
 * Play Billing via the Digital Goods API. Off unless
 * VITE_PLAY_BILLING_ENABLED=1 at build time. The server still refuses
 * unless PLAY_BILLING_ENABLED=true. Neither is set.
 *
 * SKUs must match supabase/functions/play-billing-verify/index.ts
 * and the Play Console products documented in Payments_Play_Policy.md.
 */
import { supabase } from '../../services/supabase';
import { TOKEN_TOPUP_TIERS, YEARLY_SUBSCRIPTION } from './tokenPricing';
import { isTwaContext } from './twaContext';

export const PLAY_BILLING_METHOD = 'https://play.google.com/billing';

export const PLAY_TOKEN_SKUS = TOKEN_TOPUP_TIERS.map((tier) => ({
  productId: `tokens_${tier.tokens}`,
  tokens: tier.tokens,
  usd: tier.usd,
}));

export const PLAY_SUBSCRIPTION_SKU = {
  productId: 'yearly_access',
  months: YEARLY_SUBSCRIPTION.months,
  usd: YEARLY_SUBSCRIPTION.usd,
} as const;

export function isPlayBillingEnabled(): boolean {
  return import.meta.env.VITE_PLAY_BILLING_ENABLED === '1';
}

type DigitalGoodsItem = {
  itemId: string;
  price: { currency: string; value: string };
};

type DigitalGoodsService = {
  getDetails(itemIds: string[]): Promise<DigitalGoodsItem[]>;
};

type PlayPaymentDetails = {
  purchaseToken?: string;
};

declare global {
  interface Window {
    getDigitalGoodsService?(serviceUrl: string): Promise<DigitalGoodsService>;
  }
}

export async function purchaseWithPlayBilling(productId: string): Promise<void> {
  if (!isPlayBillingEnabled() || !isTwaContext()) {
    throw Object.assign(new Error('Play Billing is not enabled'), {
      code: 'play_billing_disabled',
    });
  }
  if (typeof window.getDigitalGoodsService !== 'function') {
    throw Object.assign(new Error('Digital Goods API is unavailable'), {
      code: 'play_billing_unavailable',
    });
  }

  const service = await window.getDigitalGoodsService(PLAY_BILLING_METHOD);
  const [item] = await service.getDetails([productId]);
  if (!item?.price?.value || !item.price.currency) {
    throw Object.assign(new Error('Unknown Play product'), { code: 'play_sku_missing' });
  }

  const request = new PaymentRequest(
    [
      {
        supportedMethods: PLAY_BILLING_METHOD,
        data: { sku: item.itemId },
      },
    ],
    {
      total: {
        label: 'Total',
        amount: { currency: item.price.currency, value: item.price.value },
      },
    }
  );
  const response = await request.show();
  const purchaseToken = String(
    (response.details as PlayPaymentDetails | null)?.purchaseToken || ''
  ).trim();
  if (!purchaseToken) {
    await response.complete('fail');
    throw Object.assign(new Error('Missing purchase token'), { code: 'play_token_missing' });
  }

  const { data, error } = await supabase.functions.invoke('play-billing-verify', {
    body: { product_id: productId, purchase_token: purchaseToken },
  });
  if (error || (data && typeof data === 'object' && (data as { error?: string }).error)) {
    await response.complete('fail');
    throw error || new Error('Play purchase was not credited');
  }
  await response.complete('success');
}
