import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Server-side Supabase client (service role). Never use VITE_* for this.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing server env vars: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
}

// Uses SERVICE_ROLE_KEY to bypass RLS for secure server writes.
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { lat, lng, amount = 1, type = 'egypt' } = req.body;

    // 1. КОНВЕРТАЦИЯ: Paymob работает с EGP и принимает сумму в центах (строкой)
    const exchangeRate = 50;
    const amountInEgp = amount * exchangeRate;
    const amountCents = Math.round(amountInEgp * 100).toString();

    // 2. ЗАПИСЬ В SUPABASE: Создаем предварительную запись пирамиды
    const { data: pyramid, error: dbError } = await supabase
      .from('pyramids')
      .insert([
        {
          location: `POINT(${lng} ${lat})`,
          status: 'pending',
          glow_intensity: 0.2,
          current_amount: 0,
          target_amount: amount,
          mission_type: type
        }
      ])
      .select()
      .single();

    if (dbError) {
      console.error("Supabase Insert Error:", dbError.message);
      throw new Error("Database insert failed: " + dbError.message);
    }

    // 3. AUTH PAYMOB: Получаем токен авторизации
    const authRes = await fetch('https://accept.paymob.com/api/auth/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.PAYMOB_API_KEY })
    });
    const authData = await authRes.json();
    if (!authData.token) throw new Error("Paymob Auth Failed");

    // 4. CREATE ORDER: Регистрируем заказ в системе Paymob
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
    const orderData = await orderRes.json();
    const paymobOrderId = orderData.id;

    if (!paymobOrderId) throw new Error("Paymob Order Creation Failed");

    // 5. СВЯЗКА: Сохраняем полученный paymob_order_id в нашу таблицу pyramids
    // Это критически важно для работы вебхука!
    const { error: updateError } = await supabase
      .from('pyramids')
      .update({ paymob_order_id: paymobOrderId.toString() })
      .eq('id', pyramid.id);

    if (updateError) {
      console.error("Supabase Update Error:", updateError.message);
    }

    // 6. GET PAYMENT KEY: Генерируем ключ для Iframe
    const keyRes = await fetch('https://accept.paymob.com/api/acceptance/payment_keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authData.token,
        amount_cents: amountCents,
        expiration: 3600,
        order_id: paymobOrderId,
        billing_data: {
          first_name: "Sergio",
          last_name: "Gurgini",
          email: "sergio@cleanegypt.co",
          phone_number: "01000000000",
          apartment: "NA", floor: "NA", street: "Hurghada",
          building: "NA", shipping_method: "NA", postal_code: "NA", city: "Hurghada",
          country: "EG", state: "Red Sea"
        },
        currency: "EGP",
        integration_id: Number(process.env.PAYMOB_INTEGRATION_ID)
      })
    });
    
    const keyData = await keyRes.json();
    
    if (!keyData.token) {
        console.error("Paymob Acceptance Error:", keyData);
        throw new Error("Failed to get payment token");
    }

    // Возвращаем токен на фронтенд для загрузки Iframe
    return res.status(200).json({ paymentToken: keyData.token });

  } catch (error: any) {
    console.error("Server Error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
