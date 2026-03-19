type AiResult = { score: number; verdict: string };

type FraudAuditJson = {
  verified_status: 'fraud' | 'verified' | string;
  reasoning: string;
  landmark_consistency_score: number; // 0..1
  trash_removal_score: number; // 0..1
  suggested_score: number; // 0..1
};

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

  const systemPrompt =
    `Follow our AI CONSTITUTION v4.0. You are a strict but context-aware fraud detection auditor for CleanEgypt.co, reviewing 'Before' vs 'After' trash cleanup photos.\n\n` +
    `### CRITICAL STEP 1: CONTEXT & GEOMETRY MATCHING (FRAUD CHECK)\n` +
    `First, determine if the scene is OUTDOOR (beach, desert, street) or INDOOR (apartment, kitchen, room).\n\n` +
    `- IF OUTDOOR: Strictly verify the exact same location and perspective using static identifiers (buildings, unique trees, horizon, power poles). If the camera was turned to a completely different background, flag as FRAUD.\n` +
    `- IF INDOOR: Verify the room geometry (furniture layout, windows, walls, floor patterns, corners). In tight indoor spaces, allow for slight variations in camera angle or zoom, as long as it is unmistakably the exact same room and same specific spot.\n\n` +
    `### STEP 2: TRASH VERIFICATION\n` +
    `If and ONLY if Step 1 passes (the location matches), check if the specific trash, debris, or mess identified in 'before_photos' has been completely removed or cleaned in the 'after_photos'.\n\n` +
    `### OUTPUT FORMAT (JSON ONLY):\n` +
    `{\n` +
    `  "verified_status": "verified" | "fraud",\n` +
    `  "reasoning": "Brief explanation of your Step 1 and Step 2 findings.",\n` +
    `  "landmark_consistency_score": 0.0 to 1.0,\n` +
    `  "trash_removal_score": 0.0 to 1.0,\n` +
    `  "suggested_score": 0.0 to 1.0\n` +
    `}`;

  const userPrompt =
    `before_photos:\n${(args.photo_urls || []).join('\n')}\n\n` +
    `after_photos:\n${(args.after_photo_urls || []).join('\n')}\n`;

  console.log('CRITICAL AI DEBUG - URLs being sent:', {
    before_photos: args.photo_urls || [],
    after_photos: args.after_photo_urls || [],
  });

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userPrompt,
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

  // Backwards compatible parsing:
  // - v4.0 fraud-auditor schema: { verified_status, reasoning, landmark_consistency_score, trash_removal_score, suggested_score }
  // - legacy schema: { score: 95, verdict: "..." }
  const maybeSuggested = Number((parsed as any)?.suggested_score);
  const maybeReasoning = String((parsed as any)?.reasoning ?? '').trim();

  if (Number.isFinite(maybeSuggested)) {
    const audit = parsed as FraudAuditJson;
    const suggested = Number(audit.suggested_score);
    const landmark = Number(audit.landmark_consistency_score);
    const trash = Number(audit.trash_removal_score);
    const verifiedStatus = String(audit.verified_status ?? '').trim();
    const reasoning = String(audit.reasoning ?? '').trim();

    const in01 = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
    if (!in01(suggested) || !in01(landmark) || !in01(trash)) {
      throw new Error('AI returned invalid fraud-audit scores');
    }
    if (!reasoning) {
      throw new Error('AI returned empty reasoning');
    }

    const score = Math.round(suggested * 100);
    const verdict =
      `[${verifiedStatus || 'unknown'}] ` +
      `${reasoning}\n` +
      `Landmark match: ${(landmark * 100).toFixed(0)}% • Trash removal: ${(trash * 100).toFixed(0)}%`;

    return { score, verdict };
  }

  // Legacy fallback
  const score = Number((parsed as any)?.score);
  const verdict = String((parsed as any)?.verdict ?? '').trim();
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error('AI returned invalid score');
  }
  if (!verdict) {
    throw new Error('AI returned empty verdict');
  }

  return { score: Math.round(score), verdict };
}

