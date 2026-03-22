import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Server-side Supabase client (service role)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing server env vars: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

interface PaymobWebhookObj {
  amount_cents: number;
  created_at: string;
  currency: string;
  error_occured: boolean;
  has_parent_transaction: boolean;
  id: number;
  integration_id: number;
  is_3d_secure: boolean;
  is_auth: boolean;
  is_capture: boolean;
  is_refunded: boolean;
  is_standalone_payment: boolean;
  pending: boolean;
  source_data: {
    pan: string;
    sub_type: string;
    type: string;
  };
  success: boolean;
  order: {
    merchant_order_id?: string;
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const obj = req.body?.obj as PaymobWebhookObj | undefined;
    const hmacReceived = (req.query.hmac as string) || '';

    if (!obj) {
      console.error('Paymob webhook: missing obj in body');
      return res.status(200).send('Missing payload');
    }

    // 1. Verify HMAC signature
    const secret = process.env.PAYMOB_HMAC;
    if (!secret) {
      console.error('PAYMOB_HMAC is not configured');
      return res.status(200).send('Webhook misconfigured');
    }

    const dataToHash = [
      obj.amount_cents,
      obj.created_at,
      obj.currency,
      obj.error_occured,
      obj.has_parent_transaction,
      obj.id,
      obj.integration_id,
      obj.is_3d_secure,
      obj.is_auth,
      obj.is_capture,
      obj.is_refunded,
      obj.is_standalone_payment,
      obj.pending,
      obj.source_data.pan,
      obj.source_data.sub_type,
      obj.source_data.type,
      obj.success,
    ].join('');

    const hashed = crypto.createHmac('sha512', secret).update(dataToHash).digest('hex');

    if (!hmacReceived || hashed !== hmacReceived) {
      console.error('Paymob webhook: invalid HMAC signature');
      return res.status(401).send('Unauthorized');
    }

    // 2. Process successful payments only
    if (!obj.success) {
      return res.status(200).send('Ignored (not successful)');
    }

    const merchantOrderId = obj.order?.merchant_order_id;
    if (!merchantOrderId) {
      console.error('Paymob webhook: missing merchant_order_id');
      return res.status(200).send('Missing merchant_order_id');
    }

    // merchant_order_id format: "<type>:<idPart>_<timestamp>"
    const [type, rest] = merchantOrderId.split(':');
    const idPart = rest ? rest.split('_')[0] : undefined;

    if (!type || !idPart) {
      console.error('Paymob webhook: cannot parse merchant_order_id', merchantOrderId);
      return res.status(200).send('Bad merchant_order_id');
    }

    // Integer EGP credited to wallet / transactions (satisfies check_integer_egp).
    const amountPaid = Math.floor(Number(obj.amount_cents) / 100);

    // --- Scenario A: Mission creation payment ---
    if (type === 'mission_creation') {
      const missionId = idPart;

      // 1) Update mission status from "pending_payment" to "available" (live / active on map — missions do not use a separate "active" enum)
      const { data: mission, error: missionErr } = await supabase
        .from('missions')
        .update({ status: 'available' })
        .eq('id', missionId)
        .eq('status', 'pending_payment')
        .select('id, creator_id')
        .maybeSingle();

      if (missionErr) {
        console.error('Paymob webhook: failed to update mission status', missionErr.message);
        // Return 200 so Paymob stops retrying; we will inspect logs and fix manually if needed.
        return res.status(200).send('Mission update failed');
      }

      if (!mission || !mission.creator_id) {
        console.error('Paymob webhook: mission not found or missing creator_id', missionId);
        return res.status(200).send('Mission not found');
      }

      // 2) Record transaction for the mission creation deposit
      const { error: txErr } = await supabase.from('transactions').insert({
        user_id: mission.creator_id,
        mission_id: missionId,
        amount: amountPaid,
        type: 'deposit',
        gateway: 'paymob',
        payout_details: `paymob_amount_cents=${obj.amount_cents}`,
      });

      if (txErr) {
        console.error('Paymob webhook: failed to insert mission transaction', txErr.message);
        // Still return 200; logging is enough for backoffice reconciliation.
      }

      // 3) Telegram notification (non-blocking) — only after payment success
      try {
        const botToken = process.env.TELEGRAM_BOT_TOKEN || process.env.VITE_TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.VITE_TELEGRAM_ADMIN_CHAT_ID;
        if (botToken && chatId) {
          const caption = `✅ *PAID MISSION LIVE* ✅\nMission: \`${missionId}\`\nAmount: ${amountPaid} EGP`;
          fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: caption,
              parse_mode: 'Markdown',
            }),
          }).catch((err) => console.error('Telegram sendMessage failed:', err));
        }
      } catch (err) {
        console.error('Telegram notify failed:', err);
      }

      return res.status(200).send('OK');
    }

    // --- Scenario B: Wallet top-up (worker_deposit) ---
    // Any wallet top-ups simply increment profiles.wallet_balance and are logged in transactions.
    if (type === 'worker_deposit') {
      const userId = idPart;

      // Increment wallet_balance safely
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('wallet_balance')
        .eq('id', userId)
        .maybeSingle();

      if (profileErr) {
        console.error('Paymob webhook: failed to load profile for top-up', profileErr.message);
        return res.status(200).send('Profile load failed');
      }

      const currentBalance = Math.floor(Number(profile?.wallet_balance ?? 0));

      const { error: updateErr } = await supabase
        .from('profiles')
        .update({ wallet_balance: currentBalance + amountPaid })
        .eq('id', userId);

      if (updateErr) {
        console.error('Paymob webhook: failed to update wallet_balance', updateErr.message);
        return res.status(200).send('Wallet update failed');
      }

      const { error: txErr } = await supabase.from('transactions').insert({
        user_id: userId,
        mission_id: null,
        amount: amountPaid,
        type: 'wallet_topup',
        gateway: 'paymob',
        payout_details: `paymob_amount_cents=${obj.amount_cents}`,
      });

      if (txErr) {
        console.error('Paymob webhook: failed to insert wallet transaction', txErr.message);
      }

      return res.status(200).send('OK');
    }

    // For any other types, just acknowledge
    return res.status(200).send('Type ignored');
  } catch (error: any) {
    console.error('Paymob webhook: unhandled error', error?.message || error);
    // Always return 200 so Paymob does not keep retrying indefinitely.
    return res.status(200).send('Handled with errors');
  }
}
