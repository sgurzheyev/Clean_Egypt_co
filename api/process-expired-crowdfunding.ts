/**
 * Cron/webhook endpoint to process expired Garbage Removal crowdfunding campaigns.
 * Calls Supabase RPC `process_expired_crowdfunding_missions()` with service role.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // OPS-1: Strict auth verification against configured secret
  const expectedSecret = process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const authHeader = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const cronHeader = String(req.headers?.['x-cron-secret'] || '').trim();
  const provided = cronHeader || authHeader;

  if (!expectedSecret || provided !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized: valid cron secret required' });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: 'Supabase service role config missing' });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: count, error } = await supabase.rpc('process_expired_crowdfunding_missions');
    if (error) {
      console.error('[process-expired-crowdfunding] RPC failed:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      ok: true,
      processed_expired: count ?? 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[process-expired-crowdfunding]', err);
    return res.status(500).json({ error: err?.message || 'Failed' });
  }
}
