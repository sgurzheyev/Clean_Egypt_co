import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { getStripePromise, getStripePublishableKey } from '../lib/stripeClient';
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

async function createCheckoutIntent(input: {
  userId: string;
  mode: CheckoutMode;
  sliderStep: number;
}): Promise<string> {
  const payerId = await resolveAuthenticatedUserId(input.userId);
  const accessToken = await resolveAccessToken();
  if (!payerId || !accessToken) {
    throw new Error('Not authenticated');
  }

  if (input.mode === 'subscription') {
    const intentRes = await invokeAuthenticatedFunction('stripe-subscription-intent', {
      user_id: payerId,
      plan_usd_cents: YEARLY_SUBSCRIPTION.cents,
      plan_months: YEARLY_SUBSCRIPTION.months,
      bonus_tokens: YEARLY_SUBSCRIPTION.bonusTokens,
      plan_tier: YEARLY_SUBSCRIPTION.planTier,
    });
    await throwIfInvokeFailed('stripe-subscription-intent', intentRes);
    const clientSecret = (intentRes.data as { clientSecret?: string })?.clientSecret;
    if (!clientSecret) throw new Error('Missing client secret');
    return clientSecret;
  }

  const tokenTier = TOKEN_TOPUP_TIERS[input.sliderStep];
  const intentRes = await invokeAuthenticatedFunction('stripe-token-intent', {
    user_id: payerId,
    pack_tokens: tokenTier.tokens,
    pack_usd_cents: tokenTier.cents,
  });
  await throwIfInvokeFailed('stripe-token-intent', intentRes);
  const clientSecret = (intentRes.data as { clientSecret?: string })?.clientSecret;
  if (!clientSecret) throw new Error('Missing client secret');
  return clientSecret;
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
  const [cardReady, setCardReady] = useState(false);
  const publishableKey = getStripePublishableKey();
  const tokenTier = TOKEN_TOPUP_TIERS[sliderStep];

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
          const message =
            err instanceof Error ? err.message : t('unexpectedErrorTryAgain');
          setIntentError(message);
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

  const requestClose = () => {
    if (confirming) return;
    onClose();
  };

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
      alert(err instanceof Error ? err.message : t('unexpectedErrorTryAgain'));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center overflow-y-auto bg-black/80 p-4 pb-safe-sm backdrop-blur-md pt-[max(1rem,env(safe-area-inset-top))]"
      onClick={requestClose}
    >
      <div
        className="my-auto w-full max-w-md rounded-3xl border border-lime-500/20 bg-slate-950/80 p-6 shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="overflow-y-auto overscroll-contain pb-[calc(1rem+env(safe-area-inset-bottom))] [-webkit-overflow-scrolling:touch]"
          style={{
            maxHeight:
              'min(85dvh, 85svh, calc(100svh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 4rem))',
          }}
        >
          <div className="flex items-start justify-between mb-4">
            <h3 className="text-sm font-black uppercase tracking-[0.22em] text-white">
              {t('saasPaymentModalTitle')}
            </h3>
            <button
              type="button"
              onClick={requestClose}
              disabled={confirming}
              className="text-slate-400 hover:text-white text-lg font-bold disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label={t('close')}
            >
              ✕
            </button>
          </div>

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
              <div className="mt-4">
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
                  className="w-full h-2 rounded-full appearance-none bg-slate-700 accent-cyan-400 cursor-pointer"
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
                      clientSecret: intent.clientSecret,
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

              <button
                type="button"
                onClick={() => void handlePay()}
                disabled={payDisabled}
                className="mt-4 flex w-full items-center justify-center gap-2 py-3 rounded-full text-sm font-black uppercase tracking-[0.2em] bg-lime-500 text-black hover:bg-lime-400 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
              >
                {intentLoading || confirming ? (
                  <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-black/25 border-t-black" />
                ) : null}
                <span>{confirming ? t('processing') : payLabel}</span>
              </button>
            </div>

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
      </div>
    </div>
  );
}
