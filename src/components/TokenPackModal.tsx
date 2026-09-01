import React, { useEffect, useMemo, useState } from 'react';
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

function PackChooser({
  initialMode,
  submitting,
  onClose,
  onContinue,
}: {
  initialMode: CheckoutMode;
  submitting: boolean;
  onClose: () => void;
  onContinue: (mode: CheckoutMode, sliderStep: number) => void;
}) {
  const { t } = useTranslation();
  const [checkoutMode, setCheckoutMode] = useState<CheckoutMode>(initialMode);
  const [sliderStep, setSliderStep] = useState(0);
  const tokenTier = TOKEN_TOPUP_TIERS[sliderStep];

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

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        onContinue(checkoutMode, sliderStep);
      }}
    >
      <p className="text-xs leading-relaxed text-slate-400">{t('topUpProcessingDisclaimer')}</p>
      <button
        type="button"
        onClick={() => setCheckoutMode('subscription')}
        className={`w-full rounded-2xl border px-4 py-4 text-left transition-all ${
          checkoutMode === 'subscription'
            ? 'border-lime-400/70 bg-lime-500/10 shadow-[0_0_24px_rgba(132,204,22,0.2)]'
            : 'border-white/10 bg-black/30 hover:bg-white/5'
        }`}
      >
        <p className="text-[11px] font-black uppercase tracking-[0.24em] text-lime-400">
          {t('saasYearlySubscription')}
        </p>
        <p className="mt-2 text-2xl font-black text-white">{formatUsdPrice(YEARLY_SUBSCRIPTION.usd)}</p>
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
        <button type="button" onClick={() => setCheckoutMode('tokens')} className="w-full text-left">
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
          <p className="mt-1 text-3xl font-black text-white">{formatUsdPrice(tokenTier.usd)}</p>
          <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
            {t('saasYouGetTokens')}
          </p>
          <p className="mt-1 text-xl font-black text-cyan-300">
            {t('saasTokenAmount', { count: tokenTier.tokens })}
          </p>
        </div>
      </div>

      <div className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3 text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
          {t('saasCheckoutTotal')}
        </p>
        <p className="mt-1 text-lg font-black text-white">{checkoutSummary.usdLabel}</p>
        <p className="mt-1 text-xs text-slate-400">{checkoutSummary.detail}</p>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="flex-1 py-3 rounded-full text-sm font-bold uppercase tracking-[0.2em] border border-white/15 text-slate-300 hover:bg-white/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t('cancel')}
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 py-3 rounded-full text-sm font-black uppercase tracking-[0.2em] bg-lime-500 text-black hover:bg-lime-400 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
        >
          {submitting
            ? t('processing')
            : checkoutMode === 'subscription'
              ? t('saasPaySubscription')
              : t('saasPayForTokens')}
        </button>
      </div>
    </form>
  );
}

