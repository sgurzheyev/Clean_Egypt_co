const translationCache = new Map<string, string>();

/** Detect likely source language from mission user text. */
export function detectMissionTextLanguage(text: string): 'ar' | 'ru' | 'en' {
  const sample = String(text || '');
  if (/[\u0600-\u06FF]/.test(sample)) return 'ar';
  if (/[\u0400-\u04FF]/.test(sample)) return 'ru';
  return 'en';
}

export function missionTextNeedsTranslation(text: string, targetLanguage: string): boolean {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  const target = (targetLanguage || 'en').split('-')[0].toLowerCase();
  return detectMissionTextLanguage(trimmed) !== target;
}

function maskHashtags(text: string): { masked: string; tags: string[] } {
  const tags: string[] = [];
  const masked = text.replace(/#\S+/g, (tag) => {
    const token = `⟦HT${tags.length}⟧`;
    tags.push(tag);
    return token;
  });
  return { masked, tags };
}

function restoreHashtags(text: string, tags: string[]): string {
  let restored = text;
  tags.forEach((tag, index) => {
    const token = `⟦HT${index}⟧`;
    restored = restored.split(token).join(tag);
    restored = restored.replace(new RegExp(`\\[HT${index}\\]`, 'g'), tag);
  });
  return restored;
}

export async function translateMissionText(
  text: string,
  targetLanguage: string
): Promise<string> {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';

  const target = (targetLanguage || 'en').split('-')[0].toLowerCase();
  const cacheKey = `${target}::${trimmed}`;
  const cached = translationCache.get(cacheKey);
  if (cached) return cached;

  const { masked, tags } = maskHashtags(trimmed);

  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: masked, targetLanguage: target }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string })?.error || 'Translate failed');
  }

  const payload = (await res.json()) as { translation?: string };
  const raw = payload.translation?.trim() || '';
  if (!raw) throw new Error('No translation returned');

  const restored = restoreHashtags(raw, tags);
  translationCache.set(cacheKey, restored);
  return restored;
}
