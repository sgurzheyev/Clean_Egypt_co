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

    // Normalize and validate numeric fields
    const finalAmountEgp = Number(amount_egp);
    const latNum = typeof location_lat === 'number' ? location_lat : Number(location_lat);
    const lngNum = typeof location_lng === 'number' ? location_lng : Number(location_lng);
    let missionIdForMetadata: string;

    // --- 1. HANDLE MISSION CREATION ---
    if (type === 'mission_creation') {
      if (!userId || !category) {
        return res.status(400).json({ error: 'Missing required fields for mission creation (userId/category)' });
      }
      if (!Number.isFinite(finalAmountEgp) || finalAmountEgp <= 0) {
        return res.status(400).json({ error: 'Invalid or missing amount_egp for mission creation' });
      }
      if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
        return res.status(400).json({ error: 'Invalid or missing location_lat/location_lng for mission creation' });
      }

      // Create mission in 'pending' status so it appears on the map immediately
      const { data: newMission, error: missionError } = await supabase
        .from('missions')
        .insert({
          creator_id: userId,
          category,
          amount_target: finalAmountEgp,
          location_lat: latNum,
          location_lng: lngNum,
          status: 'pending',
          description: description || null,
          photo_urls: creator_photos || [],
        })
        .select('id')
        .single();

      if (missionError) {
        console.error('Mission insert error:', missionError.message);
        return res.status(500).json({ error: 'Failed to create mission in database' });
      }

      missionIdForMetadata = newMission.id;

      // Create a notification for the mission creator
      const { error: notificationError } = await supabase
        .from('notifications')
        .insert({
          user_id: userId,
          title: 'Mission Created!',
          message: `Your mission in ${category} is now live on the map.`,
          mission_id: missionIdForMetadata,
        });

      if (notificationError) {
        // Log but do not fail the whole flow if notification creation fails
        console.error('Notification insert error:', notificationError.message);
      }
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
