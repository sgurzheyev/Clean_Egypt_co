export default async function handler(req, res) {
  // Разрешаем CORS, чтобы фронтенд мог достучаться
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  const API_KEY = "ZXlKaGJHY2lPaUpJVXpVeE1pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SmpiR0Z6Y3lJNklrMWxjbU5vWVc1MElpd2ljSEp2Wm1sc1pWOXdheUk2TVRFek1UUTROU3dpYm1GdFpTSTZJakUzTnpFek16QTNOVEV1T1RVeU1qQTBJbjAuT2U0dzBVdUhQNHY4OXpnVUpzdHM3dElkUFd4Yjc5VzZheWF6Yy1wX19HOWZVblBLTlc4XzE4QTVLeHpzTkN3d0VHMW9wS01MbEFMS0lqbUl4UzdJUHc=";

  try {
    // Шаг 1: Auth
    const authResponse = await fetch('https://egypt.paymob.com/api/auth/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: API_KEY })
    });
    const authData = await authResponse.json();
    const token = authData.token;

    // Шаг 2: Order
    const orderResponse = await fetch('https://egypt.paymob.com/api/ecommerce/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: token,
        delivery_needed: "false",
        amount_cents: "10000",
        currency: "EGP",
        items: []
      })
    });
    const orderData = await orderResponse.json();

    // Шаг 3: Payment Key
    const keyResponse = await fetch('https://egypt.paymob.com/api/acceptance/payment_keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: token,
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
        integration_id: "5516060"
      })
    });
    const keyData = await keyResponse.json();

    // Возвращаем результат
    return res.json({ token: keyData.token });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
