export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  try {
    const authRes = await fetch('https://accept.paymob.com/api/auth/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.PAYMOB_API_KEY })
    });
    const authData = await authRes.json();
    if (!authData.token) return res.status(401).json({ error: "Auth failed", details: authData });

    const orderRes = await fetch('https://accept.paymob.com/api/ecommerce/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authData.token,
        delivery_needed: false,
        amount_cents: 10000,
        currency: "EGP",
        items: []
      })
    });
    const orderData = await orderRes.json();
    if (!orderData.id) return res.status(500).json({ error: "Order creation failed", details: orderData });

    const keyRes = await fetch('https://accept.paymob.com/api/acceptance/payment_keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authData.token,
        amount_cents: 10000,
        expiration: 3600,
        order_id: orderData.id,
        billing_data: {
          apartment: "NA", email: "sergio@cleanegypt.co", floor: "NA",
          first_name: "Sergio", street: "Hurghada", building: "NA",
          phone_number: "+201000000000", shipping_method: "NA",
          postal_code: "NA", city: "Hurghada", country: "EG", last_name: "Gurgini"
        },
        currency: "EGP",
        integration_id: process.env.PAYMOB_INTEGRATION_ID
      })
    });
    const keyData = await keyRes.json();
    if (!keyData.token) return res.status(500).json({ error: "Payment Key failed", details: keyData });

    return res.status(200).json({ token: keyData.token, iframe_id: process.env.PAYMOB_IFRAME_ID });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
