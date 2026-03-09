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
    const {
      lat,
      lng,
      amount = 1,
      type = 'egypt',
      missionId,
      userId,
      taskType,
      location_lat,
      location_lng,
      description,
    } = req.body as {
      lat?: number;
      lng?: number;
      amount?: number;
      type?: string;
      missionId?: string;
      userId?: string;
      taskType?: 'city' | 'home';
      location_lat?: number;
      location_lng?: number;
      description?: string;
    };

    const exchangeRate = 50;
    let amountInEgp: number;
    let pyramidIdForMetadata: string;

    if (type === 'job_creation') {
      if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ error: 'userId is required for job_creation' });
      }
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: 'amount must be a positive number (USD)' });
      }
      if (!taskType || !['city', 'home'].includes(taskType)) {
        return res.status(400).json({ error: 'taskType must be city or home' });
      }
      if (typeof location_lat !== 'number' || typeof location_lng !== 'number') {
        return res.status(400).json({ error: 'location_lat and location_lng are required' });
      }

      amountInEgp = amount * exchangeRate;

      const { data: pendingJob, error: jobPendingError } = await supabase
        .from('job_payment_pending')
        .insert({
          creator_id: userId,
          task_type: taskType,
          amount,
          location_lat,
          location_lng,
          description: description || null,
        })
        .select('id')
        .single();

      if (jobPendingError) {
        console.error('job_payment_pending insert error:', jobPendingError.message);
        return res.status(500).json({ error: 'Failed to register job payment intent' });
      }

      pyramidIdForMetadata = pendingJob.id;
    } else if (type === 'worker_deposit') {
      if (!missionId) {
        return res.status(400).json({ error: 'missionId is required for worker_deposit' });
      }
      if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ error: 'userId is required for worker_deposit' });
      }
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: 'amount must be a positive number (EGP) for worker_deposit' });
      }

      // Verify mission exists (avoid creating Paymob orders for random IDs)
      const { data: mission, error: missionError } = await supabase
        .from('pyramids')
        .select('id')
        .eq('id', missionId)
        .maybeSingle();

      if (missionError) {
        console.error('Supabase Mission Fetch Error:', missionError.message);
        return res.status(500).json({ error: 'Failed to fetch mission' });
      }

      if (!mission) {
        return res.status(404).json({ error: 'Mission not found' });
      }

      amountInEgp = amount; // already EGP from frontend
      pyramidIdForMetadata = missionId;
    } else {
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return res.status(400).json({ error: 'lat and lng are required' });
      }
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: 'amount must be a positive number' });
      }

      amountInEgp = amount * exchangeRate;

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
            mission_type: type,
          },
        ])
        .select()
        .single();

      if (dbError) {
        console.error('Supabase Insert Error:', dbError.message);
        throw new Error('Database insert failed: ' + dbError.message);
      }

      pyramidIdForMetadata = pyramid.id;

      // 5. СВЯЗКА: Сохраняем полученный paymob_order_id в нашу таблицу pyramids
      // (делаем ниже, когда получим order id)
    }

    const amountCents = Math.round(amountInEgp * 100).toString();

    // 3. AUTH PAYMOB: Получаем токен авторизации
    const authRes = await fetch('https://accept.paymob.com/api/auth/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.PAYMOB_API_KEY })
    });
    const authData = await authRes.json();
    if (!authData.token) throw new Error("Paymob Auth Failed");

    const merchantOrderId =
      type === 'job_creation'
        ? `job:${pyramidIdForMetadata}_${Date.now()}`
        : `${type}:${pyramidIdForMetadata}_${Date.now()}`;

    const orderRes = await fetch('https://accept.paymob.com/api/ecommerce/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authData.token,
        delivery_needed: "false",
        amount_cents: amountCents,
        currency: "EGP",
        merchant_order_id: merchantOrderId,
        items: []
      })
    });
    const orderData = await orderRes.json();
    const paymobOrderId = orderData.id;

    if (!paymobOrderId) throw new Error("Paymob Order Creation Failed");

    if (type === 'job_creation') {
      const { error: jobUpdateErr } = await supabase
        .from('job_payment_pending')
        .update({ paymob_order_id: paymobOrderId.toString() })
        .eq('id', pyramidIdForMetadata);
      if (jobUpdateErr) {
        console.error('job_payment_pending update error:', jobUpdateErr.message);
        return res.status(500).json({ error: 'Failed to link Paymob order' });
      }
    } else if (type === 'worker_deposit') {
      const { error: pendingError } = await supabase
        .from('payment_pending')
        .insert({
          paymob_order_id: paymobOrderId.toString(),
          pyramid_id: pyramidIdForMetadata,
          user_id: userId,
          type: 'worker_deposit',
        });

      if (pendingError) {
        console.error('payment_pending insert error:', pendingError.message);
        return res.status(500).json({ error: 'Failed to register payment intent' });
      }
    } else {
      const { error: updateError } = await supabase
        .from('pyramids')
        .update({ paymob_order_id: paymobOrderId.toString() })
        .eq('id', pyramidIdForMetadata);

      if (updateError) {
        console.error('Supabase Update Error:', updateError.message);
      }
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

    const iframeId = process.env.PAYMOB_IFRAME_ID;
    const paymentUrl = iframeId
      ? `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${keyData.token}`
      : null;

    // Возвращаем токен/ссылку на фронтенд для загрузки Iframe; missionId нужен для очистки при отмене
    return res.status(200).json({
      paymentToken: keyData.token,
      paymentUrl,
      mode: type === 'worker_deposit' ? 'worker_deposit' : 'pyramid_creation',
      missionId: pyramidIdForMetadata,
    });

  } catch (error: any) {
    console.error("Server Error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
