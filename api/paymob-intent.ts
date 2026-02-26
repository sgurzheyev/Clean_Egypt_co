import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { lat, lng } = req.body;

    // 1. ЗАПИСЬ В ТАБЛИЦУ (чтобы таблица не была пустой)
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

    if (dbError) throw new Error("Supabase Error: " + dbError.message);

    // 2. AUTH PAYMOB
    const authRes = await fetch('https://accept.paymob.com/api/auth/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.VITE_PAYMOB_API_KEY })
    });
    const authData = await authRes.json();
    const authToken = authData.token;

    // 3. CREATE ORDER
    const orderRes = await fetch('https://accept.paymob.com/api/ecommerce/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authToken,
        amount_cents: "100", // 1 EGP для теста
        currency: "EGP",
        items: []
      })
    });
    const orderData = await orderRes.json();
    const orderId = orderData.id;

    // 4. GET PAYMENT KEY (Исправляем ошибку переменной)
    const keyRes = await fetch('https://accept.paymob.com/api/acceptance/payment_keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authToken,
        amount_cents: "100",
        expiration: 3600,
        order_id: orderId,
        billing_data: {
          first_name: "Eco", last_name: "Hero", email: "hero@cleanegypt.co",
          phone_number: "01012345678", apartment: "8", floor: "1", street: "Sea St",
          building: "1", shipping_method: "PKG", postal_code: "12345", city: "Hurghada",
          country: "EG", state: "Red Sea"
        },
        currency: "EGP",
        integration_id: Number(process.env.VITE_PAYMOB_INTEGRATION_ID)
      })
    });
    const keyData = await keyRes.json();
    const paymentToken = keyData.token; // ТУТ МЫ СОЗДАЕМ ТУ САМУЮ ПЕРЕМЕННУЮ

    // ОТПРАВЛЯЕМ ОТВЕТ
    res.status(200).json({ paymentToken: paymentToken });

  } catch (error: any) {
    console.error("API Error:", error.message);
    res.status(500).json({ error: error.message });
  }
}
