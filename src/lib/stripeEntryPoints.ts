/**
 * Every Stripe (or legacy payment) entry point in this repo.
 * Digital goods are hidden inside the Play TWA. There is no Stripe checkout
 * that pays a named cleaner for a physical job: pin placement spends tokens,
 * and the worker is paid off-platform after contact unlock.
 */
export type StripeRail = 'digital_goods' | 'physical_service' | 'legacy_unused';

export type StripeEntryPoint = {
  id: string;
  rail: StripeRail;
  surface: string;
};

export const STRIPE_ENTRY_POINTS: readonly StripeEntryPoint[] = [
  {
    id: 'stripe-token-intent',
    rail: 'digital_goods',
    surface: 'Token pack slider in TokenPackModal',
  },
  {
    id: 'stripe-token-credit',
    rail: 'digital_goods',
    surface: 'Credits the token pack after the PaymentIntent',
  },
  {
    id: 'stripe-subscription-intent',
    rail: 'digital_goods',
    surface: '$9.99 yearly phone-unlock subscription',
  },
  {
    id: 'stripe-subscription-activate',
    rail: 'digital_goods',
    surface: 'Activates that subscription',
  },
  {
    id: 'stripe-contribution-checkout',
    rail: 'digital_goods',
    surface: 'Crowdfunding Stripe donation (token bonus if the pin expires)',
  },
  {
    id: 'stripe-contribution-confirm',
    rail: 'digital_goods',
    surface: 'Confirms that donation',
  },
  {
    id: 'stripe-webhook',
    rail: 'digital_goods',
    surface: 'Applies crowdfunding Checkout sessions only',
  },
  {
    id: 'stripe-intent',
    rail: 'digital_goods',
    surface: 'Wallet top-up. No current screen calls it',
  },
  {
    id: 'stripe-wallet-credit',
    rail: 'digital_goods',
    surface: 'Credits a wallet top-up. No current screen calls it',
  },
  {
    id: 'create-payment-intent',
    rail: 'legacy_unused',
    surface: 'Legacy intent with no cleaner metadata. No UI caller',
  },
  {
    id: 'verify-job-payment',
    rail: 'legacy_unused',
    surface: 'Returns moved:false. Does not charge',
  },
];

export function stripeRailBlockedInTwa(rail: StripeRail): boolean {
  return rail === 'digital_goods';
}
