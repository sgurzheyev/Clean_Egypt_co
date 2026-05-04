/**
 * Supabase `functions.invoke` often sets a generic message on non-2xx responses.
 * Parse JSON body (and `data.error`) so users see the real Edge Function message.
 */
export function throwIfInvokeFailed(
  label: string,
  result: { data: unknown; error: Error | null }
): void {
  const { data, error } = result;

  const dataError =
    data && typeof data === 'object' && data !== null && 'error' in data
      ? (data as { error?: unknown }).error
      : undefined;
  const hasDataError = dataError !== undefined && dataError !== null;

  if (!error && !hasDataError) return;

  console.error(`[${label}] edge function invoke`, { data, error });

  if (hasDataError) {
    throw new Error(String(dataError));
  }

  const anyErr = error as { message?: string; context?: { body?: unknown } } | null;
  const ctxBody = anyErr?.context?.body;

  if (anyErr?.context) {
    console.error(`[${label}] error.context`, anyErr.context);
  }

  if (typeof ctxBody === 'string' && ctxBody.trim()) {
    let parsed: { error?: unknown; message?: unknown } | null = null;
    try {
      parsed = JSON.parse(ctxBody) as { error?: unknown; message?: unknown };
    } catch {
      throw new Error(ctxBody);
    }
    if (parsed?.error != null) throw new Error(String(parsed.error));
    if (parsed?.message != null) throw new Error(String(parsed.message));
  }

  if (ctxBody && typeof ctxBody === 'object' && ctxBody !== null && 'error' in ctxBody) {
    throw new Error(String((ctxBody as { error: unknown }).error));
  }

  if (error instanceof Error) throw error;
  throw new Error('Request failed');
}
