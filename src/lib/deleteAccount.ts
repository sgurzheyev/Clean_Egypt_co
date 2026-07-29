import { supabase } from '../../services/supabase';
import { throwIfInvokeFailed } from './supabaseFunctionError';

export type DeleteAccountResult = {
  ok: boolean;
  storage_removed?: number;
};

/**
 * Permanent GDPR erasure via Edge Function `delete-account`.
 * Pass confirm as exactly `DELETE` or `УДАЛИТЬ`.
 */
export async function requestDeleteAccount(confirm: string): Promise<DeleteAccountResult> {
  const result = await supabase.functions.invoke('delete-account', {
    body: { confirm: String(confirm || '').trim() },
  });
  await throwIfInvokeFailed('delete-account', result);
  const data = (result.data || {}) as DeleteAccountResult;
  if (!data.ok) {
    throw new Error('Account deletion failed');
  }
  return data;
}
