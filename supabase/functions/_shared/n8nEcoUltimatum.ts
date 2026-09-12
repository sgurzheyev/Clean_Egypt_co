/**
 * Eco-ultimatum n8n webhook (Wave D / P2-1c).
 *
 * Prefer Edge secrets:
 *   N8N_ECO_ULTIMATUM_WEBHOOK_URL
 *   N8N_ECO_ULTIMATUM_SECRET      (optional header X-Garbagin-N8n-Secret)
 *
 * Fallback: private.app_config keys of the same names (snake_case).
 * Unset URL = skip (fail-soft). Never throw to the caller.
 */
export type N8nDispatchResult =
  | { ok: true; skipped: true; reason: 'unset' }
  | { ok: true; skipped: false; status: number }
  | { ok: false; error: string };

export type N8nConfig = {
  url: string;
  secret: string | null;
};

export async function readN8nEcoUltimatumConfig(opts?: {
  lookupAppConfig?: (key: string) => Promise<string | null>;
}): Promise<N8nConfig | null> {
  let url = String(Deno.env.get('N8N_ECO_ULTIMATUM_WEBHOOK_URL') || '').trim();
  let secret = String(Deno.env.get('N8N_ECO_ULTIMATUM_SECRET') || '').trim();

  if (!url && opts?.lookupAppConfig) {
    url = String((await opts.lookupAppConfig('n8n_eco_ultimatum_webhook_url')) || '').trim();
    if (!secret) {
      secret = String((await opts.lookupAppConfig('n8n_eco_ultimatum_secret')) || '').trim();
    }
  }

  if (!url || url.includes('your-n8n.example')) return null;
  return { url, secret: secret || null };
}

export async function dispatchEcoUltimatumN8n(
  config: N8nConfig,
  payload: Record<string, unknown>
): Promise<N8nDispatchResult> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.secret) {
      headers['X-Garbagin-N8n-Secret'] = config.secret;
    }
    const res = await fetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        error: `n8n HTTP ${res.status} ${body.slice(0, 240)}`.trim(),
      };
    }
    return { ok: true, skipped: false, status: res.status };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.slice(0, 400) };
  }
}
