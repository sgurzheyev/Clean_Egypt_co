import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Разрешаем только POST-запросы
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = req.body as { amountEgp?: unknown; amountUsd?: unknown; billingData?: unknown };
    /** Amount to charge in EGP (whole pounds → piastres). Legacy `amountUsd` accepted only for old clients — treated as EGP if sent. */
    const raw = body.amountEgp ?? body.amountUsd;
    const billingData = body.billingData;
    const amountCents = Math.floor(Math.max(0, Number(raw)) * 100);

    // 1. Аутентификация
    const authRes = await fetch('https://accept.paymob.com/api/auth/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.PAYMOB_API_KEY })
    });
    const authData = await authRes.json();
    const token = authData.token;

    // 2. Регистрация заказа
    const orderRes = await fetch('https://accept.paymob.com/api/ecommerce/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: token,
        delivery_needed: "false",
        amount_cents: amountCents,
        currency: "EGP",
        items: []
      })
    });
    const orderData = await orderRes.json();
    const orderId = orderData.id;

    // 3. Получение Payment Key
    const paymentKeyRes = await fetch('https://accept.paymob.com/api/acceptance/payment_keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: token,
        amount_cents: amountCents,
        expiration: 3600,
        order_id: orderId,
        billing_data: billingData,
        currency: "EGP",
        integration_id: process.env.PAYMOB_INTEGRATION_ID
      })
    });
    const paymentKeyData = await paymentKeyRes.json();

    // Отдаем токен на фронт
    return res.status(200).json({ paymentToken: paymentKeyData.token });

  } catch (error) {
    console.error('Ошибка интеграции Paymob:', error);
    return res.status(500).json({ error: 'Payment initialization failed' });
  }
}
