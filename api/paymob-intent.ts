import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Server-side Supabase client (service role)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing server env vars: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      type, // 'mission_creation' or 'worker_deposit'
      category, // 'public' | 'home' | 'office'
      amount_egp,
      location_lat,
      location_lng,
      userId,
      missionId, // needed for deposits
      description,
      creator_photos,
    } = req.body;

    const exchangeRate = 50; // Use if conversion from USD is needed, but we assume EGP for now based on 'amount_egp'
    let finalAmountEgp = amount_egp;
    let missionIdForMetadata: string;

    // --- 1. HANDLE MISSION CREATION ---
    if (type === 'mission_creation') {
      if (!userId || !category || !finalAmountEgp || !location_lat || !location_lng) {
        return res.status(400).json({ error: 'Missing required fields for mission creation' });
      }

      // Создаем миссию в статусе pending (ожидает оплаты)
      const { data: newMission, error: missionError } = await supabase
        .from('missions')
        .insert({
          creator_id: userId,
          category,
          amount_target: finalAmountEgp,
          location_lat,
          location_lng,
          status: 'collecting', // or 'pending' depending on your logic
          description: description || null,
          creator_photos: creator_photos || [],
        })
        .select('id')
        .single();

      if (missionError) {
        console.error('Mission insert error:', missionError.message);
        return res.status(500).json({ error: 'Failed to create mission in database' });
      }

      missionIdForMetadata = newMission.id;
    }
    // --- 2. HANDLE WORKER DEPOSIT ---
    else if (type === 'worker_deposit') {
      if (!missionId || !userId || !finalAmountEgp) {
        return res.status(400).json({ error: 'Missing fields for deposit' });
      }
      missionIdForMetadata = missionId;
    } else {
       return res.status(400).json({ error: 'Invalid payment type' });
    }

    const amountCents = Math.round(finalAmountEgp * 100).toString();

    // --- 3. PAYMOB AUTH ---
    const authRes = await fetch('https://accept.paymob.com/api/auth/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.PAYMOB_API_KEY })
    });
    const authData = await authRes.json();
    if (!authData.token) throw new Error("Paymob Auth Failed");

    // --- 4. PAYMOB ORDER ---
    const merchantOrderId = `${type}:${missionIdForMetadata}_${Date.now()}`;

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

    // --- 5. PAYMOB PAYMENT KEY ---
    const keyRes = await fetch('https://accept.paymob.com/api/acceptance/payment_keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authData.token,
        amount_cents: amountCents,
        expiration: 3600,
        order_id: paymobOrderId,
        billing_data: {
          first_name: "Sergio", // In a real app, pull from profile
          last_name: "CleanEgypt",
          email: "support@cleanegypt.co",
          phone_number: "01000000000",
          apartment: "NA", floor: "NA", street: "NA",
          building: "NA", shipping_method: "NA", postal_code: "NA", city: "NA",
          country: "EG", state: "NA"
        },
        currency: "EGP",
        integration_id: Number(process.env.PAYMOB_INTEGRATION_ID)
      })
    });
   
    const keyData = await keyRes.json();
   
    if (!keyData.token) {
        throw new Error("Failed to get payment token");
    }

    const iframeId = process.env.PAYMOB_IFRAME_ID;
    const paymentUrl = iframeId
      ? `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${keyData.token}`
      : null;

    // Return token to frontend
    return res.status(200).json({
      paymentToken: keyData.token,
      paymentUrl,
      mode: type,
      missionId: missionIdForMetadata,
    });

  } catch (error: any) {
    console.error("Server Error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
