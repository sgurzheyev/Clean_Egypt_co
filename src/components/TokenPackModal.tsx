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

function TokenPackForm({
  userId,
  onClose,
  onSuccess,
}: {
  userId: string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const pack = useMemo(() => ({ tokens: 50, usd: 5 }), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements || !userId) return;
    setSubmitting(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('stripe-token-intent', {
        body: { user_id: userId, pack_tokens: pack.tokens, pack_usd: pack.usd },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(String(data.error));

      const clientSecret = data?.clientSecret;
      if (!clientSecret) throw new Error('Missing client secret');

      const card = elements.getElement(CardNumberElement);
      if (!card) throw new Error('Card element missing');

      const { error: stripeErr, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: { card },
      });
      if (stripeErr) throw stripeErr;
      if (paymentIntent?.status !== 'succeeded') throw new Error('Payment did not succeed');

      const { data: creditData, error: creditErr } = await supabase.functions.invoke('stripe-token-credit', {
        body: { payment_intent_id: paymentIntent.id },
      });
      if (creditErr) throw creditErr;
      if (creditData?.error) throw new Error(String(creditData.error));

      onSuccess();
      onClose();
    } catch (err: any) {
      // Keep it simple: surface message via alert; MapPicker also shows toast notices.
      alert(err?.message || t('unexpectedErrorTryAgain'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-2xl bg-black/30 border border-lime-500/20 px-4 py-3">
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-lime-400">
          {t('tokenPack')}
        </p>
        <p className="mt-1 text-sm font-black text-white">
          {t('buyTokensPack', { tokens: pack.tokens, usd: pack.usd })}
        </p>
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
          onClick={onClose}
          className="flex-1 py-3 rounded-full text-sm font-bold uppercase tracking-[0.2em] border border-white/15 text-slate-300 hover:bg-white/5 transition-all"
        >
          {t('cancel')}
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 py-3 rounded-full text-sm font-black uppercase tracking-[0.2em] bg-lime-500 text-black hover:bg-lime-400 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
        >
          {submitting ? t('processing') : t('buyTokens')}
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
}: {
  open: boolean;
  userId: string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-slate-950/80 backdrop-blur-xl border border-lime-500/20 shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="max-h-[80vh] overflow-y-auto pb-12 pb-[calc(3rem+env(safe-area-inset-bottom))]">
          <div className="flex items-start justify-between mb-4">
            <h3 className="text-sm font-black uppercase tracking-[0.22em] text-white">
              Buy 50 Tokens
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-white text-lg font-bold"
              aria-label={t('close')}
            >
              ✕
            </button>
          </div>

          <Elements stripe={stripePromise}>
            <TokenPackForm userId={userId} onClose={onClose} onSuccess={onSuccess} />
          </Elements>
        </div>
      </div>
    </div>
  );
}

