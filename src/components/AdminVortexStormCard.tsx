/**
 * Analytics pillar: Garba-Vortex storm indicator.
 * English labels match the rest of the admin console.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../services/supabase';
import { isMissingRpcError } from '../lib/garbaVortex';

type StormMode = 'off' | 'auto' | 'on';

type StormStatus = {
  storm: boolean;
  reason: string;
  mode: StormMode;
  global_writes: number;
  global_threshold: number;
  peak_region_writes: number;
  peak_region_key: string | null;
  region_threshold: number;
  region_km: number;
  evaluated_at: string | null;
  active_since: string | null;
  snapshot_refreshed_at: string | null;
  snapshot_cells: number;
  cache_seconds: number;
  storm_free_pins_per_day: number;
  storm_bump_radius_m: number;
  free_pins_per_day: number;
  bump_radius_m: number;
};

type Draft = {
  mode: StormMode;
  global: string;
  region: string;
  daily: string;
  bump: string;
};

const BTN =
  'px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.14em] border transition-all disabled:opacity-50';

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asStatus(raw: unknown): StormStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const mode = row.mode === 'on' || row.mode === 'off' ? row.mode : 'auto';
  return {
    storm: row.storm === true,
    reason: String(row.reason || 'clear'),
    mode,
    global_writes: num(row.global_writes),
    global_threshold: num(row.global_threshold, 60),
    peak_region_writes: num(row.peak_region_writes),
    peak_region_key: row.peak_region_key ? String(row.peak_region_key) : null,
    region_threshold: num(row.region_threshold, 12),
    region_km: num(row.region_km, 25),
    evaluated_at: row.evaluated_at ? String(row.evaluated_at) : null,
    active_since: row.active_since ? String(row.active_since) : null,
    snapshot_refreshed_at: row.snapshot_refreshed_at ? String(row.snapshot_refreshed_at) : null,
    snapshot_cells: num(row.snapshot_cells),
    cache_seconds: num(row.cache_seconds, 30),
    storm_free_pins_per_day: num(row.storm_free_pins_per_day, 1),
    storm_bump_radius_m: num(row.storm_bump_radius_m, 500),
    free_pins_per_day: num(row.free_pins_per_day, 5),
    bump_radius_m: num(row.bump_radius_m, 200),
  };
}

function draftFrom(status: StormStatus): Draft {
  return {
    mode: status.mode,
    global: String(status.global_threshold),
    region: String(status.region_threshold),
    daily: String(status.storm_free_pins_per_day),
    bump: String(status.storm_bump_radius_m),
  };
}

function ageLabel(iso: string | null): string {
  if (!iso) return 'not built';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

export default function AdminVortexStormCard() {
  const [status, setStatus] = useState<StormStatus | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'refresh' | null>(null);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('admin_get_garba_vortex_storm');
    if (rpcError) {
      if (isMissingRpcError(rpcError)) {
        setMissing(true);
        setError(null);
        return;
      }
      setError(rpcError.message || 'Could not read storm status');
      return;
    }
    const next = asStatus(data);
    if (!next) {
      setError('Storm status was empty');
      return;
    }
    setMissing(false);
    setError(null);
    setStatus(next);
    setDraft((prev) => (dirty && prev ? prev : draftFrom(next)));
  }, [dirty]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(id);
  }, [load]);

  const patchDraft = (partial: Partial<Draft>) => {
    setDirty(true);
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev));
  };

  const save = async (refreshSnapshot: boolean) => {
    if (!draft || busyRef.current) return;
    const global = Math.round(Number(draft.global));
    const region = Math.round(Number(draft.region));
    const daily = Math.round(Number(draft.daily));
    const bump = Math.round(Number(draft.bump));
    if (![global, region, daily, bump].every(Number.isFinite)) {
      setError('Thresholds must be numbers');
      return;
    }
    busyRef.current = true;
    setBusy(refreshSnapshot ? 'refresh' : 'save');
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_set_garba_vortex_storm', {
        p_mode: draft.mode,
        p_global_writes_per_minute: global,
        p_region_writes_per_minute: region,
        p_storm_free_pins_per_day: daily,
        p_storm_bump_radius_m: bump,
        p_refresh: refreshSnapshot,
      });
      if (rpcError) {
        setError(rpcError.message || 'Could not update storm mode');
        return;
      }
      const next = asStatus(data);
      if (next) {
        setStatus(next);
        setDraft(draftFrom(next));
        setDirty(false);
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  return (
    <section className="rounded-2xl border border-fuchsia-400/30 bg-gradient-to-br from-fuchsia-950/40 via-slate-950 to-slate-950 p-4 shadow-[0_0_24px_rgba(217,70,239,0.12)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[10px] font-black uppercase tracking-[0.18em] text-fuchsia-200/90">
          Garba-Vortex storm
        </h4>
        {status ? (
          <span
            className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${
              status.storm
                ? 'border-rose-400/60 bg-rose-500/20 text-rose-100'
                : 'border-cyan-400/40 bg-cyan-500/10 text-cyan-100'
            }`}
          >
            {status.storm ? 'Storm' : 'Calm'}
          </span>
        ) : null}
      </div>

      {missing ? (
        <p className="text-xs text-slate-400">
          Storm controls appear after <span className="font-mono text-slate-300">20260927130000_garba_vortex_storm.sql</span> is applied.
        </p>
      ) : (
        <>
          <p className="text-[11px] leading-relaxed text-slate-400">
            A spike in free-pin writes switches the map to a cached average and tightens the free-pin cap.
            Reason: <span className="font-mono text-slate-200">{status?.reason ?? '…'}</span>
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Meter label="Global / min" value={status?.global_writes ?? 0} max={status?.global_threshold ?? 0} />
            <Meter
              label={`Region / min · ${status?.region_km ?? 25} km`}
              value={status?.peak_region_writes ?? 0}
              max={status?.region_threshold ?? 0}
              hint={status?.peak_region_key || 'no region'}
            />
            <Meter
              label="Snapshot"
              value={status?.snapshot_cells ?? 0}
              max={status?.snapshot_cells ?? 0}
              hint={ageLabel(status?.snapshot_refreshed_at ?? null)}
              plain
            />
            <Meter
              label="HTTP cache"
              value={status?.storm ? status.cache_seconds : 0}
              max={status?.cache_seconds ?? 30}
              hint={status?.storm ? 'public' : 'no-store'}
              plain
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Storm mode">
            {(
              [
                ['auto', 'Auto'],
                ['on', 'Force on'],
                ['off', 'Force off'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={draft?.mode === id}
                onClick={() => patchDraft({ mode: id })}
                className={`${BTN} ${
                  draft?.mode === id
                    ? 'border-fuchsia-300/70 bg-fuchsia-500/20 text-fuchsia-50'
                    : 'border-white/15 bg-white/5 text-slate-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field
              label="Global writes / min"
              value={draft?.global ?? ''}
              onChange={(global) => patchDraft({ global })}
            />
            <Field
              label="Region writes / min"
              value={draft?.region ?? ''}
              onChange={(region) => patchDraft({ region })}
            />
            <Field
              label={`Storm free pins / day (calm ${status?.free_pins_per_day ?? 5})`}
              value={draft?.daily ?? ''}
              onChange={(daily) => patchDraft({ daily })}
            />
            <Field
              label={`Storm bump m (calm ${status?.bump_radius_m ?? 200})`}
              value={draft?.bump ?? ''}
              onChange={(bump) => patchDraft({ bump })}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!draft || busy !== null}
              onClick={() => void save(false)}
              className={`${BTN} border-fuchsia-400/50 bg-fuchsia-500/15 text-fuchsia-100`}
            >
              {busy === 'save' ? 'Saving…' : 'Save storm tune'}
            </button>
            <button
              type="button"
              disabled={!draft || busy !== null}
              onClick={() => void save(true)}
              className={`${BTN} border-cyan-400/40 bg-cyan-500/10 text-cyan-100`}
            >
              {busy === 'refresh' ? 'Refreshing…' : 'Save + refresh snapshot'}
            </button>
          </div>
          {status?.active_since ? (
            <p className="mt-2 text-[10px] uppercase tracking-[0.14em] text-rose-200/80">
              Active since {new Date(status.active_since).toLocaleString()}
            </p>
          ) : null}
          {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
        </>
      )}
    </section>
  );
}

function Meter({
  label,
  value,
  max,
  hint,
  plain = false,
}: {
  label: string;
  value: number;
  max: number;
  hint?: string;
  plain?: boolean;
}) {
  const hot = !plain && max > 0 && value >= max;
  return (
    <div className="rounded-xl border border-white/10 bg-black/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-black tabular-nums ${hot ? 'text-rose-200' : 'text-slate-100'}`}>
        {plain ? value : `${value} / ${max}`}
      </p>
      {hint ? <p className="truncate text-[10px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-[10px] uppercase tracking-[0.12em] text-slate-500">
      {label}
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-xl border border-white/15 bg-black/50 px-2 py-1.5 text-sm normal-case tracking-normal text-white outline-none focus:ring-2 focus:ring-fuchsia-500/30"
      />
    </label>
  );
}
