import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Elements,
  CardNumberElement,
  CardExpiryElement,
  CardCvcElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { useTranslation } from 'react-i18next';
import { throwIfInvokeFailed } from '../lib/supabaseFunctionError';
import {
  invokeAuthenticatedFunction,
  resolveAccessToken,
  resolveAuthenticatedUserId,
} from '../lib/supabaseAuth';
import {
  getStripePromise,
  getStripePublishableKey,
  getStripePublishableKeyMode,
} from '../lib/stripeClient';
import {
  TOKEN_TOPUP_TIERS,
  YEARLY_SUBSCRIPTION,
  formatUsdPrice,
} from '../lib/tokenPricing';

const CARD_STYLE = {
  style: {
    base: {
      color: '#f8fafc',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '16px',
      '::placeholder': { color: '#64748b' },
      iconColor: '#84cc16',
    },
    invalid: {
      color: '#f87171',
      iconColor: '#f87171',
    },
  },
};

const CARD_NUMBER_ELEMENT_OPTIONS = {
  ...CARD_STYLE,
  disableLink: true,
};

const STRIPE_ELEMENTS_APPEARANCE = {
  theme: 'night' as const,
  variables: {
    colorPrimary: '#84cc16',
    colorBackground: '#0f172a',
    colorText: '#f8fafc',
    colorDanger: '#f87171',
    borderRadius: '8px',
  },
};

type CheckoutMode = 'subscription' | 'tokens';

type PendingIntent = {
  clientSecret: string;
  mode: CheckoutMode;
  sliderStep: number;
};

const CHECKOUT_LOCK_ATTR = 'data-checkout-open';

/** Nested TokenPackModal instances (map + profile) share one shell lock. */
let checkoutLayerLocks = 0;

/**
 * Freeze the app shell (`#root`) so map/profile overlays cannot steal touches
 * while checkout is portaled onto `document.body`. html/body already use
 * `overflow: hidden` in index.css — we do not rewrite those, so close cannot
 * leave the WebView stuck with a leftover inline overflow/pointer-events lock.
 */
function acquireCheckoutLayerLock(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const root = document.getElementById('root');
  const body = document.body;
  checkoutLayerLocks += 1;
  if (checkoutLayerLocks === 1) {
    body.setAttribute(CHECKOUT_LOCK_ATTR, 'true');
    if (root) {
      root.setAttribute('inert', '');
      root.style.setProperty('pointer-events', 'none');
    }
  }
  return () => {
    checkoutLayerLocks = Math.max(0, checkoutLayerLocks - 1);
    if (checkoutLayerLocks > 0) return;
    body.removeAttribute(CHECKOUT_LOCK_ATTR);
    if (root) {
      root.removeAttribute('inert');
      root.style.removeProperty('pointer-events');
    }
  };
}

function invokeErrorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    return String((err as { code?: unknown }).code || '');
  }
  return '';
}

function checkoutErrorMessage(
  err: unknown,
  t: (key: string, opts?: { defaultValue?: string }) => string
): string {
  const code = invokeErrorCode(err);
  const message = err instanceof Error ? err.message : '';
  if (
    code === 'missing_auth' ||
    code === 'session_expired' ||
    code === 'user_mismatch' ||
    /not authenticated|sign in again|session expired/i.test(message)
  ) {
    return t('signInToPay', { defaultValue: 'Sign in to complete payment.' });
  }
  if (code === 'profile_missing' || code === 'profile_lookup_failed') {
    return t('stripeProfileMissing', {
      defaultValue:
        'Your account profile is missing. Sign out, sign in again, then retry payment.',
    });
  }
  if (
    code === 'stripe_not_configured' ||
    code === 'stripe_key_invalid' ||
    code === 'supabase_env_missing'
  ) {
    return t('stripeSecretNotConfigured', {
      defaultValue:
        'Card payments are not configured on the server. Set STRIPE_SECRET_KEY in Supabase secrets so it matches this site’s publishable key.',
    });
  }
  if (code === 'stripe_mode_mismatch') {
    return t('stripeKeyModeMismatch', {
      defaultValue:
        'Stripe live/test keys do not match. Update STRIPE_SECRET_KEY and VITE_STRIPE_PUBLISHABLE_KEY to the same Stripe account and mode.',
    });
  }
  if (message.trim()) return message;
  return t('unexpectedErrorTryAgain');
}

