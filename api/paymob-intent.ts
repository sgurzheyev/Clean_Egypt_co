import { createClient } from '@supabase/supabase-js';

// Подключаем Supabase, используя SERVICE_ROLE_KEY для записи данных
const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { lat, lng, amount = 1 } = req.body;
    
    // 1. КОНВЕРТАЦИЯ: Переводим USD из слайдера в EGP (курс ~50)
    // Paymob в твоем аккаунте работает только с EGP
    const exchangeRate = 50;
    const amountInEgp = amount * exchangeRate;
    const amountCents = Math.round(amountInEgp * 100).toString();

    // 2. ЗАПИСЬ В SUPABASE: Создаем "тусклую" пирамиду
    const { data: pyramid, error: dbError } = await supabase
      .from('pyramids')
      .insert([
        {
          location: `POINT(${lng} ${lat})`,
          status: 'pending',
          glow_intensity: 0.2,
          current_amount: 0,
          target_amount: amount,
          mission_type: amount >= 5 ? 'home' : 'egypt'
        }
      ])
      .select()
      .single();

    if (dbError) throw new Error("Database error: " + dbError.message);

    // 3. AUTH PAYMOB: Получаем токен авторизации
    const authRes = await fetch('https://accept.paymob.com/api/auth/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.PAYMOB_API_KEY })
    });
    const authData: any = await authRes.json();
    if (!authData.token) throw new Error("Paymob Auth Failed");

    // 4. CREATE ORDER: Создаем заказ в системе Paymob
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

    // 5. GET PAYMENT KEY: Генерируем ключ для Iframe 1007120
    const keyRes = await fetch('https://accept.paymob.com/api/acceptance/payment_keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authData.token,
        amount_cents: amountCents,
        expiration: 3600,
        order_id: orderData.id,
        billing_data: {
          first_name: "Sergio", //
          last_name: "Gurgini",
          email: "sergio@cleanegypt.co",
          phone_number: "01000000000", // Упрощенный формат для стабильности
          apartment: "NA", floor: "NA", street: "Hurghada",
          building: "NA", shipping_method: "NA", postal_code: "NA", city: "Hurghada",
          country: "EG", state: "Red Sea"
        },
        currency: "EGP",
        integration_id: Number(process.env.PAYMOB_INTEGRATION_ID)
      })
    });
    
    const keyData: any = await keyRes.json();
    
    if (!keyData.token) {
        console.error("Paymob Error Details:", keyData);
        throw new Error("Failed to get payment token");
    }

    // Возвращаем токен на фронтенд
    return res.status(200).json({ paymentToken: keyData.token });

  } catch (error: any) {
    console.error("Server Error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
