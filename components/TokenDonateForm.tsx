/**
 * Token hold on a free garbage pin or crowdfunding mission.
 * The RPC keeps the tokens in token_donations until the cleaner is paid
 * or the pin is hidden / expired, which refunds the donor.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../services/supabase';

const PRESETS = [1, 5, 10, 25];

type Props = {
  missionId: string;
  signedIn: boolean;
  isCreator: boolean;
  expiresAt?: string | null;
  onDonated?: (patch: {
    token_donation_pool: number;
    crowdfunding_expires_at: string;
    token_balance: number;
  }) => void;
};

function daysLeft(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

function donationErrorKey(message: string): string {
  const text = message.toLowerCase();
  if (text.includes('insufficient_tokens')) return 'donateTokensInsufficient';
  if (text.includes('token_donation_own_pin')) return 'donateTokensOwnPin';
  if (text.includes('token_donation_rate_limit')) return 'donateTokensRate';
  if (text.includes('token_donation_amount')) return 'donateTokensAmount';
  if (text.includes('token_donation_ineligible')) return 'donateTokensIneligible';
  return 'donateTokensFailed';
}

export default function TokenDonateForm({
  missionId,
  signedIn,
  isCreator,
  expiresAt,
  onDonated,
}: Props) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('5');
  const [pool, setPool] = useState(0);
  const [expires, setExpires] = useState<string | null>(expiresAt ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    setExpires(expiresAt ?? null);
  }, [expiresAt]);

  useEffect(() => {
    let cancelled = false;
    void supabase.rpc('get_mission_token_donation_summary', { p_mission_id: missionId }).then(({ data, error: rpcError }) => {
      if (cancelled || rpcError || !data || typeof data !== 'object') return;
      const row = data as { pool?: number; crowdfunding_expires_at?: string | null };
      if (Number.isFinite(Number(row.pool))) setPool(Number(row.pool));
      if (row.crowdfunding_expires_at) setExpires(row.crowdfunding_expires_at);
    });
    return () => {
      cancelled = true;
    };
  }, [missionId]);

  const left = daysLeft(expires);

  const submit = async () => {
    if (!signedIn || isCreator || busy.current) return;
    const tokens = Math.floor(Number(amount));
    if (!Number.isFinite(tokens) || tokens < 1 || tokens > 100) {
      setError(t('donateTokensAmount', { defaultValue: 'Choose between 1 and 100 tokens.' }));
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('donate_tokens_to_pin', {
        p_mission_id: missionId,
        p_tokens: tokens,
      });
      if (rpcError) {
        const key = donationErrorKey(rpcError.message || '');
        setError(t(key, { defaultValue: rpcError.message || 'Could not donate tokens.' }));
        return;
      }
      const row = (data && typeof data === 'object' ? data : {}) as {
        pool?: number;
        crowdfunding_expires_at?: string;
        token_balance?: number;
      };
      const nextPool = Number(row.pool);
      const nextExpires = row.crowdfunding_expires_at || expires;
      if (Number.isFinite(nextPool)) setPool(nextPool);
      if (nextExpires) setExpires(nextExpires);
      if (Number.isFinite(nextPool) && nextExpires) {
        onDonated?.({
          token_donation_pool: nextPool,
          crowdfunding_expires_at: nextExpires,
          token_balance: Number(row.token_balance),
        });
      }
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-cyan-400/25 bg-cyan-500/5 p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-200">
          {t('donateTokensTitle', { defaultValue: 'Donate tokens' })}
        </p>
        <p className="text-right text-[10px] font-bold tabular-nums text-slate-300">
          {t('donateTokensTotal', {
            count: pool,
            defaultValue: '{{count}} tokens donated',
          })}
          {left != null
            ? ` · ${t('donateTokensDaysLeft', {
                count: left,
                defaultValue: '{{count}} days left',
              })}`
            : ''}
        </p>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
        {isCreator
          ? t('donateTokensOwnPin', {
              defaultValue: 'Creators cannot donate tokens to their own pin.',
            })
          : signedIn
            ? t('donateTokensHint', {
                defaultValue:
                  'Held for the cleaner who finishes this pin. If it expires first, you get these tokens back plus 20%. Tokens cannot be cashed out.',
              })
            : t('donateTokensNeedAuth', { defaultValue: 'Sign in to donate tokens.' })}
      </p>
      {signedIn && !isCreator ? (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={amount === String(preset)}
                onClick={() => setAmount(String(preset))}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                  amount === String(preset)
                    ? 'border-cyan-300/70 bg-cyan-500/20 text-cyan-50'
                    : 'border-white/10 text-slate-300'
                }`}
              >
                {preset}
              </button>
            ))}
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-label={t('donateTokensTitle', { defaultValue: 'Donate tokens' })}
              className="w-16 rounded-full border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white outline-none"
            />
          </div>
          {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
          <button
            type="button"
            disabled={pending}
            onClick={() => void submit()}
            className="mt-2 rounded-full border border-cyan-300/50 bg-cyan-500/20 px-4 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-cyan-50 disabled:opacity-50"
          >
            {pending
              ? t('donateTokensWorking', { defaultValue: 'Donating…' })
              : t('donateTokensSubmit', { defaultValue: 'Donate tokens' })}
          </button>
        </>
      ) : null}
    </div>
  );
}
