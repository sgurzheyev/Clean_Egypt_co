// src/components/OrderForm.tsx — amounts are always EGP (Paymob charges EGP piastres; no USD conversion on this form).
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../services/supabase';
import {
  HOME_MIN_PRICE,
  SCOUT_STAKE_FEE_EGP,
  CITY_MIN_PRICE,
  CITY_MAX_PRICE,
  HOME_MAX_PRICE,
} from '../constants';
import {
  descriptionLooksLikeContactOrPhone,
  validateMissionDescription,
} from '../src/lib/missionContentPolicy';
import { formatEgp } from '../src/lib/formatMoney';

interface Props {
  selectedLocation: { lat: number; lng: number } | null;
  onOrderStarted?: () => void;
}

const CONTACT_WARNING =
  'Numbers and external contacts are blocked for security';

const OrderForm: React.FC<Props> = ({ selectedLocation, onOrderStarted }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  /** User-entered mission price / goal in EGP only */
  const [amountEgp, setAmountEgp] = useState('');

  const contactWarning = useMemo(
    () => descriptionLooksLikeContactOrPhone(shortDescription),
    [shortDescription]
  );

  const policyCheck = useMemo(() => validateMissionDescription(shortDescription), [shortDescription]);

  const parseEgp = (): number => {
    const raw = parseFloat(String(amountEgp).replace(',', '.'));
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return Math.floor(raw);
  };

  /** Paymob mission_creation: amount_target is integer EGP (see /api/paymob-intent). */
  const startPaymobMission = async (category: 'public' | 'home', egp: number) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      alert(t('signIn') || 'Sign in required');
      return;
    }
    if (!selectedLocation) return;

    setLoading(true);
    if (onOrderStarted) onOrderStarted();

    try {
      const res = await fetch('/api/paymob-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'mission_creation',
          category,
          amount_target: egp,
          userId,
          location_lat: selectedLocation.lat,
          location_lng: selectedLocation.lng,
          description: shortDescription.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error((errData as { error?: string }).error || `Payment init failed (${res.status})`);
      }

      const data = (await res.json()) as {
        paymentUrl?: string;
        paymentToken?: string;
        missionId?: string;
      };

      if (data.missionId) {
        sessionStorage.setItem('paymobPendingMissionId', data.missionId);
      }

      if (data.paymentUrl) {
        sessionStorage.setItem('paymentReturnType', 'mission_creation');
        window.location.assign(data.paymentUrl);
        return;
      }
      if (data.paymentToken) {
        sessionStorage.setItem('paymentReturnType', 'mission_creation');
        const iframeId =
          (import.meta.env.VITE_PAYMOB_IFRAME_ID as string | undefined) || '1007120';
        const url = `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${data.paymentToken}`;
        window.location.assign(url);
        return;
      }

      throw new Error('No payment URL or token received.');
    } catch (error: unknown) {
      console.error(error);
      alert(error instanceof Error ? error.message : 'Payment could not start.');
    } finally {
      setLoading(false);
    }
  };

  const onCityPin = async () => {
    if (!selectedLocation) return alert('Tap on map first! 📍');
    if (!email || !email.includes('@')) return alert('Enter valid Email to start! 📧');

    const desc = shortDescription.trim();
    if (desc.length > 0) {
      const policy = validateMissionDescription(desc);
      if (policy.ok === false) {
        alert(policy.error);
        return;
      }
    }

    const egp = parseEgp();
    if (egp < CITY_MIN_PRICE || egp > CITY_MAX_PRICE) {
      alert(t('cityPriceRangeEgp', { min: CITY_MIN_PRICE, max: CITY_MAX_PRICE }));
      return;
    }

    const ok = window.confirm(
      t('cityPinScoutStakeConfirm', { amount: formatEgp(SCOUT_STAKE_FEE_EGP) })
    );
    if (!ok) return;

    await startPaymobMission('public', egp);
  };

  const onHomeMission = async () => {
    if (!selectedLocation) return alert('Tap on map first! 📍');
    if (!email || !email.includes('@')) return alert('Enter valid Email to start! 📧');

    const desc = shortDescription.trim();
    if (desc.length > 0) {
      const policy = validateMissionDescription(desc);
      if (policy.ok === false) {
        alert(policy.error);
        return;
      }
    }

    const egp = parseEgp();
    if (egp < HOME_MIN_PRICE || egp > HOME_MAX_PRICE) {
      alert(t('homePriceRangeEgp', { min: HOME_MIN_PRICE, max: HOME_MAX_PRICE }));
      return;
    }

    await startPaymobMission('home', egp);
  };

  const descriptionInvalid = shortDescription.trim().length > 0 && !policyCheck.ok;
  const policyRejectText = policyCheck.ok === false ? policyCheck.error : null;

  return (
    <div className="space-y-4 p-4 bg-black/60 backdrop-blur-md rounded-2xl border border-white/10">
      <div className="space-y-2">
        <label className="text-[10px] text-gray-400 uppercase tracking-widest ml-1">Your Intelligence Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="agent@cleanegypt.co"
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:border-[#00f2ff] outline-none transition-all"
        />
      </div>

      <div className="space-y-2">
        <label className="text-[10px] text-gray-400 uppercase tracking-widest ml-1">{t('amountEgp')}</label>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={amountEgp}
          onChange={(e) => setAmountEgp(e.target.value)}
          placeholder={t('anyAmount')}
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:border-[#00f2ff] outline-none transition-all"
        />
        <p className="text-[10px] text-gray-500">
          {t('orderFormAmountHintEgp')}
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-[10px] text-gray-400 uppercase tracking-widest ml-1">Short description</label>
        <textarea
          value={shortDescription}
          onChange={(e) => setShortDescription(e.target.value)}
          placeholder="Describe the mission (no phone numbers or external contacts)"
          rows={3}
          className={`w-full bg-white/5 border rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none transition-all resize-y min-h-[80px] ${
            contactWarning || descriptionInvalid
              ? 'border-red-500/70 focus:border-red-400'
              : 'border-white/10 focus:border-[#00f2ff]'
          }`}
        />
        {contactWarning && (
          <p className="text-[11px] font-semibold text-red-400" role="alert">
            {CONTACT_WARNING}
          </p>
        )}
        {descriptionInvalid && !contactWarning && policyRejectText && (
          <p className="text-[11px] font-semibold text-red-400" role="alert">
            {policyRejectText}
          </p>
        )}
      </div>

      <p className="text-[10px] text-gray-500 uppercase tracking-[0.2em] text-center">
        {selectedLocation
          ? `TARGET: ${selectedLocation.lat.toFixed(4)}, ${selectedLocation.lng.toFixed(4)}`
          : 'SELECT TARGET ON MAP'}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={loading || contactWarning || descriptionInvalid}
          onClick={() => void onCityPin()}
          className="py-4 bg-[#39FF14]/10 border border-[#39FF14]/40 text-[#39FF14] rounded-xl font-black italic hover:bg-[#39FF14] hover:text-black transition-all text-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          CITY PIN ({SCOUT_STAKE_FEE_EGP} EGP)
        </button>

        <button
          type="button"
          disabled={loading || contactWarning || descriptionInvalid}
          onClick={() => void onHomeMission()}
          className="py-4 bg-[#f8ff14]/10 border border-[#f8ff14]/40 text-[#f8ff14] rounded-xl font-black italic hover:bg-[#f8ff14] hover:text-black transition-all text-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          HOME ({HOME_MIN_PRICE}+ EGP)
        </button>
      </div>

      <p className="mt-2 text-[10px] text-gray-500 text-center">{t('paymentsEgpOnlyNote')}</p>
    </div>
  );
};

export default OrderForm;
