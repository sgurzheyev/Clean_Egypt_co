/**
 * Supabase `functions.invoke` often sets a generic message on non-2xx responses.
 * Parse JSON body (and `data.error`) so users see the real Edge Function message.
 */
export async function throwIfInvokeFailed(
  label: string,
  result: { data: unknown; error: Error | null }
): Promise<void> {
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

  const anyErr = error as { message?: string; context?: unknown } | null;
  const ctx = anyErr?.context;

  if (ctx) {
    console.error(`[${label}] error.context`, ctx);
  }

  const messageFromPayload = (payload: unknown): string | null => {
    if (!payload) return null;
    if (typeof payload === 'string' && payload.trim()) {
      try {
        const parsed = JSON.parse(payload) as { error?: unknown; message?: unknown };
        if (parsed?.error != null) return String(parsed.error);
        if (parsed?.message != null) return String(parsed.message);
      } catch {
        return payload;
      }
      return payload;
    }
    if (typeof payload === 'object' && payload !== null) {
      const obj = payload as { error?: unknown; message?: unknown };
      if (obj.error != null) return String(obj.error);
      if (obj.message != null) return String(obj.message);
    }
    return null;
  };

  // Newer supabase-js: context is a Fetch Response.
  if (ctx && typeof ctx === 'object' && typeof (ctx as Response).text === 'function') {
    try {
      const text = await (ctx as Response).clone().text();
      const msg = messageFromPayload(text);
      if (msg) throw new Error(msg);
    } catch (e) {
      if (e instanceof Error && e.message !== anyErr?.message) throw e;
    }
  }

  if (typeof ctx === 'object' && ctx !== null && 'body' in ctx) {
    const msg = messageFromPayload((ctx as { body?: unknown }).body);
    if (msg) throw new Error(msg);
  }

  if (error instanceof Error) throw error;
  throw new Error('Request failed');
}
