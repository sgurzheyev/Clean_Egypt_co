// api/paymob.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  // Используем переменные из Vercel Environment Variables
  const API_KEY = process.env.PAYMOB_API_KEY;
  const INTEGRATION_ID = process.env.PAYMOB_INTEGRATION_ID;

  try {
    console.log("--- Starting PayMob Auth ---");
    // ИСПРАВЛЕНО: Используем accept.paymob.com вместо egypt.paymob.com
    const authRes = await fetch('https://accept.paymob.com/api/auth/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: API_KEY })
    });
    
    const authData = await authRes.json();
    
    if (!authRes.ok) {
      console.error("PayMob Auth Error:", authData);
      return res.status(401).json({ error: "Auth failed", details: authData });
    }

    console.log("--- Creating Order ---");
    const orderRes = await fetch('https://accept.paymob.com/api/ecommerce/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authData.token,
        delivery_needed: "false",
        amount_cents: "10000", // 100 EGP
        currency: "EGP",
        items: []
      })
    });
    const orderData = await orderRes.json();

    console.log("--- Getting Payment Key ---");
    const keyRes = await fetch('https://accept.paymob.com/api/acceptance/payment_keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authData.token,
        amount_cents: "10000",
        expiration: 3600,
        order_id: orderData.id,
        billing_data: {
          apartment: "NA", email: "sergio@cleanegypt.co", floor: "NA",
          first_name: "Sergio", street: "Hurghada", building: "NA",
          phone_number: "+201000000000", shipping_method: "NA",
          postal_code: "NA", city: "Hurghada", country: "EG", last_name: "Gurgini"
        },
        currency: "EGP",
        integration_id: INTEGRATION_ID
      })
    });
    const keyData = await keyRes.json();

    if (!keyRes.ok) {
      console.error("Payment Key Error:", keyData);
      return res.status(400).json({ error: "Key generation failed", details: keyData });
    }

    // Возвращаем токен и Iframe ID для фронтенда
    return res.status(200).json({
      token: keyData.token,
      iframe_id: process.env.PAYMOB_IFRAME_ID
    });

  } catch (e) {
    console.error("Critical Server Error:", e.message);
    return res.status(500).json({ error: e.message });
  }
}
