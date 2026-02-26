import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: any, res: any) {
  const { obj } = req.body;

  // Если оплата успешна
  if (obj && obj.success === true) {
    // Находим последнюю созданную пирамиду в статусе 'collecting' и обновляем её
    const { error } = await supabase
      .from('pyramids')
      .update({
        status: 'completed',
        glow_intensity: 1.0
      })
      .eq('status', 'collecting')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).send('OK');
  }

  res.status(400).send('Payment Failed');
}
