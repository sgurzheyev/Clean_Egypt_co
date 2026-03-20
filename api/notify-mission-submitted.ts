import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendTelegramAlert } from '../lib/telegram';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      missionId,
      category,
      plastic,
      glass,
      debris,
    } = req.body as {
      missionId?: string;
      category?: string;
      plastic?: number | string;
      glass?: number | string;
      debris?: number | string;
    };

    if (!missionId) {
      return res.status(400).json({ error: 'missionId is required' });
    }

    const plasticVal = Number.parseFloat(String(plastic ?? 0)) || 0;
    const glassVal = Number.parseFloat(String(glass ?? 0)) || 0;
    const debrisVal = Number.parseFloat(String(debris ?? 0)) || 0;

    const message =
      `✅ <b>MISSION SUBMITTED FOR REVIEW</b>\n` +
      `Mission ID: ${missionId}\n` +
      `Type: ${category || 'unknown'}\n` +
      `\n♻️ <b>Eco-Report:</b>\n` +
      `🥤 Plastic: ${plasticVal}\n` +
      `🪟 Glass: ${glassVal}\n` +
      `🧱 Debris: ${debrisVal}`;

    await sendTelegramAlert(message);
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('notify-mission-submitted error:', err?.message || err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