function assertClientSecretMatchesPublishableKey(livemode: boolean | undefined): void {
  const pkMode = getStripePublishableKeyMode();
  if (typeof livemode !== 'boolean' || !pkMode) return;
  const piMode = livemode ? 'live' : 'test';
  if (pkMode !== piMode) {
    throw Object.assign(new Error('Stripe key mode mismatch'), {
      code: 'stripe_mode_mismatch',
    });
  }
}

async function createCheckoutIntent(input: {
  userId: string;
  mode: CheckoutMode;
  sliderStep: number;
}): Promise<string> {
  const payerId = await resolveAuthenticatedUserId(input.userId);
  const accessToken = await resolveAccessToken();
  if (!payerId || !accessToken) {
    throw Object.assign(new Error('Not authenticated'), { code: 'missing_auth' });
  }

  const parseSecret = (data: unknown): string => {
    const payload = (data || {}) as { clientSecret?: unknown; livemode?: unknown };
    const clientSecret = String(payload.clientSecret || '').trim();
    if (!clientSecret.startsWith('pi_') || !clientSecret.includes('_secret_')) {
      throw new Error('Missing client secret');
    }
    const livemode =
      typeof payload.livemode === 'boolean' ? payload.livemode : undefined;
    assertClientSecretMatchesPublishableKey(livemode);
    return clientSecret;
  };

  if (input.mode === 'subscription') {
    const intentRes = await invokeAuthenticatedFunction('stripe-subscription-intent', {
      user_id: payerId,
      plan_usd_cents: YEARLY_SUBSCRIPTION.cents,
      plan_months: YEARLY_SUBSCRIPTION.months,
      bonus_tokens: YEARLY_SUBSCRIPTION.bonusTokens,
      plan_tier: YEARLY_SUBSCRIPTION.planTier,
    });
    await throwIfInvokeFailed('stripe-subscription-intent', intentRes);
    return parseSecret(intentRes.data);
  }

  const tokenTier = TOKEN_TOPUP_TIERS[input.sliderStep];
  const intentRes = await invokeAuthenticatedFunction('stripe-token-intent', {
    user_id: payerId,
    pack_tokens: tokenTier.tokens,
    pack_usd_cents: tokenTier.cents,
  });
  await throwIfInvokeFailed('stripe-token-intent', intentRes);
  return parseSecret(intentRes.data);
}

function CardFields({
  clientSecret,
  confirmRef,
  onReadyChange,
}: {
  clientSecret: string;
  confirmRef: React.MutableRefObject<(() => Promise<string>) | null>;
  onReadyChange: (ready: boolean) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();

  useEffect(() => {
    if (!stripe || !elements) {
      confirmRef.current = null;
      onReadyChange(false);
      return;
    }
    confirmRef.current = async () => {
      const card = elements.getElement(CardNumberElement);
      if (!card) throw new Error('Card element missing');
      const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: { card },
      });
      if (error) throw error;
      const paymentIntentId = paymentIntent?.id;
      if (paymentIntent?.status !== 'succeeded' || !paymentIntentId) {
        throw new Error('Payment did not succeed');
      }
      return paymentIntentId;
    };
    onReadyChange(true);
    return () => {
      confirmRef.current = null;
      onReadyChange(false);
    };
  }, [stripe, elements, clientSecret, confirmRef, onReadyChange]);

  return (
    <div className="space-y-3">
      <div>
        <div className="rounded-lg bg-slate-900 border border-slate-600 p-3 focus-within:border-lime-400 focus-within:ring-2 focus-within:ring-lime-500/20 transition-all">
          <CardNumberElement options={CARD_NUMBER_ELEMENT_OPTIONS} />
        </div>
      </div>
      <div className="flex gap-3">
        <div className="flex-1 min-w-0">
          <div className="rounded-lg bg-slate-900 border border-slate-600 p-3 focus-within:border-lime-400 focus-within:ring-2 focus-within:ring-lime-500/20 transition-all">
            <CardExpiryElement options={CARD_STYLE} />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="rounded-lg bg-slate-900 border border-slate-600 p-3 focus-within:border-lime-400 focus-within:ring-2 focus-within:ring-lime-500/20 transition-all">
            <CardCvcElement options={CARD_STYLE} />
          </div>
        </div>
      </div>
    </div>
  );
}

function CardFieldsSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="h-[46px] rounded-lg border border-slate-700 bg-slate-900/80" />
      <div className="flex gap-3">
        <div className="h-[46px] flex-1 rounded-lg border border-slate-700 bg-slate-900/80" />
        <div className="h-[46px] flex-1 rounded-lg border border-slate-700 bg-slate-900/80" />
      </div>
    </div>
  );
}

export default function TokenPackModal({
  open,
  userId,
  onClose,
  onSuccess,
  initialMode = 'tokens',
}: {
  open: boolean;
  userId: string | null;
  onClose: () => void;
  onSuccess: () => void;
  initialMode?: CheckoutMode;
}) {
  const { t } = useTranslation();
  const [checkoutMode, setCheckoutMode] = useState<CheckoutMode>(initialMode);
  const [sliderStep, setSliderStep] = useState(0);
  const [payerId, setPayerId] = useState<string | null>(null);
  const [intent, setIntent] = useState<PendingIntent | null>(null);
  const [intentLoading, setIntentLoading] = useState(false);
  const [intentError, setIntentError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<(() => Promise<string>) | null>(null);
  const confirmingRef = useRef(false);
  const [cardReady, setCardReady] = useState(false);
  const publishableKey = getStripePublishableKey();
  const tokenTier = TOKEN_TOPUP_TIERS[sliderStep];
  confirmingRef.current = confirming;

  const requestClose = useCallback(() => {
    if (confirmingRef.current) return;
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const release = acquireCheckoutLayerLock();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      requestClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      release();
    };
  }, [open, requestClose]);

  useEffect(() => {
    if (!open) {
      setCheckoutMode(initialMode);
      setSliderStep(0);
      setPayerId(null);
      setIntent(null);
      setIntentLoading(false);
      setIntentError(null);
      setConfirming(false);
      confirmRef.current = null;
      setCardReady(false);
      return;
    }
    setCheckoutMode(initialMode);
    let cancelled = false;
    (async () => {
      const id = await resolveAuthenticatedUserId(userId);
      const token = await resolveAccessToken();
      if (cancelled) return;
      setPayerId(id && token ? id : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, userId, initialMode]);

  useEffect(() => {
    if (!open || !payerId || !publishableKey) return;
    let cancelled = false;
    setIntent(null);
    setIntentError(null);
    setIntentLoading(true);
    setCardReady(false);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const clientSecret = await createCheckoutIntent({
            userId: payerId,
            mode: checkoutMode,
            sliderStep,
          });
          if (cancelled) return;
          setIntent({ clientSecret, mode: checkoutMode, sliderStep });
        } catch (err: unknown) {
          if (cancelled) return;
          setIntentError(checkoutErrorMessage(err, t));
          console.error('[SaasPaymentModal] intent error', err);
        } finally {
          if (!cancelled) setIntentLoading(false);
        }
      })();
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, payerId, publishableKey, checkoutMode, sliderStep, t]);

  const checkoutSummary = useMemo(() => {
    if (checkoutMode === 'subscription') {
      return {
        usdLabel: formatUsdPrice(YEARLY_SUBSCRIPTION.usd),
        detail: t('saasCheckoutSubscriptionDetail', {
          tokens: YEARLY_SUBSCRIPTION.bonusTokens,
        }),
      };
    }
    return {
      usdLabel: formatUsdPrice(tokenTier.usd),
      detail: t('saasCheckoutTokensDetail', { tokens: tokenTier.tokens }),
    };
  }, [checkoutMode, t, tokenTier.tokens, tokenTier.usd]);

  if (!open) return null;

  const payLabel = t('payAmount', {
    amount: checkoutSummary.usdLabel,
    defaultValue: `Pay ${checkoutSummary.usdLabel}`,
  });
  const sessionReady =
    !!intent &&
    intent.mode === checkoutMode &&
    (checkoutMode === 'subscription' || intent.sliderStep === sliderStep);
  const payDisabled =
    confirming || intentLoading || !sessionReady || !cardReady || !payerId || !publishableKey;

  const handlePay = async () => {
    if (payDisabled) return;
    const confirmPayment = confirmRef.current;
    if (!confirmPayment) return;
    setConfirming(true);
    try {
      const paymentIntentId = await confirmPayment();
      if (intent?.mode === 'subscription') {
        const actRes = await invokeAuthenticatedFunction('stripe-subscription-activate', {
          payment_intent_id: paymentIntentId,
        });
        await throwIfInvokeFailed('stripe-subscription-activate', actRes);
      } else {
        const creditRes = await invokeAuthenticatedFunction('stripe-token-credit', {
          payment_intent_id: paymentIntentId,
        });
        await throwIfInvokeFailed('stripe-token-credit', creditRes);
      }
      onSuccess();
      onClose();
    } catch (err: unknown) {
      console.error('[SaasPaymentModal] confirm error', err);
      alert(checkoutErrorMessage(err, t));
    } finally {
      setConfirming(false);
    }
  };

  return createPortal(
    <div
      className="pointer-events-auto fixed inset-0 z-[10100] isolate flex items-end justify-center overflow-hidden overscroll-none sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="saas-payment-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 z-0 touch-none bg-black/80 backdrop-blur-md"
        aria-label={t('close')}
        disabled={confirming}
        onClick={requestClose}
      />
      <div
        className="ce-bottom-sheet pointer-events-auto relative z-[1] w-full max-w-md rounded-t-3xl border border-lime-500/20 bg-slate-950/90 shadow-2xl sm:rounded-3xl"
        style={{
          maxHeight:
            'min(85svh, 85dvh, calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 1rem))',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-6 pb-3 pt-4">
          <h3
            id="saas-payment-modal-title"
            className="text-sm font-black uppercase tracking-[0.22em] text-white"
          >
            {t('saasPaymentModalTitle')}
          </h3>
          <button
            type="button"
            onClick={requestClose}
            disabled={confirming}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white text-lg font-bold disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label={t('close')}
          >
            ✕
          </button>
        </div>

        <div className="ce-bottom-sheet-body scrollable-sheet-content px-6 pt-4">
          {!payerId ? (
            <p className="mb-4 text-sm text-slate-300">
              {t('signInToPay', { defaultValue: 'Sign in to complete payment.' })}
            </p>
          ) : null}
          {!publishableKey ? (
            <p className="mb-4 text-sm text-slate-300">{t('edgeFunctionUnreachable')}</p>
          ) : null}

          <div className="space-y-5">
            <p className="text-xs leading-relaxed text-slate-400">{t('topUpProcessingDisclaimer')}</p>
            <button
              type="button"
              onClick={() => setCheckoutMode('subscription')}
              disabled={confirming}
              className={`w-full rounded-2xl border px-4 py-4 text-left transition-all ${
                checkoutMode === 'subscription'
                  ? 'border-lime-400/70 bg-lime-500/10 shadow-[0_0_24px_rgba(132,204,22,0.2)]'
                  : 'border-white/10 bg-black/30 hover:bg-white/5'
              }`}
            >
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-lime-400">
                {t('saasYearlySubscription')}
              </p>
              <p className="mt-2 text-2xl font-black text-white">
                {formatUsdPrice(YEARLY_SUBSCRIPTION.usd)}
              </p>
              <ul className="mt-3 space-y-1.5 text-xs text-slate-300">
                <li className="flex items-start gap-2">
                  <span className="text-lime-400 shrink-0">✓</span>
                  <span>{t('saasPerkUnlimitedContacts')}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-lime-400 shrink-0">✓</span>
                  <span>{t('saasPerkBonusTokens', { tokens: YEARLY_SUBSCRIPTION.bonusTokens })}</span>
                </li>
              </ul>
            </button>

            <div
              className={`rounded-2xl border px-4 py-4 transition-all ${
                checkoutMode === 'tokens'
                  ? 'border-cyan-400/60 bg-cyan-500/10 shadow-[0_0_20px_rgba(34,211,238,0.15)]'
                  : 'border-white/10 bg-black/30'
              }`}
            >
              <button
                type="button"
                onClick={() => setCheckoutMode('tokens')}
                disabled={confirming}
                className="w-full text-left"
              >
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-cyan-400">
                  {t('saasBuyExtraTokens')}
                </p>
              </button>
              <div className="relative z-[1] mt-4 touch-pan-x">
                <input
                  type="range"
                  min={0}
                  max={TOKEN_TOPUP_TIERS.length - 1}
                  step={1}
                  value={sliderStep}
                  disabled={confirming}
                  onChange={(e) => {
                    setSliderStep(Number(e.target.value));
                    setCheckoutMode('tokens');
                  }}
                  className="w-full h-2 rounded-full appearance-none bg-slate-700 accent-cyan-400 cursor-pointer touch-pan-x"
                  aria-label={t('saasBuyExtraTokens')}
                />
                <div className="mt-1 flex justify-between text-[9px] font-bold uppercase tracking-wider text-slate-500">
                  {TOKEN_TOPUP_TIERS.map((tier) => (
                    <span key={tier.cents}>{formatUsdPrice(tier.usd)}</span>
                  ))}
                </div>
              </div>
              <div className="mt-4 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                  {t('saasPriceLabel')}
                </p>
                <p className="mt-1 text-3xl font-black text-white">
                  {formatUsdPrice(tokenTier.usd)}
                </p>
                <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                  {t('saasYouGetTokens')}
                </p>
                <p className="mt-1 text-xl font-black text-cyan-300">
                  {t('saasTokenAmount', { count: tokenTier.tokens })}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-lime-400/30 bg-black/40 px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                {t('saasCheckoutTotal')}
              </p>
              <p className="mt-1 text-lg font-black text-white">{checkoutSummary.usdLabel}</p>
              <p className="mt-1 text-xs text-slate-400">{checkoutSummary.detail}</p>

              <div className="mt-4">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                  {t('payEnterCard', {
                    defaultValue: 'Enter your card details to complete payment.',
                  })}
                </p>
                {sessionReady && intent ? (
                  <Elements
                    key={intent.clientSecret}
                    stripe={getStripePromise()}
                    options={{
                      appearance: STRIPE_ELEMENTS_APPEARANCE,
                    }}
                  >
                    <CardFields
                      clientSecret={intent.clientSecret}
                      confirmRef={confirmRef}
                      onReadyChange={setCardReady}
                    />
                  </Elements>
                ) : (
                  <div className="relative">
                    <CardFieldsSkeleton />
                    {intentLoading ? (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-slate-950/40">
                        <span className="h-5 w-5 animate-spin rounded-full border-2 border-lime-400/30 border-t-lime-300" />
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              {intentError ? (
                <p className="mt-3 text-xs text-rose-300">{intentError}</p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="ce-bottom-sheet-footer space-y-2 border-t border-white/10 bg-slate-950/95 px-6 pt-3">
          <button
            type="button"
            onClick={() => void handlePay()}
            disabled={payDisabled}
            className="flex w-full items-center justify-center gap-2 py-3 rounded-full text-sm font-black uppercase tracking-[0.2em] bg-lime-500 text-black hover:bg-lime-400 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
          >
            {intentLoading || confirming ? (
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-black/25 border-t-black" />
            ) : null}
            <span>{confirming ? t('processing') : payLabel}</span>
          </button>
          <button
            type="button"
            onClick={requestClose}
            disabled={confirming}
            className="w-full py-3 rounded-full text-sm font-bold uppercase tracking-[0.2em] border border-white/15 text-slate-300 hover:bg-white/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('cancel')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
