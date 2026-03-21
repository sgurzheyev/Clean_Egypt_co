/** Blocks contact exchange & off-platform deals in mission descriptions */

export const MISSION_DESCRIPTION_POLICY_ERROR =
  'Exchange of contact info or cash deals is forbidden. Use the platform for payments.';

/** 8+ consecutive digits (phone / long numbers) */
const PHONE_OR_LONG_DIGITS = /\d{8,}/;

/** URLs and common TLD hints */
const URL_LIKE =
  /https?:\/\/|www\.|\.com\b|\.net\b|\.org\b|\.io\b|\.co\b|\.app\b|\.me\b|\.eg\b|t\.me\/|telegram\.|wa\.me\/|@[a-z0-9._-]+\.[a-z]{2,}/i;

function hasForbiddenKeyword(s: string): boolean {
  const lower = s.toLowerCase();
  if (/\bcash\b/i.test(s) || /\bmoney\b/i.test(lower)) return true;
  if (/кеш/i.test(s) || /номер/i.test(s)) return true;
  return false;
}

export function validateMissionDescription(text: string): { ok: true } | { ok: false; error: string } {
  const s = String(text || '');
  if (PHONE_OR_LONG_DIGITS.test(s)) {
    return { ok: false, error: MISSION_DESCRIPTION_POLICY_ERROR };
  }
  if (URL_LIKE.test(s)) {
    return { ok: false, error: MISSION_DESCRIPTION_POLICY_ERROR };
  }
  if (hasForbiddenKeyword(s)) {
    return { ok: false, error: MISSION_DESCRIPTION_POLICY_ERROR };
  }
  return { ok: true };
}
