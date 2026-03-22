// lib/paymob.ts

export const generatePaymobLink = async (
  /** Whole EGP amount; charged as EGP piastres (×100). */
  amountEgpWhole: number,
  userEmail: string,
  userFirstName: string = 'Eco',
  userLastName: string = 'Hero',
  userPhone: string = '+201000000000'
) => {
  const apiKey = import.meta.env.VITE_PAYMOB_API_KEY;
  const integrationId = import.meta.env.VITE_PAYMOB_INTEGRATION_ID;
  const iframeId = import.meta.env.VITE_PAYMOB_IFRAME_ID;

  const amountInCents = Math.floor(Math.max(0, amountEgpWhole)) * 100;

  try {
    // ШАГ 1: Аутентификация (Authentication Request)
    const authResponse = await fetch('https://accept.paymob.com/api/auth/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey }),
    });
    const authData = await authResponse.json();
    const authToken = authData.token;

    // ШАГ 2: Регистрация заказа (Order Registration API)
    const orderResponse = await fetch('https://accept.paymob.com/api/ecommerce/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authToken,
        delivery_needed: "false",
        amount_cents: amountInCents,
        currency: 'EGP',
        items: [], // Можно оставить пустым или добавить описание
      }),
    });
    const orderData = await orderResponse.json();
    const orderId = orderData.id;

    // ШАГ 3: Получение платежного ключа (Payment Key Request)
    const paymentKeyResponse = await fetch('https://accept.paymob.com/api/acceptance/payment_keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authToken,
        amount_cents: amountInCents,
        expiration: 3600,
        order_id: orderId,
        billing_data: {
          apartment: "NA",
          email: userEmail,
          floor: "NA",
          first_name: userFirstName,
          street: "NA",
          building: "NA",
          phone_number: userPhone,
          shipping_method: "NA",
          postal_code: "NA",
          city: "Hurghada",
          country: "EG",
          last_name: userLastName,
          state: "Red Sea"
        },
        currency: 'EGP',
        integration_id: integrationId
      }),
    });
    const paymentKeyData = await paymentKeyResponse.json();
    const paymentToken = paymentKeyData.token;

    // Формируем итоговую ссылку на iframe
    return `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${paymentToken}`;

  } catch (error) {
    console.error("PayMob Error:", error);
    return null;
  }
};
