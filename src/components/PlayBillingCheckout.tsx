/**
 * Shown only when VITE_PLAY_BILLING_ENABLED=1 inside the TWA.
 * That flag is unset, so this panel is not mounted.
 */
import { useState } from 'react';
import {
  PLAY_SUBSCRIPTION_SKU,
  PLAY_TOKEN_SKUS,
  purchaseWithPlayBilling,
} from '../lib/playBilling';

export default function PlayBillingCheckout({
  mode,
  onDone,
}: {
  mode: 'tokens' | 'subscription';
  onDone: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skus =
    mode === 'subscription'
      ? [PLAY_SUBSCRIPTION_SKU.productId]
      : PLAY_TOKEN_SKUS.map((sku) => sku.productId);

  return (
    <div className="space-y-2">
      {skus.map((productId) => (
        <button
          key={productId}
          type="button"
          disabled={pending}
          onClick={() => {
            setPending(true);
            setError(null);
            void purchaseWithPlayBilling(productId)
              .then(onDone)
              .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : 'Play Billing failed');
              })
              .finally(() => setPending(false));
          }}
          className="w-full rounded-full border border-white/15 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-200 disabled:opacity-50"
        >
          {productId}
        </button>
      ))}
      {error ? <p className="text-xs text-rose-300">{error}</p> : null}
    </div>
  );
}
