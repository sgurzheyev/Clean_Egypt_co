import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_USD_TO_EGP_RATE } from '../../constants';

/**
 * Reads the live USD→EGP rate from `platform_settings` (id=1).
 * On any failure or invalid value, returns {@link DEFAULT_USD_TO_EGP_RATE}.
 */
export async function fetchUsdToEgpRate(client: SupabaseClient): Promise<number> {
  try {
    const { data, error } = await client
      .from('platform_settings')
      .select('usd_to_egp_rate')
      .eq('id', 1)
      .maybeSingle();

    if (error) throw error;
    const raw = data?.usd_to_egp_rate;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(n) && n > 0 && n <= 1000) return n;
  } catch {
    // fall through
  }
  return DEFAULT_USD_TO_EGP_RATE;
}
