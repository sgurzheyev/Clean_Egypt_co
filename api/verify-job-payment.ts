import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey || !supabaseAnonKey) {
  throw new Error('Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_ANON_KEY');
}

const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey);
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

/** Client-side fallback when Paymob webhook fails or arrives late.
 * Moves job from job_payment_pending into jobs table. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.body?.access_token;
    if (!token) return res.status(401).json({ error: 'Missing Authorization or access_token' });

    const { data: { user }, error: authErr } = await supabaseAnon.auth.getUser(token);
    if (authErr || !user?.id) return res.status(401).json({ error: 'Invalid or expired token' });

    const userId = user.id;

    const { data: pending, error: selErr } = await supabaseAdmin
      .from('job_payment_pending')
      .select('id, creator_id, task_type, amount, location_lat, location_lng, description')
      .eq('creator_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (selErr) {
      console.error('verify-job-payment select error:', selErr.message);
      return res.status(500).json({ error: 'Failed to check pending jobs' });
    }

    if (!pending) {
      return res.status(200).json({ moved: false });
    }

    const { error: insertErr } = await supabaseAdmin.from('jobs').insert({
      creator_id: pending.creator_id,
      task_type: pending.task_type,
      amount: pending.amount,
      location_lat: pending.location_lat,
      location_lng: pending.location_lng,
      description: pending.description ?? null,
      status: 'pending',
    });

    if (insertErr) {
      console.error('verify-job-payment insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to create job' });
    }

    const { error: delErr } = await supabaseAdmin
      .from('job_payment_pending')
      .delete()
      .eq('id', pending.id);

    if (delErr) {
      console.error('verify-job-payment delete error:', delErr.message);
      // Job already created; non-fatal
    }

    return res.status(200).json({ moved: true });
  } catch (e: any) {
    console.error('verify-job-payment error:', e?.message);
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
}
