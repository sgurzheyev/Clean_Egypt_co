import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Server-side Supabase client (service role)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey || !supabaseAnonKey) {
  throw new Error(
    'Missing server env vars: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY (do not rely on VITE_* on server)'
  );
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);

function bearerToken(req: VercelRequest): string | null {
  const h = req.headers.authorization || req.headers.Authorization;
  if (!h || typeof h !== 'string') return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = bearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { data: userRes, error: userErr } = await supabaseAuth.auth.getUser(token);
    const authedUser = userRes?.user ?? null;
    if (userErr || !authedUser?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const authedUserId = authedUser.id;

    const {
      type, // 'mission_creation' or 'worker_deposit'
      category, // 'public' | 'home' | 'office'
      amount_target,
      location_lat,
      location_lng,
      missionId, // needed for deposits
      description,
      creator_photos,
      /** Resume Paymob checkout for an existing unpaid mission (no duplicate row). */
      existing_mission_id,
      /** Skip Paymob: create/resume mission row only; client calls `pay_mission_from_wallet`. */
      defer_payment,
    } = req.body;

    let finalAmountTarget = Math.floor(Math.max(0, Number(amount_target)));
    let latNum = typeof location_lat === 'number' ? location_lat : Number(location_lat);
    let lngNum = typeof location_lng === 'number' ? location_lng : Number(location_lng);
    let missionIdForMetadata: string;

    // --- 1. HANDLE MISSION CREATION ---
    if (type === 'mission_creation') {
      const resumeId =
        typeof existing_mission_id === 'string' && existing_mission_id.length > 0
          ? existing_mission_id
          : null;

      if (resumeId) {
        const { data: existing, error: exErr } = await supabase
          .from('missions')
          .select(
            'id, creator_id, category, amount_target, location_lat, location_lng, status, description, photo_urls'
          )
          .eq('id', resumeId)
          .maybeSingle();

        if (exErr || !existing) {
          return res.status(400).json({ error: 'Mission not found' });
        }
        if (existing.creator_id !== authedUserId) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        if (existing.status !== 'pending_payment') {
          return res.status(400).json({ error: 'Mission is not awaiting payment' });
        }

        missionIdForMetadata = existing.id;
        finalAmountTarget = Math.floor(Math.max(0, Number(existing.amount_target)));
        latNum = Number(existing.location_lat);
        lngNum = Number(existing.location_lng);
        if (!Number.isFinite(finalAmountTarget) || finalAmountTarget <= 0) {
          return res.status(400).json({ error: 'Invalid amount_target on mission' });
        }
        if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
          return res.status(400).json({ error: 'Invalid coordinates on mission' });
        }
      } else {
        if (!category) {
          return res.status(400).json({ error: 'Missing required fields for mission creation (category)' });
        }
        if (!Number.isFinite(finalAmountTarget) || finalAmountTarget <= 0) {
          return res.status(400).json({ error: 'Invalid or missing amount_target for mission creation' });
        }
        if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
          return res.status(400).json({ error: 'Invalid or missing location_lat/location_lng for mission creation' });
        }

        // Create mission in 'pending_payment' so it does NOT appear on the map until paid
        const { data: newMission, error: missionError } = await supabase
          .from('missions')
          .insert({
            creator_id: authedUserId,
            category,
            amount_target: finalAmountTarget,
            location_lat: latNum,
            location_lng: lngNum,
            status: 'pending_payment',
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

        // IMPORTANT:
        // Do NOT notify here. Only after payment succeeds (paymob-webhook will do it).
      }
    }
    // --- 2. HANDLE WORKER DEPOSIT ---
    else if (type === 'worker_deposit') {
      if (!finalAmountTarget) {
        return res.status(400).json({ error: 'Missing fields for deposit' });
      }
      // Webhook parses merchant_order_id as `worker_deposit:<userId>_...` and credits that profile.
      missionIdForMetadata = authedUserId;
    } else {
       return res.status(400).json({ error: 'Invalid payment type' });
    }

    /** Wallet-only checkout: mission row exists (or resume); no Paymob session. */
    if (type === 'mission_creation' && defer_payment) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('wallet_balance')
        .eq('id', authedUserId)
        .maybeSingle();
      const wb = Math.floor(Number(prof?.wallet_balance ?? 0));
      if (wb < finalAmountTarget) {
        return res.status(400).json({ error: 'Insufficient wallet balance' });
      }
      return res.status(200).json({
        missionId: missionIdForMetadata,
        deferred: true,
        amountEgp: finalAmountTarget,
      });
    }

    // Integer EGP → piastres (1 EGP = 100); avoid float rounding (e.g. 250.999 → wrong cents).
    const amountCents = String(Math.floor(finalAmountTarget * 100));

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
      /** Integer EGP charged (matches Paymob amount_cents / 100). */
      amountEgp: finalAmountTarget,
    });

  } catch (error: any) {
    console.error("Server Error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
