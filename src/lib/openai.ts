type AiResult = { score: number; verdict: string };

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

export async function runMissionAiAnalysis(args: {
  photo_urls: string[];
  after_photo_urls: string[];
}): Promise<AiResult> {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error('Missing VITE_OPENAI_API_KEY');
  }

  const prompt =
    `You are an environmental inspector. Compare the BEFORE and AFTER photos. Is the trash gone? ` +
    `Return a JSON object exactly like this: { "score": 95, "verdict": "Short explanation here" }.\n\n` +
    `BEFORE:\n${(args.photo_urls || []).join('\n')}\n\n` +
    `AFTER:\n${(args.after_photo_urls || []).join('\n')}\n`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI error (${res.status}): ${text || res.statusText}`);
  }

  const json = (await res.json()) as any;
  const content: string =
    json?.choices?.[0]?.message?.content ??
    '';

  const raw = extractJsonObject(content);
  if (!raw) {
    throw new Error('AI did not return JSON');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Failed to parse AI JSON');
  }

  const score = Number(parsed?.score);
  const verdict = String(parsed?.verdict ?? '').trim();
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error('AI returned invalid score');
  }
  if (!verdict) {
    throw new Error('AI returned empty verdict');
  }

  return { score: Math.round(score), verdict };
}

