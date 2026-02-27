import { createClient } from '@supabase/supabase-js';

// Supabase: Судя по скриншоту Vercel, тут префикс VITE_ есть
const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { lat, lng, amount = 1 } = req.body;
    const amountCents = Math.round(amount * 100).toString();

    // 1. ЗАПИСЬ В БАЗУ (Supabase)
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

    // 2. AUTH PAYMOB (УБРАЛИ VITE_, ТАК КАК В ПАНЕЛИ VERCEL ЕГО НЕТ)
    const authRes = await fetch('https://accept.paymob.com/api/auth/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.PAYMOB_API_KEY // В панели Vercel именно так
      })
    });
    const authData: any = await authRes.json();

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
    const orderData: any = await orderRes.json();

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
          first_name: "Sergio", // Твой псевдоним Sergio Gurgini
          last_name: "Gurgini",
          email: "sergio@cleanegypt.co",
          phone_number: "201000000000",
          apartment: "NA", floor: "NA", street: "Hurghada",
          building: "NA", shipping_method: "NA", postal_code: "NA", city: "Hurghada",
          country: "EG", state: "Red Sea"
        },
        currency: "EGP",
        integration_id: Number(process.env.PAYMOB_INTEGRATION_ID) // В панели Vercel без VITE_
      })
    });
    
    const keyData: any = await keyRes.json();
    
    if (!keyData.token) throw new Error("Failed to get Paymob token");

    return res.status(200).json({ paymentToken: keyData.token });

  } catch (error: any) {
    console.error("Server Error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
