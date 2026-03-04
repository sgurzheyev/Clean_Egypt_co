import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const { obj } = req.body;
    // Paymob может прислать HMAC в query string
    const hmacReceived = req.query.hmac as string;

    // 1. ПРОВЕРКА ПОДПИСИ (Строгий порядок Paymob)
    const secret = process.env.VITE_PAYMOB_HMAC || process.env.PAYMOB_HMAC;
    
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

    // 2. АКТИВАЦИЯ ПИРАМИДЫ
    if (obj.success === true) {
      const paymobOrderId = obj.order.id;
      const amountPaid = obj.amount_cents / 100;

      const { error } = await supabase
        .from('pyramids')
        .update({
          status: 'active',
          current_amount: amountPaid,
          glow_intensity: 1.0
        })
        .eq('paymob_order_id', paymobOrderId.toString()); // Используем наш ID заказа

      if (error) throw new Error("Supabase Error: " + error.message);
      
      console.log(`Пирамида для заказа ${paymobOrderId} успешно активирована!`);
    }

    return res.status(200).send('OK');

  } catch (error: any) {
    console.error('Webhook Error:', error.message);
    return res.status(500).send('Server Error');
  }
}
