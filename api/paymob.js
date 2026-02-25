export default async function handler(req, res) {
  const API_KEY = "ZXlKaGJHY2lPaUpJVXpVeE1pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SmpiR0Z6Y3lJNklrMWxjbU5vWVc1MElpd2ljSEp2Wm1sc1pWOXdheUk2TVRFek1UUTROU3dpYm1GdFpTSTZJakUzTnpFek16QTNOVEV1T1RVeU1qQTBJbjAuT2U0dzBVdUhQNHY4OXpnVUpzdHM3dElkUFd4Yjc5VzZheWF6Yy1wX19HOWZVblBLTlc4XzE4QTVLeHpzTkN3d0VHMW9wS01MbEFMS0lqbUl4UzdJUHc=";
  
  try {
    // 1. Получаем Auth Token
    const authRes = await fetch('https://egypt.paymob.com/api/auth/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: API_KEY })
    });
    const authData = await authRes.json();
    const authToken = authData.token;

    // 2. Регистрируем заказ
    const orderRes = await fetch('https://egypt.paymob.com/api/ecommerce/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authToken,
        delivery_needed: "false",
        amount_cents: "10000",
        currency: "EGP",
        items: []
      })
    });
    const orderData = await orderRes.json();

    // 3. Получаем Payment Key
    const keyRes = await fetch('https://egypt.paymob.com/api/acceptance/payment_keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authToken,
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
    const keyData = await keyRes.json();

    // Отправляем токен обратно на фронтенд
    res.status(200).json({ token: keyData.token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
