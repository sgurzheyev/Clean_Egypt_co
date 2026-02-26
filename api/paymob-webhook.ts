import { createClient } from '@supabase/supabase-js';

// Используем твои новые ключи из .env
const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: any, res: any) {
  const { obj } = req.body;

  if (obj && obj.success === true) {
    const orderId = obj.order.id;

    // ОБНОВЛЯЕМ ПИРАМИДУ
    // Мы находим запись, которую юзер "забронировал" через MapPicker
    const { data, error } = await supabase
      .from('pyramids')
      .update({
        status: 'completed',
        glow_intensity: 1.0,
        last_updated: new Date().toISOString()
      })
      .eq('status', 'collecting')
      .select();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).send('OK');
  }

  res.status(400).send('Transaction failed');
}
