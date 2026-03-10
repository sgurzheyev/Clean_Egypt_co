import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { sendTelegramAlert } from '../lib/telegram';
import crypto from 'crypto';

// Server-side Supabase client (service role). Never use VITE_* for this.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing server env vars: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const { obj } = req.body;
    // Paymob может прислать HMAC в query string
    const hmacReceived = req.query.hmac as string;

    // 1. ПРОВЕРКА ПОДПИСИ (Строгий порядок Paymob)
    // HMAC secret must be server-only (no VITE_*).
    const secret = process.env.PAYMOB_HMAC;
    
    // Собираем строку строго по документации Paymob
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
      obj.success
    ].join('');

    const hashed = crypto
      .createHmac('sha512', secret!)
      .update(dataToHash)
      .digest('hex');

    if (hashed !== hmacReceived) {
      console.error('ОШИБКА: HMAC mismatch!');
      // Для отладки в логах Vercel:
      // console.log("Hashed:", hashed);
      // console.log("Received:", hmacReceived);
      return res.status(401).send('Unauthorized');
    }

    // 2. ОБРАБОТКА УСПЕШНОЙ ОПЛАТЫ
    if (obj.success === true) {
      const paymobOrderId = obj.order.id.toString();
      const amountPaid = obj.amount_cents / 100;

      // 2a. Оплата депозита рабочего: привязываем worker_id к пирамиде
      const { data: pendingRow } = await supabase
        .from('payment_pending')
        .select('pyramid_id, user_id')
        .eq('paymob_order_id', paymobOrderId)
        .maybeSingle();

      if (pendingRow) {
        const { error: updateErr } = await supabase
          .from('pyramids')
          .update({
            worker_id: pendingRow.user_id,
            status: 'active',
          })
          .eq('id', pendingRow.pyramid_id);

        if (updateErr) throw new Error("Supabase Error (worker_deposit): " + updateErr.message);

        await supabase.from('payment_pending').delete().eq('paymob_order_id', paymobOrderId);
        console.log(`Депозит оплачен: пирамида ${pendingRow.pyramid_id} закреплена за worker ${pendingRow.user_id}`);
        return res.status(200).send('OK');
      }

      // 2b. Job creation: insert job from job_payment_pending
      const { data: jobPending } = await supabase
        .from('job_payment_pending')
        .select('creator_id, task_type, amount, location_lat, location_lng, description, creator_photos')
        .eq('paymob_order_id', paymobOrderId)
        .maybeSingle();

      if (jobPending) {
        const { data: insertedJobs, error: jobErr } = await supabase.from('jobs').insert({
          creator_id: jobPending.creator_id,
          task_type: jobPending.task_type,
          amount: jobPending.amount,
          location_lat: jobPending.location_lat,
          location_lng: jobPending.location_lng,
          description: jobPending.description,
          creator_photos: jobPending.creator_photos || null,
          status: 'pending',
        }).select('id').limit(1);
        if (jobErr) throw new Error("Supabase Error (job_creation): " + jobErr.message);
        await supabase.from('job_payment_pending').delete().eq('paymob_order_id', paymobOrderId);
        console.log(`Job created for Paymob order ${paymobOrderId}`);

        // Notify Telegram admin about new funded mission (best-effort, non-blocking)
        const msg =
          `🟢 <b>NEW MISSION FUNDED!</b>\n` +
          `Amount: ${jobPending.amount}\n` +
          `Type: ${jobPending.task_type}\n` +
          `Location: ${jobPending.location_lat}, ${jobPending.location_lng}`;
        // Fire and forget; internal try/catch in helper
        await sendTelegramAlert(msg);

        return res.status(200).send('OK');
      }

      // 2c. Pyramid creation: activate pyramid by paymob_order_id
      const { error } = await supabase
        .from('pyramids')
        .update({
          status: 'active',
          current_amount: amountPaid,
          glow_intensity: 1.0
        })
        .eq('paymob_order_id', paymobOrderId);

      if (error) throw new Error("Supabase Error: " + error.message);
      console.log(`Пирамида для заказа ${paymobOrderId} успешно активирована!`);
    }

    return res.status(200).send('OK');

  } catch (error: any) {
    console.error('Webhook Error:', error.message);
    return res.status(500).send('Server Error');
  }
}
