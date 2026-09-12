/**
 * True when the Edge Function could not be reached at all — i.e. supabase-js threw a
 * `FunctionsFetchError` ("Failed to send a request to the Edge Function"). This means
 * the function is not deployed, network/CORS failed, or the project ref is wrong —
 * NOT a business error returned by the function body.
 */
export function isEdgeFunctionUnreachable(error: unknown): boolean {
  if (!error) return false;
  const e = error as { name?: string; message?: string };
  const name = String(e.name || '');
  const msg = String(e.message || '');
  return (
    name === 'FunctionsFetchError' ||
    /failed to send a request to the edge function/i.test(msg) ||
    /failed to fetch/i.test(msg)
  );
}

export type InvokeFailure = Error & { code?: string; refunded?: boolean };

function throwInvokeError(
  message: string,
  extras?: string | { code?: string; refunded?: boolean }
): never {
  const parsed = typeof extras === 'string' ? { code: extras } : extras || {};
  throw Object.assign(new Error(message), parsed) as InvokeFailure;
}

function errorFromPayload(
  payload: unknown
): { message: string; code?: string; refunded?: boolean } | null {
  if (!payload) return null;
  if (typeof payload === 'string' && payload.trim()) {
    try {
      const parsed = JSON.parse(payload) as {
        error?: unknown;
        message?: unknown;
        code?: unknown;
        refunded?: unknown;
      };
      const message =
        parsed?.error != null
          ? String(parsed.error)
          : parsed?.message != null
            ? String(parsed.message)
            : '';
      if (message) {
        return {
          message,
          code: parsed?.code != null ? String(parsed.code) : undefined,
          refunded: parsed?.refunded === true,
        };
      }
    } catch {
      return { message: payload };
    }
    return { message: payload };
  }
  if (typeof payload === 'object' && payload !== null) {
    const obj = payload as {
      error?: unknown;
      message?: unknown;
      code?: unknown;
      refunded?: unknown;
    };
    const message =
      obj.error != null ? String(obj.error) : obj.message != null ? String(obj.message) : '';
    if (message) {
      return {
        message,
        code: obj.code != null ? String(obj.code) : undefined,
        refunded: obj.refunded === true,
      };
    }
  }
  return null;
}

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
    const parsed = errorFromPayload(data);
    throwInvokeError(String(dataError), {
      code: parsed?.code,
      refunded: parsed?.refunded,
    });
  }

  const anyErr = error as { message?: string; context?: unknown } | null;
  const ctx = anyErr?.context;

  if (ctx) {
    console.error(`[${label}] error.context`, ctx);
  }

  // Newer supabase-js: context is a Fetch Response.
  if (ctx && typeof ctx === 'object' && typeof (ctx as Response).text === 'function') {
    try {
      const text = await (ctx as Response).clone().text();
      const parsed = errorFromPayload(text);
      if (parsed) {
        throwInvokeError(parsed.message, {
          code: parsed.code,
          refunded: parsed.refunded,
        });
      }
    } catch (e) {
      if (e instanceof Error && e.message !== anyErr?.message) throw e;
    }
  }

  if (typeof ctx === 'object' && ctx !== null && 'body' in ctx) {
    const parsed = errorFromPayload((ctx as { body?: unknown }).body);
    if (parsed) {
      throwInvokeError(parsed.message, { code: parsed.code, refunded: parsed.refunded });
    }
  }

  if (error instanceof Error) throw error;
  throw new Error('Request failed');
}
