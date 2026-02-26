import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { lat, lng } = req.body;
    console.log("Пытаюсь записать координаты:", lat, lng);

    // 1. ПЕРВЫМ ДЕЛОМ — ЗАПИСЬ В БАЗУ
    const { data: dbEntry, error: dbError } = await supabase
      .from('pyramids')
      .insert([
        {
          location: `POINT(${lng} ${lat})`,
          status: 'collecting',
          glow_intensity: 0.5,
          current_amount: 0,
          target_amount: 100
        }
      ])
      .select();

    if (dbError) {
      console.error("Ошибка записи в Supabase:", dbError.message);
      throw new Error("Database error: " + dbError.message);
    }

    console.log("Запись создана успешно:", dbEntry);

    // 2. ТОЛЬКО ПОТОМ — ЗАПРОС К PAYMOB
    const authRes = await fetch('https://accept.paymob.com/api/auth/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.VITE_PAYMOB_API_KEY })
    });
    const authData = await authRes.json();

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
          phone_number: "01012345678", apartment: "NA", floor: "NA", street: "Sea",
          building: "1", shipping_method: "NA", postal_code: "12345", city: "Hurghada",
          country: "EG", state: "Red Sea"
        },
        currency: "EGP",
        integration_id: Number(process.env.VITE_PAYMOB_INTEGRATION_ID)
      })
    });
    const keyData = await keyRes.json();

    res.status(200).json({ paymentToken: keyData.token });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
