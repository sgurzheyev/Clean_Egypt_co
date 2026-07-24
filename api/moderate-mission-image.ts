import type { VercelRequest, VercelResponse } from '@vercel/node';

type ModerationResult = {
  isApproved: boolean;
  reason: string;
};

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function languageName(code: string): string {
  const c = (code || 'en').split('-')[0].toLowerCase();
  const map: Record<string, string> = {
    en: 'English',
    ar: 'Arabic',
    ru: 'Russian',
    de: 'German',
    it: 'Italian',
    es: 'Spanish',
  };
  return map[c] || 'English';
}

function buildPrompt(lang: string): string {
  const language = languageName(lang);
  return [
    'You are a strict image safety filter for Garbagin.',
    'Approve ANY image that is Safe-For-Work.',
    'Do NOT judge whether the photo matches a cleaning/service context — relevance is not your job.',
    '',
    'Reject ONLY if the image contains:',
    '- Nudity or explicit sexual content',
    '- Pornography',
    '- Graphic violence or gore',
    '',
    `Respond with ONLY valid JSON (no markdown):`,
    `{ "isApproved": boolean, "reason": string }`,
    `- If approved: isApproved=true and reason=""`,
    `- If rejected: isApproved=false and reason=short user-facing message in ${language} (max 120 chars) about unsafe content only.`,
  ].join('\n');
}

function parseModerationResult(text: string): ModerationResult | null {
  const raw = extractJsonObject(text);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { isApproved?: unknown; reason?: unknown };
    if (typeof parsed.isApproved !== 'boolean') return null;
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
    return { isApproved: parsed.isApproved, reason };
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body as {
      imageBase64?: string;
      mimeType?: string;
      userLanguage?: string;
    };

    const imageBase64 = body?.imageBase64;
    const mimeType = body?.mimeType || 'image/jpeg';
    const userLanguage = String(body?.userLanguage || 'en');

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ isApproved: false, reason: 'Invalid image payload.' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('moderate-mission-image: OPENAI_API_KEY missing');
      return res.status(500).json({ isApproved: false, reason: 'Moderation service unavailable.' });
    }

    const dataUrl = imageBase64.startsWith('data:')
      ? imageBase64
      : `data:${mimeType};base64,${imageBase64}`;

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 120,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: buildPrompt(userLanguage) },
              {
                type: 'image_url',
                image_url: { url: dataUrl, detail: 'low' },
              },
            ],
          },
        ],
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error('moderate-mission-image OpenAI error', openaiRes.status, errText);
      return res.status(502).json({ isApproved: false, reason: 'Moderation service unavailable.' });
    }

    const data = (await openaiRes.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data?.choices?.[0]?.message?.content || '';
    const result = parseModerationResult(text);
    if (!result) {
      console.error('moderate-mission-image invalid JSON', text.slice(0, 300));
      return res.status(422).json({ isApproved: false, reason: 'Could not verify photo. Try another image.' });
    }

    return res.status(200).json(result);
  } catch (e: unknown) {
    console.error('moderate-mission-image error:', e);
    return res.status(500).json({ isApproved: false, reason: 'Moderation service error.' });
  }
}
