import React, { useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  CardNumberElement,
  CardExpiryElement,
  CardCvcElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../services/supabase';
import { throwIfInvokeFailed } from '../lib/supabaseFunctionError';
import {
  TOKEN_TOPUP_TIERS,
  YEARLY_SUBSCRIPTION,
  formatUsdPrice,
} from '../lib/tokenPricing';

const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
if (!STRIPE_PUBLISHABLE_KEY) {
  console.error('Missing VITE_STRIPE_PUBLISHABLE_KEY');
}
const stripePromise = STRIPE_PUBLISHABLE_KEY ? loadStripe(STRIPE_PUBLISHABLE_KEY) : Promise.resolve(null);

const CARD_ELEMENT_OPTIONS = {
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

type CheckoutMode = 'subscription' | 'tokens';

function SaasPaymentForm({
  userId,
  onClose,
  onSuccess,
  onSubmittingChange,
  initialMode = 'subscription',
}: {
  userId: string | null;
  onClose: () => void;
  onSuccess: () => void;
  onSubmittingChange?: (busy: boolean) => void;
  initialMode?: CheckoutMode;
}) {
  const { t } = useTranslation();
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements || !userId) return;
    setSubmitting(true);
    onSubmittingChange?.(true);
    try {
      let clientSecret: string | undefined;

      if (checkoutMode === 'subscription') {
        const intentRes = await supabase.functions.invoke('stripe-subscription-intent', {
          body: {
            user_id: userId,
            plan_usd_cents: YEARLY_SUBSCRIPTION.cents,
            plan_months: YEARLY_SUBSCRIPTION.months,
            bonus_tokens: YEARLY_SUBSCRIPTION.bonusTokens,
            plan_tier: YEARLY_SUBSCRIPTION.planTier,
          },
        });
        await throwIfInvokeFailed('stripe-subscription-intent', intentRes);
        clientSecret = (intentRes.data as { clientSecret?: string })?.clientSecret;
      } else {
        const intentRes = await supabase.functions.invoke('stripe-token-intent', {
          body: {
            user_id: userId,
            pack_tokens: tokenTier.tokens,
            pack_usd_cents: tokenTier.cents,
          },
        });
        await throwIfInvokeFailed('stripe-token-intent', intentRes);
        clientSecret = (intentRes.data as { clientSecret?: string })?.clientSecret;
      }

      if (!clientSecret) throw new Error('Missing client secret');

      const card = elements.getElement(CardNumberElement);
      if (!card) throw new Error('Card element missing');

      const { error: stripeErr, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: { card },
      });
      if (stripeErr) throw stripeErr;
      if (paymentIntent?.status !== 'succeeded') throw new Error('Payment did not succeed');

      if (checkoutMode === 'subscription') {
        const actRes = await supabase.functions.invoke('stripe-subscription-activate', {
          body: { payment_intent_id: paymentIntent.id },
        });
        await throwIfInvokeFailed('stripe-subscription-activate', actRes);
      } else {
        const creditRes = await supabase.functions.invoke('stripe-token-credit', {
          body: { payment_intent_id: paymentIntent.id },
        });
        await throwIfInvokeFailed('stripe-token-credit', creditRes);
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('[SaasPaymentModal] payment flow error', err);
      alert(err?.message || t('unexpectedErrorTryAgain'));
    } finally {
      setSubmitting(false);
      onSubmittingChange?.(false);
    }
  };

  const requestClose = () => {
    if (submitting) return;
    onClose();
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <p className="text-xs leading-relaxed text-slate-400">{t('topUpProcessingDisclaimer')}</p>
      {/* Yearly subscription card */}
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

      {/* Token top-up slider */}
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

      {/* Checkout summary */}
      <div className="rounded-2xl bg-black/40 border border-white/10 px-4 py-3 text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
          {t('saasCheckoutTotal')}
        </p>
        <p className="mt-1 text-lg font-black text-white">{checkoutSummary.usdLabel}</p>
        <p className="mt-1 text-xs text-slate-400">{checkoutSummary.detail}</p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
            {t('cardNumber')}
          </label>
          <div className="rounded-lg bg-slate-900 border border-slate-600 p-3 focus-within:border-lime-400 focus-within:ring-2 focus-within:ring-lime-500/20 transition-all">
            <CardNumberElement options={CARD_ELEMENT_OPTIONS} />
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex-1 min-w-0">
            <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
              {t('expiry')}
            </label>
            <div className="rounded-lg bg-slate-900 border border-slate-600 p-3 focus-within:border-lime-400 focus-within:ring-2 focus-within:ring-lime-500/20 transition-all">
              <CardExpiryElement options={CARD_ELEMENT_OPTIONS} />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
              {t('cvc')}
            </label>
            <div className="rounded-lg bg-slate-900 border border-slate-600 p-3 focus-within:border-lime-400 focus-within:ring-2 focus-within:ring-lime-500/20 transition-all">
              <CardCvcElement options={CARD_ELEMENT_OPTIONS} />
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={requestClose}
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
  if (!open) return null;

  const requestClose = () => {
    if (paymentBusy) return;
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-md pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
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

          <Elements stripe={stripePromise}>
            <SaasPaymentForm
              userId={userId}
              onClose={requestClose}
              onSuccess={onSuccess}
              onSubmittingChange={setPaymentBusy}
              initialMode={initialMode}
            />
          </Elements>
        </div>
      </div>
    </div>
  );
}
