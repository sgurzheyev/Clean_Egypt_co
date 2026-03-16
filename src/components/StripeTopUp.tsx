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

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string);

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      color: '#e2e8f0',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '16px',
      '::placeholder': { color: '#94a3b8' },
      iconColor: '#34d399',
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

function StripeTopUpForm({ amount, onAmountChange, onClose, userId }: StripeTopUpFormProps) {
  const { t } = useTranslation();
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);

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
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      alert(t('invalidAmount'));
      return;
    }

    setSubmitting(true);
    try {
      const { data, error: functionError } = await supabase.functions.invoke(
        'stripe-intent',
        { body: { amount: numericAmount, user_id: userId } }
      );
      if (functionError) throw functionError;

      const clientSecret = data?.clientSecret;
      if (!clientSecret) throw new Error('No client secret returned from server.');

      const cardNumberElement = elements.getElement(CardNumberElement);
      if (!cardNumberElement) throw new Error('Card number element not found.');

      const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(
        clientSecret,
        { payment_method: { card: cardNumberElement } }
      );
      if (stripeError) throw stripeError;
      if (paymentIntent?.status !== 'succeeded') {
        throw new Error(paymentIntent?.status ?? 'Payment did not succeed.');
      }

      const { error: rpcError } = await supabase.rpc('top_up_wallet', {
        p_user_id: userId,
        p_amount: numericAmount,
      });
      if (rpcError) throw rpcError;

      alert(t('stripeTopUpSuccess'));
      onAmountChange('');
      onClose();
    } catch (err: any) {
      console.error('Stripe top-up error:', err);
      const message =
        err?.message ??
        err?.error_description ??
        t('stripeTopUpError');
      alert(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
          {t('amountUsd')}
        </label>
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          placeholder="0.00"
          className="w-full rounded-2xl bg-slate-900/80 border border-slate-600 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 transition-all"
        />
      </div>

      {/* Block 1: Card Number */}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
          {t('cardNumber')}
        </label>
        <div className="rounded-lg bg-slate-900 border border-slate-600 p-3 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/30 transition-all [&_.StripeElement]:min-h-[40px] [&_.StripeElement]:py-1">
          <CardNumberElement options={CARD_ELEMENT_OPTIONS} />
        </div>
      </div>

      {/* Block 2: Expiry + CVC */}
      <div className="flex gap-4">
        <div className="flex-1 min-w-0">
          <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
            {t('expiry')}
          </label>
          <div className="rounded-lg bg-slate-900 border border-slate-600 p-3 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/30 transition-all [&_.StripeElement]:min-h-[40px] [&_.StripeElement]:py-1">
            <CardExpiryElement options={CARD_ELEMENT_OPTIONS} />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
            {t('cvc')}
          </label>
          <div className="rounded-lg bg-slate-900 border border-slate-600 p-3 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/30 transition-all [&_.StripeElement]:min-h-[40px] [&_.StripeElement]:py-1">
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
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-black uppercase tracking-[0.2em] text-white">
            {t('topUpWithCard')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-all"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <Elements stripe={stripePromise}>
          <StripeTopUpForm
            amount={amount}
            onAmountChange={setAmount}
            onClose={onClose}
            userId={userId}
          />
        </Elements>
      </div>
    </div>
  );
};

export default StripeTopUp;
