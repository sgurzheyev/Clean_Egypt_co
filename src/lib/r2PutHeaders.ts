/**
 * Browser PUT headers for a presigned R2 URL.
 * Kept free of the Supabase client so unit tests can import it.
 */

/** Headers the browser is allowed to set. Content-Length is a forbidden fetch header. */
export function browserPutHeaders(
  serverHeaders: Record<string, string> | undefined,
  contentType: string
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(serverHeaders || {})) {
    if (!value || /^content-length$/i.test(key)) continue;
    out[key] = value;
  }
  if (!Object.keys(out).some((key) => key.toLowerCase() === 'content-type')) {
    out['Content-Type'] = contentType;
  }
  return out;
}

/** `sub` from our own access token. Used only to echo a header the signer already baked in. */
export function userIdFromAccessToken(accessToken: string): string | null {
  try {
    const part = accessToken.split('.')[1];
    if (!part) return null;
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof json.sub === 'string' && json.sub ? json.sub : null;
  } catch {
    return null;
  }
}

/** Header names included in the SigV4 signature (`X-Amz-SignedHeaders`). */
export function signedAmzHeaderNames(uploadUrl: string): Set<string> {
  try {
    const raw = new URL(uploadUrl).searchParams.get('X-Amz-SignedHeaders') || '';
    return new Set(
      raw
        .split(';')
        .map((part) => {
          try {
            return decodeURIComponent(part).trim().toLowerCase();
          } catch {
            return part.trim().toLowerCase();
          }
        })
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

/**
 * PUT headers for a presigned R2 URL.
 * The live signer includes `x-amz-meta-*` in the signature but does not return
 * those headers to the browser. Echo them only when they are actually signed,
 * so a newer presign (Content-Type only) is not broken by extra unsigned meta.
 */
export function presignedBrowserPutHeaders(input: {
  uploadUrl: string;
  serverHeaders?: Record<string, string>;
  contentType: string;
  metadata?: Record<string, string | null | undefined>;
}): Record<string, string> {
  const headers = browserPutHeaders(input.serverHeaders, input.contentType);
  const signed = signedAmzHeaderNames(input.uploadUrl);
  if (signed.size === 0) return headers;
  for (const [key, value] of Object.entries(input.metadata || {})) {
    if (!value) continue;
    const header = key.toLowerCase().startsWith('x-amz-meta-')
      ? key.toLowerCase()
      : `x-amz-meta-${key.toLowerCase()}`;
    if (signed.has(header)) headers[header] = value;
  }
  return headers;
}
