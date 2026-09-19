import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendTelegramAlert } from '../lib/telegram';
import { JSON_MAX_BODY_BYTES, rejectIfOversized, requireMissionMember } from './_lib/requireUser';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { jobId } = req.body as { jobId?: string };
    if (!(await requireMissionMember(req, res, String(jobId || '')))) return;

    if (rejectIfOversized(req, res, JSON_MAX_BODY_BYTES)) return;

    const message =
      `🚨 <b>DISPUTE OPENED!</b>\n` +
      `Job ID: ${jobId}\n` +
      `An admin needs to review the Proof of Work photos immediately.`;

    await sendTelegramAlert(message);

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('notify-dispute error:', err?.message || err);
    return res.status(500).json({ error: 'Internal error' });
  }
}

