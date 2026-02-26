import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { lat, lng } = req.body;
    console.log("Запись координат в базу:", lat, lng);

    // 1. СНАЧАЛА ЗАПИСЫВАЕМ В БАЗУ (ЭТО ГЛАВНОЕ!)
    const { error: dbError } = await supabase
      .from('pyramids')
      .insert([
        {
          location: `POINT(${lng} ${lat})`,
          status: 'collecting',
          glow_intensity: 0.5,
          current_amount: 0,
          target_amount: 100
        }
      ]);

    if (dbError) {
      console.error("Ошибка Supabase:", dbError.message);
      throw new Error("Supabase Error: " + dbError.message);
    }

    // 2. ПОЛУЧАЕМ AUTH TOKEN ОТ PAYMOB
    const authRes = await fetch('https://accept.paymob.com/api/auth/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.VITE_PAYMOB_API_KEY })
    });
    const authData = await authRes.json();

    // 3. СОЗДАЕМ ЗАКАЗ
    const orderRes = await fetch('https://accept.paymob.com/api/ecommerce/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authData.token,
        amount_cents: "100",
        currency: "EGP",
        items: []
      })
    });
    const orderData = await orderRes.json();

    // 4. ПОЛУЧАЕМ КЛЮЧ ОПЛАТЫ
    const keyRes = await fetch('https://accept.paymob.com/api/acceptance/payment_keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authData.token,
        amount_cents: "100",
        expiration: 3600,
        order_id: orderData.id,
        billing_data: {
          first_name: "Eco", last_name: "Hero", email: "hero@cleanegypt.co",
          phone_number: "01012345678", apartment: "NA", floor: "NA", street: "NA",
          building: "NA", shipping_method: "NA", postal_code: "NA", city: "Hurghada",
          country: "EG", state: "Red Sea"
        },
        currency: "EGP",
        integration_id: Number(process.env.VITE_PAYMOB_INTEGRATION_ID)
      })
    });
    const keyData = await keyRes.json();

    // ВОЗВРАЩАЕМ ТОКЕН (Ошибка "Cannot find name paymentToken" исправлена)
    res.status(200).json({ paymentToken: keyData.token });

  } catch (error: any) {
    console.error("Критическая ошибка API:", error.message);
    res.status(500).json({ error: error.message });
  }
}
