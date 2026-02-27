import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: any, res: any) {
  // PayMob отправляет POST-запрос с деталями транзакции
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const { obj } = req.body;
    const hmacReceived = req.query.hmac; // PayMob передает HMAC в URL

    // 1. ПРОВЕРКА ПОДПИСИ (ЗАЩИТА ОТ ВЗЛОМА)
    // Строгий порядок полей, требуемый PayMob для валидации
    const lexigraphicalString = [
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

    const secret = process.env.VITE_PAYMOB_HMAC!;
    const hashed = crypto.createHmac('sha512', secret).update(lexigraphicalString).digest('hex');

    // Если подписи не совпадают — отклоняем запрос
    if (hashed !== hmacReceived) {
      console.error('ОШИБКА: Неверный HMAC!');
      return res.status(401).send('Unauthorized');
    }

    // 2. АКТИВАЦИЯ ПИРАМИДЫ ПРИ УСПЕШНОЙ ОПЛАТЕ
    if (obj.success === true) {
      const orderId = obj.order.id;
      const amountPaid = obj.amount_cents / 100; // Переводим центы обратно в доллары/фунты

      // Обновляем пирамиду в Supabase (меняем статус и зажигаем неон)
      const { error } = await supabase
        .from('pyramids')
        .update({
          status: 'active',
          current_amount: amountPaid,
          glow_intensity: 1.0 // Включаем максимальное свечение
        })
        .eq('paymob_order_id', orderId); // Ищем пирамиду по ID заказа

      if (error) throw new Error("Supabase Update Error: " + error.message);
      
      // Здесь же можно начислить XP пользователю!
      // Например: добавить (amountPaid * 10) XP в таблицу profiles
    }

    // Обязательно отвечаем 200 OK, иначе PayMob будет спамить повторными запросами
    return res.status(200).send('Webhook Processed');

  } catch (error: any) {
    console.error('Webhook Error:', error.message);
    return res.status(500).send('Server Error');
  }
}
