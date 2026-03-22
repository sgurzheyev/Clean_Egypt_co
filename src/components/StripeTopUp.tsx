import React, { useState } from 'react';
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
import { supabase } from '../../lib/supabaseClient';
import { stripeEgpInputToWalletEgp, egpInputToChargeUsd } from '../lib/walletCredit';
import { parseIntegerEgpFromInput, sanitizeIntegerEgpDigits } from '../lib/integerEgpInput';
import { USD_TO_EGP_RATE } from '../../constants';
import { formatEgp } from '../lib/formatMoney';

/**
 * User enters EGP; Stripe charges the USD equivalent (card network); wallet credits net EGP.
 */
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string);

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      color: '#f8fafc',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '16px',
      '::placeholder': { color: '#64748b' },
      iconColor: '#10b981',
    },
    invalid: {
      color: '#f87171',
      iconColor: '#f87171',
    },
  },
};

interface StripeTopUpFormProps {
  amount: string;
  onAmountChange: (value: string) => void;
  onClose: () => void;
  userId: string | null;
}

function StripeTopUpForm({
  amount,
  onAmountChange,
  onClose,
  userId,
}: StripeTopUpFormProps) {
  const { t } = useTranslation();
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);

  const numericInput = Number(amount);
  const inputValid = Number.isFinite(numericInput) && numericInput > 0;

  const chargeUsd =
    inputValid ? egpInputToChargeUsd(numericInput, USD_TO_EGP_RATE) : 0;

  const netEgp =
    inputValid && chargeUsd > 0 ? stripeEgpInputToWalletEgp(numericInput) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) {
      console.warn('Stripe or Elements not loaded yet.');
      alert(t('stripeNotReady'));
      return;
    }
    if (!userId) {
      alert(t('stripeNotReady'));
      return;
    }
    if (!inputValid) {
      alert(t('invalidAmount'));
      return;
    }

    const chargeUsdForStripe = egpInputToChargeUsd(numericInput, USD_TO_EGP_RATE);

    if (!Number.isFinite(chargeUsdForStripe) || chargeUsdForStripe <= 0) {
      alert(t('invalidAmount'));
      return;
    }

    const netCreditEgp = stripeEgpInputToWalletEgp(numericInput);

    if (netCreditEgp <= 0) {
      alert(t('invalidAmount'));
      return;
    }

    if (chargeUsdForStripe < 0.5) {
      alert(t('stripeMinimumCharge'));
      return;
    }

    setSubmitting(true);
    try {
      const { data, error: functionError } = await supabase.functions.invoke('stripe-intent', {
        body: { amount: chargeUsdForStripe, user_id: userId },
      });
      if (functionError) throw functionError;

      const clientSecret = data?.clientSecret;
      if (!clientSecret) throw new Error('No client secret returned from server.');

      const cardNumberElement = elements.getElement(CardNumberElement);
      if (!cardNumberElement) throw new Error('Card number element not found.');

      const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: { card: cardNumberElement },
      });
      if (stripeError) throw stripeError;
      if (paymentIntent?.status !== 'succeeded') {
        throw new Error(paymentIntent?.status ?? 'Payment did not succeed.');
      }

      const { error: rpcError } = await supabase.rpc('top_up_wallet', {
        p_amount: Math.floor(Math.max(0, Number(netCreditEgp))),
      });
      if (rpcError) throw rpcError;

      alert(t('stripeTopUpSuccess'));
      onAmountChange('');
      onClose();
    } catch (err: any) {
      console.error('Stripe top-up error:', err);
      const message = err?.message ?? err?.error_description ?? t('stripeTopUpError');
      alert(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
          {t('amountEgp')}
        </label>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          pattern="\d*"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          placeholder="0"
          aria-label={t('amountEgp')}
          className="w-full rounded-2xl bg-slate-900/80 border border-slate-600 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 transition-all tabular-nums"
        />
        {netEgp != null && netEgp > 0 && (
          <div className="mt-3 space-y-1.5 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2.5">
            <p className="text-[11px] font-semibold text-emerald-200/95 leading-snug">
              {t('stripeCreditToAccount', { amount: formatEgp(netEgp) })}
            </p>
            <p className="text-[10px] text-slate-500 leading-snug">{t('stripeFeeTransparentHint')}</p>
            {chargeUsd > 0 && (
              <p className="text-[10px] text-slate-400">{t('stripeCardProcessingNote')}</p>
            )}
          </div>
        )}
      </div>

      <div>
        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
          {t('cardNumber')}
        </label>
        <div className="relative z-10 pointer-events-auto rounded-lg bg-slate-900 border border-slate-600 p-3 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/30 transition-all [&_.StripeElement]:min-h-[40px] [&_.StripeElement]:py-1 [&_.StripeElement]:pointer-events-auto [&_iframe]:pointer-events-auto">
          <CardNumberElement options={CARD_ELEMENT_OPTIONS} />
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex-1 min-w-0">
          <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
            {t('expiry')}
          </label>
          <div className="relative z-10 pointer-events-auto rounded-lg bg-slate-900 border border-slate-600 p-3 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/30 transition-all [&_.StripeElement]:min-h-[40px] [&_.StripeElement]:py-1 [&_.StripeElement]:pointer-events-auto [&_iframe]:pointer-events-auto">
            <CardExpiryElement options={CARD_ELEMENT_OPTIONS} />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
            {t('cvc')}
          </label>
          <div className="relative z-10 pointer-events-auto rounded-lg bg-slate-900 border border-slate-600 p-3 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/30 transition-all [&_.StripeElement]:min-h-[40px] [&_.StripeElement]:py-1 [&_.StripeElement]:pointer-events-auto [&_iframe]:pointer-events-auto">
            <CardCvcElement options={CARD_ELEMENT_OPTIONS} />
          </div>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 py-3 rounded-full text-sm font-bold uppercase tracking-[0.2em] border border-white/20 text-slate-300 hover:bg-white/5 transition-all"
        >
          {t('cancel')}
        </button>
        <button
          type="submit"
          disabled={!stripe || !elements || submitting}
          className="flex-1 py-3 rounded-full text-sm font-black uppercase tracking-[0.2em] bg-emerald-500 text-black hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-[0_0_20px_rgba(52,211,153,0.4)]"
        >
          {submitting ? t('processing') : t('payNow')}
        </button>
      </div>

      <p className="text-[9px] leading-relaxed text-slate-500 text-center px-1 pt-1">
        {t('stripeDepositLegalNote')}
      </p>
    </form>
  );
}

interface StripeTopUpProps {
  onClose: () => void;
  userId: string | null;
}

const StripeTopUp: React.FC<StripeTopUpProps> = ({ onClose, userId }) => {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="rounded-3xl bg-slate-900/95 border border-white/10 shadow-2xl p-6 shadow-[0_0_40px_rgba(52,211,153,0.08)]">
        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={onClose}
            className="p-2 mr-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all"
            aria-label="Close"
          >
            ✕
          </button>
          <h3 className="text-sm font-black uppercase tracking-[0.2em] text-white">
            {t('topUpWithCard')}
          </h3>
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed mb-4 px-1">
          {t('topUpProcessingDisclaimer')}
        </p>
        <Elements stripe={stripePromise}>
          <StripeTopUpForm
            amount={amount}
            onAmountChange={(v) => setAmount(sanitizeIntegerEgpDigits(v))}
            onClose={onClose}
            userId={userId}
          />
        </Elements>
      </div>
    </div>
  );
};

export default StripeTopUp;
