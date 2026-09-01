import { loadStripe, type Stripe } from '@stripe/stripe-js';

/**
 * Browser Stripe.js instance. Wallet-config (Apple Pay / Google Pay / Link)
 * authenticates with this publishable key — never a secret key or a user JWT.
 */
export function getStripePublishableKey(): string {
  const raw = String(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? '').trim();
  if (!raw || raw === 'undefined' || raw === 'null') return '';
  if (!/^pk_(live|test)_/.test(raw)) return '';
  return raw;
}

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripePromise(): Promise<Stripe | null> {
  const key = getStripePublishableKey();
  if (!key) return Promise.resolve(null);
  if (!stripePromise) stripePromise = loadStripe(key);
  return stripePromise;
}
