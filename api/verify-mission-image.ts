import type { VercelRequest, VercelResponse } from '@vercel/node';

type VisionResult = {
  status: 'approved' | 'rejected';
  reason?: 'sexual_content' | 'unrelated' | string;
  keywords?: string[];
  suggestions?: string;
};

const PROMPT = `Analyze this image for a cleanup platform. Return ONLY valid JSON:

{"status": "approved" | "rejected", "reason": null, "keywords": ["keyword1", "keyword2", "keyword3"], "suggestions": "one-line recommendation"}

For ANY image, always provide up to 3 descriptive keywords (e.g. "Plastic", "Street debris", "Large waste", "Trash pile", "Home clutter"). Use simple English when possible.

Status: APPROVE if it shows waste, trash, debris, or messy environment. REJECT otherwise (selfie, meme, clean nature).`;

function extractJson(text: string): VisionResult | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as VisionResult;
    if (parsed.status === 'approved' || parsed.status === 'rejected') {
      if (!Array.isArray(parsed.keywords)) parsed.keywords = [];
      return parsed;
    }
  } catch {
    /* ignore */
  }
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
        max_tokens: 256,
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
      console.error('verify-mission-image OpenAI error', openaiRes.status, errText);
      return res.status(502).json({ error: 'Vision service unavailable' });
    }

    const data = (await openaiRes.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data?.choices?.[0]?.message?.content || '';
    const parsed = extractJson(text);
    if (!parsed) {
      return res.status(422).json({ error: 'Invalid vision response', raw: text.slice(0, 200) });
    }

    return res.status(200).json(parsed);
  } catch (e: unknown) {
    console.error('verify-mission-image', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
