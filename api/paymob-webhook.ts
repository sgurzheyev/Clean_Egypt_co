import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { sendTelegramAlert } from '../lib/telegram';
import crypto from 'crypto';

// Server-side Supabase client (service role)
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
    const hmacReceived = req.query.hmac as string;

    // 1. ПРОВЕРКА ПОДПИСИ HMAC (Защита от фейковых оплат)
    const secret = process.env.PAYMOB_HMAC;
    
    // Формируем строку строго по документации PayMob (алфавитный порядок ключей)
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
      console.error('ОШИБКА: Неверная подпись HMAC!');
      return res.status(401).send('Unauthorized');
    }

    // 2. ОБРАБОТКА УСПЕШНОЙ ОПЛАТЫ
    if (obj.success === true) {
      const merchantOrderId = obj.order.merchant_order_id; // e.g. "mission_creation:uuid_1234"
      const amountPaidEgp = obj.amount_cents / 100;

      // Извлекаем тип операции и ID миссии из merchant_order_id, который мы сформировали в paymob-intent
      const [type, metadata] = merchantOrderId.split(':');
      const missionId = metadata ? metadata.split('_')[0] : null;

      if (!missionId) {
        throw new Error(`Невозможно извлечь missionId из merchant_order_id: ${merchantOrderId}`);
      }

      // --- СЦЕНАРИЙ А: Создание новой миссии (клиент или меценат оплатил) ---
      if (type === 'mission_creation') {
        // Миссия уже была создана в интенте в статусе 'collecting' или 'pending'
        // Теперь мы просто подтверждаем, что деньги пришли, и переводим ее в статус поиска уборщика
        
        const { data: mission, error: updateErr } = await supabase
          .from('missions')
          .update({ 
            status: 'pending', // Теперь она доступна для ставок
            collected_amount: amountPaidEgp // Записываем, сколько реально собрано
          })
          .eq('id', missionId)
          .select('task_type, amount_egp, location_lat, location_lng')
          .single();

        if (updateErr) throw new Error("Supabase Error (update mission status): " + updateErr.message);

        console.log(`Миссия ${missionId} успешно оплачена на сумму ${amountPaidEgp} EGP.`);

        // Отправляем уведомление в Telegram (fire and forget)
        if (mission) {
          const msg = `🟢 <b>NEW MISSION FUNDED!</b>\nAmount: ${amountPaidEgp} EGP\nType: ${mission.task_type}\nLocation: ${mission.location_lat}, ${mission.location_lng}`;
          sendTelegramAlert(msg).catch(err => console.error("Telegram alert failed:", err));
        }

        return res.status(200).send('OK');
      }

      // --- СЦЕНАРИЙ Б: Уборщик пополняет свой баланс (для депозитов) ---
      if (type === 'worker_deposit') {
        // Ищем кому принадлежит эта попытка пополнения
        // В интенте мы передали userId вместо missionId в метаданные для этого типа? 
        // Важно: если в paymob-intent мы передавали missionId, то пополнение баланса нужно делать хитрее.
        // Предположим, missionId здесь - это user_id уборщика.

        const userId = missionId; 

        // Вызываем RPC для безопасного зачисления на баланс
        // Тебе понадобится создать эту RPC функцию, если ее еще нет, или просто сделать UPDATE (менее секьюрно, но работает)
        const { error: balanceErr } = await supabase.rpc('increment_balance', {
          p_user_id: userId,
          p_amount: amountPaidEgp
        });

        // Альтернативный простой вариант (если нет RPC):
        // const { error: balanceErr } = await supabase
        //  .from('profiles')
        //  .update({ balance_egp: supabase.sql`balance_egp + ${amountPaidEgp}` })
        //  .eq('id', userId);

        if (balanceErr) throw new Error("Supabase Error (add to balance): " + balanceErr.message);

        console.log(`Баланс уборщика ${userId} пополнен на ${amountPaidEgp} EGP.`);
        return res.status(200).send('OK');
      }
    }

    // Если оплата не success, просто возвращаем 200, чтобы PayMob отстал
    return res.status(200).send('OK');

  } catch (error: any) {
    console.error('Webhook Error:', error.message);
    // Всегда возвращаем 200 для PayMob, даже при внутренних ошибках логики, иначе он будет долбить сервер ретраями
    return res.status(200).send('Handled with errors');
  }
}