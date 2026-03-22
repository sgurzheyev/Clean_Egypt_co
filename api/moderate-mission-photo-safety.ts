import type { VercelRequest, VercelResponse } from '@vercel/node';

const PROMPT =
  'Strict task: Return "EXPLICIT" ONLY if the image contains: 1. Hardcore pornography or nudity. 2. Visible phone numbers, social media handles, or QR codes written on objects/walls/paper in the photo. For ALL other content (trash, faces, animals, vehicles), you MUST return "SAFE". Your default is SAFE unless sex or contact info is detected. Return only "SAFE" or "EXPLICIT".';

function parseVerdict(text: string): 'SAFE' | 'EXPLICIT' | null {
  const t = text.trim().toUpperCase();
  if (t.includes('EXPLICIT')) return 'EXPLICIT';
  if (t.includes('SAFE')) return 'SAFE';
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body as { imageBase64?: string; mimeType?: string };
    const imageBase64 = body?.imageBase64;
    const mimeType = body?.mimeType || 'image/jpeg';

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'imageBase64 is required' });
    }

    const dataUrl = imageBase64.startsWith('data:')
      ? imageBase64
      : `data:${mimeType};base64,${imageBase64}`;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not configured' });
    }

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 24,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
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
      console.error('moderate-mission-photo-safety OpenAI error', openaiRes.status, errText);
      return res.status(502).json({ error: 'Vision service unavailable' });
    }

    const data = (await openaiRes.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data?.choices?.[0]?.message?.content || '';
    const verdict = parseVerdict(text);
    if (!verdict) {
      return res.status(422).json({ error: 'Invalid moderation response', raw: text.slice(0, 200) });
    }

    return res.status(200).json({ verdict });
  } catch (e: unknown) {
    console.error('moderate-mission-photo-safety', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
