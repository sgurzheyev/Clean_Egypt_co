import { supabase } from '../../services/supabase';

/** Resolve the active user id, refreshing the session if needed. */
export async function resolveAuthenticatedUserId(
  fallbackUserId?: string | null
): Promise<string | null> {
  if (fallbackUserId) return fallbackUserId;

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (!userErr && userData.user?.id) return userData.user.id;

  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session?.user?.id) return sessionData.session.user.id;

  const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
  if (!refreshErr && refreshed.session?.user?.id) return refreshed.session.user.id;

  return null;
}

/** Access token for Edge Function calls (waits for session hydration after redirects). */
export async function resolveAccessToken(maxAttempts = 8): Promise<string | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session?.access_token) {
      return sessionData.session.access_token;
    }

    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      const { data: retrySession } = await supabase.auth.getSession();
      if (retrySession.session?.access_token) {
        return retrySession.session.access_token;
      }
    }

    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
  if (!refreshErr && refreshed.session?.access_token) {
    return refreshed.session.access_token;
  }

  return null;
}
