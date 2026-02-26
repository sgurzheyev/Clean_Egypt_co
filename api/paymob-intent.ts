import { createClient } from '@supabase/supabase-js';

// Твои ключи из .env (VITE_ префиксы)
const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { lat, lng } = req.body;

    // 1. СРАЗУ записываем черновик пирамиды в таблицу pyramids
    const { error: dbError } = await supabase
      .from('pyramids')
      .insert([
        {
          location: `POINT(${lng} ${lat})`, // ВАЖНО: сначала lng, потом lat
          status: 'collecting',
          glow_intensity: 0.5
        }
      ]);

    if (dbError) throw new Error("Database Error: " + dbError.message);

    // 2. Дальше твой существующий код запроса к Paymob...
    // (Auth, Order, Payment Key)
    
    // В конце возвращаем токен фронтенду
    res.status(200).json({ paymentToken: paymentToken });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
