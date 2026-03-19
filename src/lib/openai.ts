type AiResult = { score: number; verdict: string };

type FraudAuditJson = {
  verified_status: 'fraud' | 'verified' | string;
  reasoning: string;
  landmark_consistency_score: number; // 0..1
  trash_removal_score: number; // 0..1
  suggested_score?: number; // 0..1 (legacy/optional)
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
  mission_title?: string;
  mission_description?: string;
}): Promise<AiResult> {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error('Missing VITE_OPENAI_API_KEY');
  }

  const systemPrompt =
    `You are the ultimate 'God-Mode' AI Auditor for CleanEgypt.co, a marketplace for cleaning tasks. ` +
    `You evaluate tasks based on Before/After photos and the customer's text description.\n\n` +
    `MISSION CONTEXT:\n` +
    `Title: "${args.mission_title || ''}"\n` +
    `Description: "${args.mission_description || ''}"\n\n` +
    `Perform the following strict checks in order. If ANY step fails, immediately flag as "fraud".\n\n` +
    `STEP 1: TROLL, NSFW & PROFANITY FILTER (CRITICAL)\n` +
    `- Scan all images for nudity, inappropriate content, animal body parts, or irrelevant troll images.\n` +
    `- Analyze the mission text and images for hidden phone numbers, emails, or social media handles (users trying to bypass our platform).\n` +
    `- Check text for profanity or abusive language.\n` +
    `- IF FOUND: verified_status = "fraud", reasoning = "Policy Violation: [Explain what was found]".\n\n` +
    `STEP 2: CONTEXT & RELEVANCE\n` +
    `- Does the 'Before' imagery match the Mission Context? If the text says "clean the apartment kitchen" but the photo is a desert, or if the text is nonsense, fail it.\n\n` +
    `STEP 3: LOCATION GEOMETRY (THE ANTI-CHEAT)\n` +
    `- Ensure the 'After' photos are taken at the EXACT SAME location as the 'Before' photos.\n` +
    `- For OUTDOORS: Match buildings, horizon, static objects.\n` +
    `- For INDOORS: Match room layout, furniture, walls. Allow slight angle changes for tight spaces.\n\n` +
    `STEP 4: TASK COMPLETION\n` +
    `- Based on the Mission Context, did the worker actually complete the requested task (e.g., washed windows, removed specific garbage)?\n\n` +
    `OUTPUT FORMAT (JSON ONLY):\n` +
    `{\n` +
    `  "verified_status": "verified" | "fraud",\n` +
    `  "reasoning": "Step-by-step breakdown (Step 1-4) explaining your decision.",\n` +
    `  "landmark_consistency_score": 0.0 to 1.0,\n` +
    `  "trash_removal_score": 0.0 to 1.0\n` +
    `}`;

  const userPrompt =
    `before_photos:\n${(args.photo_urls || []).join('\n')}\n\n` +
    `after_photos:\n${(args.after_photo_urls || []).join('\n')}\n`;

  console.log('CRITICAL AI DEBUG - URLs being sent:', {
    before_photos: args.photo_urls || [],
    after_photos: args.after_photo_urls || [],
    mission_title: args.mission_title || '',
    mission_description: args.mission_description || '',
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
  // - v5.0 schema: { verified_status, reasoning, landmark_consistency_score, trash_removal_score }
  // - v4.0 schema: { verified_status, reasoning, landmark_consistency_score, trash_removal_score, suggested_score }
  // - legacy schema: { score: 95, verdict: "..." }
  const maybeSuggested = Number((parsed as any)?.suggested_score);
  const maybeLandmark = Number((parsed as any)?.landmark_consistency_score);
  const maybeTrash = Number((parsed as any)?.trash_removal_score);
  const maybeStatus = String((parsed as any)?.verified_status ?? '').trim();
  const maybeReasoning = String((parsed as any)?.reasoning ?? '').trim();

  if (
    maybeReasoning &&
    maybeStatus &&
    Number.isFinite(maybeLandmark) &&
    Number.isFinite(maybeTrash)
  ) {
    const audit = parsed as FraudAuditJson;
    const landmark = Number(audit.landmark_consistency_score);
    const trash = Number(audit.trash_removal_score);
    const verifiedStatus = String(audit.verified_status ?? '').trim();
    const reasoning = String(audit.reasoning ?? '').trim();

    const in01 = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
    if (!in01(landmark) || !in01(trash)) {
      throw new Error('AI returned invalid fraud-audit scores');
    }
    if (!reasoning) {
      throw new Error('AI returned empty reasoning');
    }

    const suggestedFromModel = Number(audit.suggested_score);
    const suggested =
      Number.isFinite(suggestedFromModel) && in01(suggestedFromModel)
        ? suggestedFromModel
        : verifiedStatus.toLowerCase() === 'fraud'
          ? 0
          : (landmark + trash) / 2;
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

