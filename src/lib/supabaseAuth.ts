import { supabase } from '../../services/supabase';

/** Refresh ~60s before JWT expiry so Edge Functions never see a stale Bearer. */
const TOKEN_REFRESH_SKEW_MS = 60_000;

type AuthSession = {
  access_token?: string | null;
  refresh_token?: string | null;
  expires_at?: number | null;
  user?: { id?: string | null } | null;
};

function isSessionExpiring(session: AuthSession | null | undefined): boolean {
  const expiresAt = session?.expires_at;
  if (expiresAt == null || !Number.isFinite(Number(expiresAt))) return false;
  return Number(expiresAt) * 1000 <= Date.now() + TOKEN_REFRESH_SKEW_MS;
}

function tokenFromSession(session: AuthSession | null | undefined): string | null {
  const token = String(session?.access_token || '').trim();
  return token || null;
}

async function refreshAuthSession(): Promise<AuthSession | null> {
  const { data, error } = await supabase.auth.refreshSession();
  if (error) return null;
  return (data.session as AuthSession | null) ?? null;
}

async function loadFreshSession(): Promise<AuthSession | null> {
  const { data } = await supabase.auth.getSession();
  let session = (data.session as AuthSession | null) ?? null;
  if (!session?.refresh_token) {
    return tokenFromSession(session) ? session : null;
  }
  if (!tokenFromSession(session) || isSessionExpiring(session)) {
    session = (await refreshAuthSession()) ?? session;
  }
  if (tokenFromSession(session) && !isSessionExpiring(session)) return session;
  return null;
}

/** Resolve the active user id, refreshing the session if needed. */
export async function resolveAuthenticatedUserId(
  fallbackUserId?: string | null
): Promise<string | null> {
  const session = await loadFreshSession();
  if (session?.user?.id) return session.user.id;

  const fallback = String(fallbackUserId || '').trim();
  return fallback || null;
}

/** Access token for Edge Function calls (waits for session hydration after redirects). */
export async function resolveAccessToken(maxAttempts = 8): Promise<string | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const session = await loadFreshSession();
    const token = tokenFromSession(session);
    if (token) return token;

    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  return null;
}

function invokeStatus(result: { data: unknown; error: Error | null }): number | null {
  const err = result.error as { context?: unknown; message?: string } | null;
  const ctx = err?.context;
  if (ctx instanceof Response) return ctx.status;
  if (ctx && typeof ctx === 'object' && 'status' in ctx) {
    const status = Number((ctx as { status?: unknown }).status);
    return Number.isFinite(status) ? status : null;
  }
  const dataError =
    result.data && typeof result.data === 'object' && result.data !== null && 'error' in result.data
      ? String((result.data as { error?: unknown }).error || '')
      : '';
  const message = `${err?.message || ''} ${dataError}`;
  if (/unauthorized|missing authorization|jwt expired|invalid jwt/i.test(message)) return 401;
  return null;
}

/**
 * Invoke a Supabase Edge Function with a fresh user JWT.
 * On 401, refresh the session once and retry instead of surfacing a console 401.
 */
export async function invokeAuthenticatedFunction(
  name: string,
  body: Record<string, unknown>
): Promise<{ data: unknown; error: Error | null }> {
  const attempt = async () => {
    const accessToken = await resolveAccessToken();
    if (!accessToken) {
      return {
        data: { error: 'Not authenticated' },
        error: Object.assign(new Error('Not authenticated'), { name: 'AuthSessionMissing' }),
      };
    }
    return supabase.functions.invoke(name, {
      body,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  };

  let result = await attempt();
  if (invokeStatus(result) === 401) {
    await refreshAuthSession();
    result = await attempt();
  }
  return result;
}
