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

  const prompt =
    `Follow our AI CONSTITUTION v4.0. You are a strict fraud detection auditor for CleanEgypt.co, reviewing 'Before' vs 'After' trash cleanup photos. ` +
    `Your goal is to detect if a user is trying to trick the system by changing the camera angle or location.\n\n` +
    `INPUT: You will receive an array of 'before_photos' and an array of 'after_photos'.\n\n` +
    `### CRITICAL STEP 1: LANDMARK & LOCATION MATCHING (FRAUD CHECK)\n` +
    `Before checking for trash removal, you MUST strictly verify if the exact same location and perspective are used in both arrays.\n` +
    `- Rely only on static, unique identifiers: Buildings, unique trees, power poles, wall patterns, and background skylines. General sand or common dirt fields are NOT enough.\n` +
    `- Detection Scenario (Turned Camera): If the 'before_photos' show landmarks that are absent in 'after_photos', you MUST flag this as FRAUD. The cleaner simply turned the camera to a clean spot nearby.\n\n` +
    `### STEP 2: TRASH VERIFICATION (If Step 1 Passes)\n` +
    `If and ONLY if the locations are a 95%+ match, check if the specific trash piles identified in 'before_photos' have been completely removed.\n\n` +
    `### OUTPUT FORMAT: JSON ONLY\n` +
    `Return a structured JSON object with exactly these fields:\n` +
    `- verified_status: "fraud" or "verified"\n` +
    `- reasoning: short explanation. If fraud, MUST start with "FRAUD DETECTED:"\n` +
    `- landmark_consistency_score: number 0..1\n` +
    `- trash_removal_score: number 0..1\n` +
    `- suggested_score: number 0..1 (overall score; if fraud this must be 0)\n\n` +
    `before_photos:\n${(args.photo_urls || []).join('\n')}\n\n` +
    `after_photos:\n${(args.after_photo_urls || []).join('\n')}\n`;

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

