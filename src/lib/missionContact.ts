import { supabase } from '../../services/supabase';

/** Masked placeholder — never a partial real number (roadmap: no preview digits). */
export const LOCKED_PHONE_MASK = '+20 1XX XXX XXXX';

function normalizePhoneInput(phone: string | null | undefined): string {
  return String(phone ?? '').trim();
}

export function toTelHref(phone: string | null | undefined): string {
  const raw = normalizePhoneInput(phone);
  if (!raw) return '';
  const digits = raw.replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : '';
}

/** WhatsApp wa.me link; strips non-digits except leading country code handling. */
export function toWhatsAppHref(phone: string | null | undefined): string | null {
  const raw = normalizePhoneInput(phone);
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  // Egyptian local 01xxxxxxxxx → 20…
  if (digits.startsWith('0') && digits.length >= 10) {
    digits = `20${digits.slice(1)}`;
  }
  return `https://wa.me/${digits}`;
}

/** Creator phone for a private mission — NULL unless authorized (RPC enforces). */
export async function getMissionClientPhone(missionId: string): Promise<string | null> {
  if (!missionId) return null;
  const { data, error } = await supabase.rpc('get_mission_client_phone', {
    p_mission_id: missionId,
  });
  if (error) throw error;
  const phone = String(data ?? '').trim();
  return phone || null;
}

export async function getOwnPhoneNumber(): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_own_phone_number');
  if (error) throw error;
  const phone = String(data ?? '').trim();
  return phone || null;
}

export async function getOwnContactEmail(): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_own_contact_email');
  if (error) throw error;
  const email = String(data ?? '').trim();
  return email || null;
}

export async function getMissionWorkerPhone(missionId: string): Promise<string | null> {
  if (!missionId) return null;
  const { data, error } = await supabase.rpc('get_mission_worker_phone', {
    p_mission_id: missionId,
  });
  if (error) throw error;
  const phone = String(data ?? '').trim();
  return phone || null;
}

/**
 * Client phone on public profile — only when viewer has an accepted/assigned
 * private mission with that client (RPC returns NULL otherwise).
 */
export async function getClientPhoneIfContracted(clientId: string): Promise<string | null> {
  if (!clientId) return null;
  const { data, error } = await supabase.rpc('get_client_phone_if_contracted', {
    p_client_id: clientId,
  });
  if (error) throw error;
  const phone = String(data ?? '').trim();
  return phone || null;
}
