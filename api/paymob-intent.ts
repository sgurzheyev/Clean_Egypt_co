import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { lat, lng } = req.body;

    // 1. ЗАПИСЬ В БАЗУ (Это должно сработать ПЕРВЫМ)
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

    if (dbError) throw new Error("Database error: " + dbError.message);

    // 2. AUTH PAYMOB
    const authRes = await fetch('https://accept.paymob.com/api/auth/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.VITE_PAYMOB_API_KEY })
    });
    const authData = await authRes.json();

    // 3. CREATE ORDER
    const orderRes = await fetch('https://accept.paymob.com/api/ecommerce/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authData.token,
        amount_cents: "10000",
        currency: "EGP",
        items: []
      })
    });
    const orderData = await orderRes.json();

    // 4. GET PAYMENT KEY (Исправленная переменная)
    const keyRes = await fetch('https://accept.paymob.com/api/acceptance/payment_keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authData.token,
        amount_cents: "10000",
        expiration: 3600,
        order_id: orderData.id,
        billing_data: {
          first_name: "Sergio", last_name: "Gurgini", email: "sergio@cleanegypt.co",
          phone_number: "201000000000", apartment: "NA", floor: "NA", street: "Hurghada",
          building: "NA", shipping_method: "NA", postal_code: "NA", city: "Hurghada",
          country: "EG", state: "Red Sea"
        },
        currency: "EGP",
        integration_id: Number(process.env.VITE_PAYMOB_INTEGRATION_ID)
      })
    });
    const keyData = await keyRes.json();
    const token = keyData.token; // Вот создание токена

    // Возвращаем результат фронтенду
    return res.status(200).json({ paymentToken: token });

  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