function CardConfirmForm({
  intent,
  onClose,
  onSuccess,
  onBack,
  onSubmittingChange,
}: {
  intent: PendingIntent;
  onClose: () => void;
  onSuccess: () => void;
  onBack: () => void;
  onSubmittingChange?: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    onSubmittingChange?.(true);
    try {
      const card = elements.getElement(CardNumberElement);
      if (!card) throw new Error('Card element missing');

      const { error: stripeErr, paymentIntent } = await stripe.confirmCardPayment(
        intent.clientSecret,
        { payment_method: { card } }
      );
      if (stripeErr) throw stripeErr;
      if (paymentIntent?.status !== 'succeeded') throw new Error('Payment did not succeed');

      if (intent.mode === 'subscription') {
        const actRes = await invokeAuthenticatedFunction('stripe-subscription-activate', {
          payment_intent_id: paymentIntent.id,
        });
        await throwIfInvokeFailed('stripe-subscription-activate', actRes);
      } else {
        const creditRes = await invokeAuthenticatedFunction('stripe-token-credit', {
          payment_intent_id: paymentIntent.id,
        });
        await throwIfInvokeFailed('stripe-token-credit', creditRes);
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('[SaasPaymentModal] confirm error', err);
      alert(err?.message || t('unexpectedErrorTryAgain'));
    } finally {
      setSubmitting(false);
      onSubmittingChange?.(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <p className="text-xs leading-relaxed text-slate-400">
        {t('payEnterCard', { defaultValue: 'Enter your card details to complete payment.' })}
      </p>
      <div className="space-y-3">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
            {t('cardNumber')}
          </label>
          <div className="rounded-lg bg-slate-900 border border-slate-600 p-3 focus-within:border-lime-400 focus-within:ring-2 focus-within:ring-lime-500/20 transition-all">
            <CardNumberElement options={CARD_NUMBER_ELEMENT_OPTIONS} />
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex-1 min-w-0">
            <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
              {t('expiry')}
            </label>
            <div className="rounded-lg bg-slate-900 border border-slate-600 p-3 focus-within:border-lime-400 focus-within:ring-2 focus-within:ring-lime-500/20 transition-all">
              <CardExpiryElement options={CARD_STYLE} />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
              {t('cvc')}
            </label>
            <div className="rounded-lg bg-slate-900 border border-slate-600 p-3 focus-within:border-lime-400 focus-within:ring-2 focus-within:ring-lime-500/20 transition-all">
              <CardCvcElement options={CARD_STYLE} />
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="flex-1 py-3 rounded-full text-sm font-bold uppercase tracking-[0.2em] border border-white/15 text-slate-300 hover:bg-white/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t('back', { defaultValue: 'Back' })}
        </button>
        <button
          type="submit"
          disabled={submitting || !stripe || !elements}
          className="flex-1 py-3 rounded-full text-sm font-black uppercase tracking-[0.2em] bg-lime-500 text-black hover:bg-lime-400 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
        >
          {submitting
            ? t('processing')
            : intent.mode === 'subscription'
              ? t('saasPaySubscription')
              : t('saasPayForTokens')}
        </button>
      </div>
    </form>
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
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [payerId, setPayerId] = useState<string | null>(null);
  const [intent, setIntent] = useState<PendingIntent | null>(null);
  const publishableKey = getStripePublishableKey();

  useEffect(() => {
    if (!open) {
      setAuthReady(false);
      setPayerId(null);
      setIntent(null);
      setPaymentBusy(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const id = await resolveAuthenticatedUserId(userId);
      const token = await resolveAccessToken();
      if (cancelled) return;
      setPayerId(id && token ? id : null);
      setAuthReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, userId]);

  if (!open) return null;

  const requestClose = () => {
    if (paymentBusy) return;
    onClose();
  };

  const stripeReady = Boolean(publishableKey);

  const startCheckout = async (mode: CheckoutMode, sliderStep: number) => {
    if (!payerId) return;
    setPaymentBusy(true);
    try {
      const clientSecret = await createCheckoutIntent({
        userId: payerId,
        mode,
        sliderStep,
      });
      setIntent({ clientSecret, mode });
    } catch (err: any) {
      console.error('[SaasPaymentModal] intent error', err);
      alert(err?.message || t('unexpectedErrorTryAgain'));
    } finally {
      setPaymentBusy(false);
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
              disabled={paymentBusy}
              className="text-slate-400 hover:text-white text-lg font-bold disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label={t('close')}
            >
              ✕
            </button>
          </div>

          {!authReady ? (
            <p className="py-8 text-center text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
              {t('loading')}
            </p>
          ) : !payerId ? (
            <p className="py-8 text-center text-sm text-slate-300">
              {t('signInToPay', { defaultValue: 'Sign in to complete payment.' })}
            </p>
          ) : !stripeReady ? (
            <p className="py-8 text-center text-sm text-slate-300">
              {t('edgeFunctionUnreachable')}
            </p>
          ) : intent ? (
            <Elements
              key={intent.clientSecret}
              stripe={getStripePromise()}
              options={{
                clientSecret: intent.clientSecret,
                appearance: STRIPE_ELEMENTS_APPEARANCE,
              }}
            >
              <CardConfirmForm
                intent={intent}
                onClose={requestClose}
                onSuccess={onSuccess}
                onBack={() => {
                  if (paymentBusy) return;
                  setIntent(null);
                }}
                onSubmittingChange={setPaymentBusy}
              />
            </Elements>
          ) : (
            <PackChooser
              initialMode={initialMode}
              submitting={paymentBusy}
              onClose={requestClose}
              onContinue={startCheckout}
            />
          )}
        </div>
      </div>
    </div>
  );
}
