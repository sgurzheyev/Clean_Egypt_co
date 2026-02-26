import { createClient } from '@supabase/supabase-js';

// Используем твои VITE_ ключи из .env
const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { lat, lng } = req.body;

    // 1. Авторизация в Paymob
    const authRes = await fetch('https://accept.paymob.com/api/auth/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.VITE_PAYMOB_API_KEY })
    });
    const { token: authToken } = await authRes.json();

    // 2. Регистрация заказа (0.99 EGP)
    const orderRes = await fetch('https://accept.paymob.com/api/ecommerce/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authToken,
        amount_cents: "99",
        currency: "EGP",
        items: []
      })
    });
    const { id: orderId } = await orderRes.json();

    // 3. Получение Payment Key
    const keyRes = await fetch('https://accept.paymob.com/api/acceptance/payment_keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authToken,
        amount_cents: "99",
        expiration: 3600,
        order_id: orderId,
        billing_data: {
          first_name: "Eco", last_name: "Hero", email: "hero@cleanegypt.co",
          phone_number: "000000", apartment: "NA", floor: "NA", street: "NA",
          building: "NA", shipping_method: "NA", postal_code: "NA", city: "Hurghada",
          country: "EG", state: "Red Sea"
        },
        currency: "EGP",
        integration_id: 5516060
      })
    });
    const { token: paymentToken } = await keyRes.json();

    // 4. СОЗДАЕМ ЧЕРНОВИК ПИРАМИДЫ
    // Мы сохраняем координаты сразу, чтобы Webhook потом просто "зажег" эту запись
    await supabase.from('pyramids').insert([
      {
        location: `POINT(${lng} ${lat})`,
        status: 'collecting',
        glow_intensity: 0.5
      }
    ]);

    res.status(200).json({ paymentToken });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
