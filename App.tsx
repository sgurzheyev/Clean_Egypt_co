import React, { useState } from 'react';

function App() {
  const [loading, setLoading] = useState(false);

  // Твои данные Paymob
  const PAYMOB_API_KEY = "ZXlKaGJHY2lPaUpJVXpVeE1pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SmpiR0Z6Y3lJNklrMWxjbU5vWVc1MElpd2ljSEp2Wm1sc1pWOXdheUk2TVRFek1UUTROU3dpYm1GdFpTSTZJakUzTnpFek16QTNOVEV1T1RVeU1qQTBJbjAuT2U0dzBVdUhQNHY4OXpnVUpzdHM3dElkUFd4Yjc5VzZheWF6Yy1wX19HOWZVblBLTlc4XzE4QTVLeHpzTkN3d0VHMW9wS01MbEFMS0lqbUl4UzdJUHc=";
  const INTEGRATION_ID = "5516060";
  const IFRAME_ID = "1007120";

  const handlePayMobPayment = async () => {
    setLoading(true);
    console.log("🚀 Запуск интеграции Paymob...");

    try {
      // ШАГ 1: Получение Auth Token
      const authResponse = await fetch('https://egypt.paymob.com/api/auth/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: PAYMOB_API_KEY })
      });
      const authData = await authResponse.json();
      const authToken = authData.token;

      // ШАГ 2: Создание заказа (Order Registration)
      const orderResponse = await fetch('https://egypt.paymob.com/api/ecommerce/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_token: authToken,
          delivery_needed: "false",
          amount_cents: "10000", // 100 EGP (в центах)
          currency: "EGP",
          items: []
        })
      });
      const orderData = await orderResponse.json();

      // ШАГ 3: Получение Payment Key
      const keyResponse = await fetch('https://egypt.paymob.com/api/acceptance/payment_keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_token: authToken,
          amount_cents: "10000",
          expiration: 3600,
          order_id: orderData.id,
          billing_data: {
            apartment: "NA", email: "sergio@cleanegypt.co", floor: "NA",
            first_name: "Sergio", street: "Hurghada St", building: "NA",
            phone_number: "+201000000000", shipping_method: "NA",
            postal_code: "NA", city: "Hurghada", country: "EG", last_name: "Gurgini"
          },
          currency: "EGP",
          integration_id: INTEGRATION_ID
        })
      });
      const keyData = await keyResponse.json();
      const paymentToken = keyData.token;

      // ШАГ 4: Перенаправление на оплату
      console.log("✅ Токен получен! Открываем оплату...");
      window.location.href = `https://egypt.paymob.com/api/acceptance/iframes/${IFRAME_ID}?payment_token=${paymentToken}`;

    } catch (error) {
      console.error("❌ Ошибка платежа:", error);
      alert("Paymob Error. Check console for details.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#020024] flex flex-col items-center justify-center relative overflow-hidden">
      {/* Твой фирменный неоновый фон */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#39FF14] via-[#FFF000] to-[#8B00FF] opacity-35"></div>
      
      <div className="relative z-10 flex flex-col items-center">
        <h1 className="text-7xl md:text-9xl font-black text-white mb-4 tracking-tighter drop-shadow-2xl">
          Clean Egypt
        </h1>
        <p className="text-xl md:text-2xl font-bold text-[#39FF14] uppercase tracking-[0.4em] mb-12">
          Red Sea Mission
        </p>

        <button
          onClick={handlePayMobPayment}
          disabled={loading}
          className={`group relative px-12 py-6 bg-black text-white rounded-2xl font-black text-2xl transition-all duration-300 hover:scale-105 active:scale-95 ${loading ? 'opacity-50' : ''}`}
        >
          <div className="absolute -inset-1 bg-gradient-to-r from-[#39FF14] via-[#FFF000] to-[#8B00FF] rounded-2xl blur opacity-70 group-hover:opacity-100 transition duration-300"></div>
          <span className="relative z-10">
            {loading ? "INITIALIZING..." : "CREATE ACCOUNT 🚀"}
          </span>
        </button>

        <p className="mt-10 text-white/40 font-mono text-xs uppercase tracking-widest">
          Secure Payment via PayMob | ID: {INTEGRATION_ID}
        </p>
      </div>
    </div>
  );
}

export default App;
