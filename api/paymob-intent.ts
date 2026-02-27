import { createClient } from '@supabase/supabase-js';

// Используем переменные в точности как на твоем скриншоте из Vercel
const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { lat, lng, amount = 1 } = req.body;
    
    // Переводим доллары в центы/пиастры для Paymob (целое число)
    const amountCents = Math.round(amount * 100).toString();

    // 1. ЗАПИСЬ В БАЗУ: Создаем временную запись пирамиды
    const { data: pyramid, error: dbError } = await supabase
      .from('pyramids')
      .insert([
        {
          location: `POINT(${lng} ${lat})`,
          status: 'pending_payment',
          glow_intensity: 0.2,
          current_amount: 0,
          target_amount: amount,
          mission_type: amount >= 5 ? 'home' : 'egypt'
        }
      ])
      .select()
      .single();

    if (dbError) throw new Error("Database error: " + dbError.message);

    // 2. АВТОРИЗАЦИЯ В PAYMOB: Получаем временный токен
    const authRes = await fetch('https://accept.paymob.com/api/auth/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.PAYMOB_API_KEY // Ключ из настроек Vercel
      })
    });
    const authData: any = await authRes.json();

    if (!authData.token) throw new Error("Paymob Auth failed");

    // 3. СОЗДАНИЕ ЗАКАЗА В PAYMOB
    const orderRes = await fetch('https://accept.paymob.com/api/ecommerce/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authData.token,
        delivery_needed: "false",
        amount_cents: amountCents,
        currency: "EGP",
        items: []
      })
    });
    const orderData: any = await orderRes.json();

    // 4. ПОЛУЧЕНИЕ PAYMENT KEY ДЛЯ IFRAME
    const keyRes = await fetch('https://accept.paymob.com/api/acceptance/payment_keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authData.token,
        amount_cents: amountCents,
        expiration: 3600,
        order_id: orderData.id,
        billing_data: {
          first_name: "Sergio", // Твой псевдоним Sergio Gurgini
          last_name: "Gurgini",
          email: "sergio@cleanegypt.co",
          phone_number: "201000000000",
          apartment: "NA", floor: "NA", street: "Hurghada",
          building: "NA", shipping_method: "NA", postal_code: "NA", city: "Hurghada",
          country: "EG", state: "Red Sea"
        },
        currency: "EGP",
        integration_id: Number(process.env.PAYMOB_INTEGRATION_ID) // ID из настроек Vercel
      })
    });
    
    const keyData: any = await keyRes.json();
    
    if (!keyData.token) {
        throw new Error("Paymob failed to generate payment token");
    }

    // Возвращаем токен на фронтенд для загрузки iframe
    return res.status(200).json({ paymentToken: keyData.token });

  } catch (error: any) {
    console.error("Server Error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
