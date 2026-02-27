import { createClient } from '@supabase/supabase-js';

// Используем SERVICE_ROLE_KEY для обхода политик RLS при создании заказа
const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Получаем координаты и сумму (amount) с фронтенда
    const { lat, lng, amount = 1 } = req.body;
    const amountCents = (amount * 100).toString(); // $1 -> 100, $5 -> 500

    // 1. ЗАПИСЬ В БАЗУ (Создаем "тусклую" пирамиду)
    const { data: pyramid, error: dbError } = await supabase
      .from('pyramids')
      .insert([
        {
          location: `POINT(${lng} ${lat})`,
          status: 'pending_payment', // Статус "ожидание"
          glow_intensity: 0.2,
          current_amount: 0,
          target_amount: amount,
          mission_type: amount >= 5 ? 'home' : 'egypt'
        }
      ])
      .select()
      .single();

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
        delivery_needed: "false",
        amount_cents: amountCents,
        currency: "EGP",
        items: []
      })
    });
    const orderData = await orderRes.json();

    // 4. GET PAYMENT KEY
    const keyRes = await fetch('https://accept.paymob.com/api/acceptance/payment_keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authData.token,
        amount_cents: amountCents,
        expiration: 3600,
        order_id: orderData.id,
        billing_data: {
          first_name: "Sergio",
          last_name: "Gurgini",
          email: "sergio@cleanegypt.co",
          phone_number: "201000000000", // Убедись, что это число без "+"
          apartment: "NA", floor: "NA", street: "Hurghada",
          building: "NA", shipping_method: "NA", postal_code: "NA", city: "Hurghada",
          country: "EG", state: "Red Sea"
        },
        currency: "EGP",
        integration_id: Number(process.env.VITE_PAYMOB_INTEGRATION_ID)
      })
    });
    
    const keyData = await keyRes.json();
    
    if (!keyData.token) {
        console.error("Paymob Key Error:", keyData);
        throw new Error("Failed to generate payment token");
    }

    return res.status(200).json({ paymentToken: keyData.token });

  } catch (error: any) {
    console.error("Server Error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
