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

/** `live` / `test` from `pk_live_` / `pk_test_`. Null if the Vite key is missing. */
export function getStripePublishableKeyMode(): 'live' | 'test' | null {
  const key = getStripePublishableKey();
  if (key.startsWith('pk_live_')) return 'live';
  if (key.startsWith('pk_test_')) return 'test';
  return null;
}

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripePromise(): Promise<Stripe | null> {
  const key = getStripePublishableKey();
  if (!key) return Promise.resolve(null);
  if (!stripePromise) stripePromise = loadStripe(key);
  return stripePromise;
}
