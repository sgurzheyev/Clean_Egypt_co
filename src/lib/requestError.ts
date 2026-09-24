/**
 * Browser fetch failures surface as a raw TypeError ("Failed to fetch" / WebKit
 * "Load failed"). Map those to a product string; leave PostgREST / RPC messages
 * (Insufficient tokens, validation) intact.
 */

const NETWORK_FAILURE =
  /failed to fetch|failed to send a request to the edge function|networkerror|network request failed|load failed|network_unreachable|the internet connection appears to be offline/i;

export function isBrowserNetworkFailure(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'string') return NETWORK_FAILURE.test(error);
  const e = error as { name?: string; message?: string };
  if (e.name === 'FunctionsFetchError') return true;
  return NETWORK_FAILURE.test(String(e.message || ''));
}

/** Message safe to show under a form. `fallback` is the translated network copy. */
export function userFacingRequestMessage(error: unknown, fallback: string): string {
  if (isBrowserNetworkFailure(error)) return fallback;
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return fallback;
}
