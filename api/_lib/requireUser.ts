/**
 * Shared auth for Vercel /api routes (Wave I / SEC-4).
 * Validate the user JWT with the anon key BEFORE any service-role read or OpenAI/Telegram call.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

export const TRANSLATE_MAX_CHARS = 8_000;
export const TRANSLATE_MAX_BODY_BYTES = 32_768;
export const IMAGE_MAX_BASE64_CHARS = 5_242_880; // ~4 MiB decoded
export const IMAGE_MAX_BODY_BYTES = 6_291_456;
export const JSON_MAX_BODY_BYTES = 65_536;

export type AuthedUser = {
  user: User;
  token: string;
  anon: SupabaseClient;
};

export type MissionMembershipRow = {
  id: string;
  creator_id: string | null;
  cleaner_id: string | null;
};

export function headerValue(req: VercelRequest, name: string): string {
  const key = name.toLowerCase();
  const raw = req.headers?.[key] ?? req.headers?.[name];
  if (Array.isArray(raw)) return String(raw[0] ?? '').trim();
  return String(raw ?? '').trim();
}

export function extractBearerToken(req: VercelRequest): string | null {
  const auth = headerValue(req, 'authorization');
  const match = auth.match(/^Bearer\s+(\S+)/i);
  const token = match?.[1]?.trim() || '';
  return token || null;
}

export function requestBodyBytes(req: VercelRequest): number {
  const cl = Number(headerValue(req, 'content-length'));
  if (Number.isFinite(cl) && cl >= 0) return cl;
  if (typeof req.body === 'string') return Buffer.byteLength(req.body);
  if (req.body && typeof req.body === 'object') {
    try {
      return Buffer.byteLength(JSON.stringify(req.body));
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }
  return 0;
}

export function isOversizedText(text: string, maxChars = TRANSLATE_MAX_CHARS): boolean {
  return text.length > maxChars;
}

export function isOversizedBase64(imageBase64: string, maxChars = IMAGE_MAX_BASE64_CHARS): boolean {
  return imageBase64.length > maxChars;
}

export function rejectIfOversized(
  req: VercelRequest,
  res: VercelResponse,
  maxBytes: number
): boolean {
  if (requestBodyBytes(req) > maxBytes) {
    res.status(413).json({ error: 'Payload too large' });
    return true;
  }
  return false;
}

function supabaseUrl(): string | null {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  return url || null;
}

function anonKey(): string | null {
  const key = String(process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  return key || null;
}

function serviceRoleKey(): string | null {
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return key || null;
}

export function createUserClient(accessToken: string): SupabaseClient | null {
  const url = supabaseUrl();
  const key = anonKey();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export function createServiceClient(): SupabaseClient | null {
  const url = supabaseUrl();
  const key = serviceRoleKey();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** 401 unless Authorization: Bearer <user access token> validates via GoTrue. */
export async function requireUser(
  req: VercelRequest,
  res: VercelResponse
): Promise<AuthedUser | null> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  const anon = createUserClient(token);
  if (!anon) {
    res.status(500).json({ error: 'Supabase server config missing' });
    return null;
  }

  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user?.id) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  return { user: data.user, token, anon };
}

/**
 * Call is_platform_admin with the **user** JWT client.
 * Never use the service-role client for this RPC — Wave F short-circuits service_role to true.
 */
export async function isPlatformAdminForUser(
  anon: SupabaseClient,
  userId: string
): Promise<{ ok: boolean; infraError?: string }> {
  const { data, error } = await anon.rpc('is_platform_admin', { p_uid: userId });
  if (error) {
    return { ok: false, infraError: error.message };
  }
  return { ok: data === true };
}

export function isMissionMember(
  uid: string,
  mission: Pick<MissionMembershipRow, 'creator_id' | 'cleaner_id'>
): boolean {
  return mission.creator_id === uid || mission.cleaner_id === uid;
}

/**
 * JWT first, then service-role mission load, then creator / assigned cleaner / platform admin.
 * Service role is never used until getUser succeeds.
 */
export async function requireMissionMember<T extends MissionMembershipRow>(
  req: VercelRequest,
  res: VercelResponse,
  missionId: string,
  select = 'id, creator_id, cleaner_id'
): Promise<{ auth: AuthedUser; mission: T; service: SupabaseClient } | null> {
  const auth = await requireUser(req, res);
  if (!auth) return null;

  const id = String(missionId || '').trim();
  if (!id) {
    res.status(400).json({ error: 'missionId is required' });
    return null;
  }

  const service = createServiceClient();
  if (!service) {
    res.status(500).json({ error: 'Supabase server config missing' });
    return null;
  }

  const { data: mission, error } = await service
    .from('missions')
    .select(select)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('requireMissionMember: mission fetch', error.message);
    res.status(500).json({ error: 'Failed to fetch mission' });
    return null;
  }
  if (!mission) {
    res.status(404).json({ error: 'Mission not found' });
    return null;
  }

  const row = mission as unknown as T;
  if (isMissionMember(auth.user.id, row)) {
    return { auth, mission: row, service };
  }

  const admin = await isPlatformAdminForUser(auth.anon, auth.user.id);
  if (admin.infraError) {
    console.error('requireMissionMember: is_platform_admin', admin.infraError);
    res.status(500).json({ error: 'Admin check failed' });
    return null;
  }
  if (!admin.ok) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  return { auth, mission: row, service };
}
