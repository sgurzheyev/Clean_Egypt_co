/**
 * Explicit Cleanup Sector funding. The signed-in user becomes the mission creator
 * through open_cleanup_sector_mission (normal $2 floor and token bid).
 */
import { useRef, useState } from 'react';
import { supabase } from '../services/supabase';

type Props = {
  sectorId: string;
  signedIn: boolean;
  onClose: () => void;
  onOpened: (missionId: string) => void;
  t: (key: string, options?: { defaultValue?: string }) => string;
};

export default function CleanupSectorOffer({ sectorId, signedIn, onClose, onOpened, t }: Props) {
  const [price, setPrice] = useState('2');
  const [crowdfund, setCrowdfund] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (!signedIn || busy.current) return;
    const budget = Math.floor(Number(price));
    if (!Number.isFinite(budget) || budget < 2) {
      setError(t('vortexSectorOfferPrice', { defaultValue: 'Work budget must be at least $2.' }));
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('open_cleanup_sector_mission', {
        p_sector_id: sectorId,
        p_expected_price: budget,
        p_description: t('vortexSectorOfferDesc', {
          defaultValue: 'Cleanup Sector — this 200 m square needs a funded order.',
        }),
        p_photo_urls: [],
        p_crowdfunding_mode: crowdfund,
        p_token_bid: 1,
      });
      if (rpcError) {
        setError(rpcError.message || t('vortexSectorOfferFailed', { defaultValue: 'Could not open this sector.' }));
        return;
      }
      if (data) onOpened(String(data));
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  return (
    <div className="pointer-events-auto absolute bottom-24 left-3 right-3 z-[40] mx-auto max-w-md rounded-2xl border border-fuchsia-400/40 bg-slate-950/95 p-4 text-white shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-fuchsia-200">
        {t('vortexSectorOfferTitle', { defaultValue: 'Cleanup Sector' })}
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-slate-300">
        {signedIn
          ? t('vortexSectorOfferHint', {
              defaultValue: 'This square is closed to new free pins. Open a cleanup order in your name. Price and tokens follow the normal mission rules.',
            })
          : t('vortexSectorOfferNeedAuth', {
              defaultValue: 'Sign in to open a cleanup order for this square.',
            })}
      </p>
      {signedIn ? (
        <>
          <label className="mt-3 block text-[10px] uppercase tracking-[0.12em] text-slate-400">
            {t('vortexSectorOfferBudget', { defaultValue: 'Work budget (USD)' })}
            <input
              type="number"
              min={2}
              step={1}
              inputMode="numeric"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:ring-2 focus:ring-fuchsia-400/40"
            />
          </label>
          <label className="mt-2 flex items-center gap-2 text-[12px] text-slate-300">
            <input
              type="checkbox"
              checked={crowdfund}
              onChange={(event) => setCrowdfund(event.target.checked)}
            />
            {t('vortexSectorOfferCrowdfund', { defaultValue: 'Crowdfund instead of a direct bounty' })}
          </label>
          {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => void submit()}
              className="rounded-full border border-fuchsia-300/60 bg-fuchsia-500/20 px-4 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-fuchsia-50 disabled:opacity-50"
            >
              {pending
                ? t('vortexSectorOfferWorking', { defaultValue: 'Opening…' })
                : t('vortexSectorOfferFund', { defaultValue: 'Open cleanup order' })}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/15 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-300"
            >
              {t('close', { defaultValue: 'Close' })}
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={onClose}
          className="mt-3 rounded-full border border-white/15 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-300"
        >
          {t('close', { defaultValue: 'Close' })}
        </button>
      )}
    </div>
  );
}
