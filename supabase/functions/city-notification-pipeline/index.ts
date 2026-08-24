/**
 * City Notification Pipeline
 *
 * Processes `city_notification_events` rows:
 *  1) Build a PDF (pdf-lib) — escalation or success report
 *  2) Upload to Cloudflare R2 (`city-pdfs/{missionId}/{eventId}.pdf`)
 *  3) Telegram sendDocument (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID / TELEGRAM_ADMIN_CHAT_ID)
 *  4) Email stub (Resend if RESEND_API_KEY + ADMIN_EMAIL set; otherwise log)
 *  5) Mark pdf_status = 'sent' (or 'generated' if dispatch skipped)
 *
 * Invoked by Database Webhook on INSERT, or manually:
 *   POST { "event_id": "<uuid>" }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { PutObjectCommand } from 'npm:@aws-sdk/client-s3@3.699.0';
import { createR2Client, readR2Env } from '../_shared/r2.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type EventRow = {
  id: string;
  mission_id: string;
  event_type: string;
  payload: Record<string, unknown> | null;
  pdf_status: string;
  created_at: string;
};

type MissionRow = {
  id: string;
  service_type?: string | null;
  description?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  country?: string | null;
  city?: string | null;
  expected_price?: number | null;
  current_funding?: number | null;
  status?: string | null;
  crowdfunding_mode?: boolean | null;
  crowdfunding_expires_at?: string | null;
  photo_urls?: string[] | null;
  created_at?: string | null;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown, fallback = ''): string {
  if (v == null) return fallback;
  const s = String(v).trim();
  return s.length ? s : fallback;
}

function wrapLines(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) {
      cur = next;
    } else {
      if (cur) lines.push(cur);
      cur = w.length > maxChars ? w.slice(0, maxChars) : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : ['(none)'];
}

async function buildPdfBytes(opts: {
  eventType: string;
  event: EventRow;
  mission: MissionRow | null;
}): Promise<Uint8Array> {
  const { eventType, event, mission } = opts;
  const payload = (event.payload || {}) as Record<string, unknown>;
  const isExpired = eventType === 'crowdfunding_expired';
  const title = isExpired
    ? 'Official Escalation Request to Municipality'
    : 'Crowdfunding Success / Completion Report';
  const subtitle = isExpired
    ? 'Garbagin — Municipal Intervention Request'
    : 'Garbagin — Cleanup Completion Certificate';

  const lat = num(payload.location_lat ?? mission?.location_lat, NaN);
  const lng = num(payload.location_lng ?? mission?.location_lng, NaN);
  const placeCity = str(mission?.city, '');
  const placeCountry = str(mission?.country, '');
  const placeLabel = [placeCity, placeCountry].filter(Boolean).join(', ');
  const target = num(payload.target_budget ?? mission?.expected_price, 0);
  const raised = num(payload.raised ?? mission?.current_funding, 0);
  const service = str(payload.service_type ?? mission?.service_type, 'n/a');
  const description = str(payload.description ?? mission?.description, '(none)');
  const fundingExpires = str(
    payload.funding_expires_at ?? mission?.crowdfunding_expires_at,
    'n/a'
  );
  const expiredAt = str(payload.expired_at, event.created_at);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const margin = 48;
  let y = 790;

  const draw = (text: string, size = 11, bold = false, color = rgb(0.1, 0.12, 0.16)) => {
    page.drawText(text, {
      x: margin,
      y,
      size,
      font: bold ? fontBold : font,
      color,
    });
    y -= size + 6;
  };

  // Header bar
  page.drawRectangle({
    x: 0,
    y: 800,
    width: 595,
    height: 42,
    color: isExpired ? rgb(0.72, 0.18, 0.18) : rgb(0.05, 0.55, 0.42),
  });
  page.drawText('Garbagin', {
    x: margin,
    y: 814,
    size: 14,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  y = 770;
  draw(title, 16, true, isExpired ? rgb(0.55, 0.1, 0.1) : rgb(0.05, 0.4, 0.32));
  draw(subtitle, 10, false, rgb(0.35, 0.38, 0.42));
  y -= 8;

  draw(`Event type: ${eventType}`, 10, true);
  draw(`Event ID: ${event.id}`, 9);
  draw(`Mission ID: ${event.mission_id}`, 9);
  draw(`Logged at: ${event.created_at}`, 9);
  y -= 6;

  draw('Campaign details', 12, true);
  draw(`Service: ${service}`);
  if (placeLabel) {
    draw(`Location: ${placeLabel}`);
  }
  draw(
    `Coordinates: ${Number.isFinite(lat) ? lat.toFixed(6) : '?'}, ${
      Number.isFinite(lng) ? lng.toFixed(6) : '?'
    }`
  );
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    draw(`Map: https://www.google.com/maps?q=${lat},${lng}`, 9, false, rgb(0.15, 0.35, 0.65));
  }
  draw(`Target budget (USD): $${target}`);
  draw(`Raised (USD): $${raised}`);
  draw(`Funding window end: ${fundingExpires}`);
  if (isExpired) {
    draw(`Expired at: ${expiredAt}`);
    draw(`Shortfall (USD): $${Math.max(0, target - raised)}`);
  } else {
    draw(`Mission status: ${str(mission?.status, 'completed')}`);
  }
  y -= 8;

  draw('Description', 12, true);
  for (const line of wrapLines(description, 82).slice(0, 12)) {
    draw(line, 10);
  }
  y -= 10;

  if (isExpired) {
    draw('Escalation statement', 12, true, rgb(0.55, 0.1, 0.1));
    for (const line of wrapLines(
      'Crowdfunding did not reach the target within the campaign window. ' +
        'Contributed funds are retained by Garbagin as a processing fee per platform policy ' +
        '(no card refunds). This document is an official request for municipal / city public-works ' +
        'review and possible intervention at the stated coordinates.',
      82
    )) {
      draw(line, 10);
    }
  } else {
    draw('Completion statement', 12, true, rgb(0.05, 0.4, 0.32));
    for (const line of wrapLines(
      'The crowdfunding target was met and the cleanup mission was marked completed. ' +
        'This report certifies platform-recorded completion for municipal records and ' +
        'contributor transparency.',
      82
    )) {
      draw(line, 10);
    }
  }

  y = Math.min(y, 90);
  page.drawText('Generated automatically by Garbagin city-notification-pipeline', {
    x: margin,
    y: 48,
    size: 8,
    font,
    color: rgb(0.45, 0.48, 0.52),
  });

  return await pdf.save();
}

async function uploadPdf(
  eventId: string,
  missionId: string,
  bytes: Uint8Array
): Promise<string | null> {
  const r2 = readR2Env();
  if ('error' in r2) {
    console.error('[city-notification-pipeline] R2 env missing', r2.error);
    return null;
  }

  const objectKey = `city-pdfs/${missionId}/${eventId}.pdf`;
  try {
    const client = createR2Client(r2);
    await client.send(
      new PutObjectCommand({
        Bucket: r2.bucket,
        Key: objectKey,
        Body: bytes,
        ContentType: 'application/pdf',
        Metadata: {
          event_id: eventId,
          mission_id: missionId,
          folder: 'city-pdfs',
        },
      })
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[city-notification-pipeline] R2 upload failed', msg);
    return null;
  }

  const publicBase = String(Deno.env.get('R2_PUBLIC_BASE_URL') || '')
    .trim()
    .replace(/\/$/, '');
  // Prefer public URL for email/Telegram links; fall back to object key.
  return publicBase ? `${publicBase}/${objectKey}` : objectKey;
}

async function sendTelegramPdf(opts: {
  filename: string;
  bytes: Uint8Array;
  caption: string;
}): Promise<boolean> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const chatId =
    Deno.env.get('TELEGRAM_CHAT_ID') || Deno.env.get('TELEGRAM_ADMIN_CHAT_ID');
  if (!token || !chatId) {
    console.warn('[city-notification-pipeline] Telegram env missing; skip sendDocument');
    return false;
  }

  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', opts.caption.slice(0, 1024));
  form.append(
    'document',
    new Blob([opts.bytes], { type: 'application/pdf' }),
    opts.filename
  );

  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('[city-notification-pipeline] Telegram sendDocument failed', res.status, body);
    return false;
  }
  return true;
}

/** Email stub: Resend when configured; otherwise structured log for ops. */
async function sendAdminEmailStub(opts: {
  subject: string;
  text: string;
  pdfFilename: string;
  pdfBytes: Uint8Array;
  pdfUrl: string | null;
}): Promise<'sent' | 'stubbed' | 'skipped'> {
  const adminEmail = Deno.env.get('ADMIN_EMAIL') || Deno.env.get('GARBAGIN_ADMIN_EMAIL');
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RESEND_FROM_EMAIL') || 'Garbagin <noreply@garbagin.com>';

  if (!adminEmail) {
    console.info('[city-notification-pipeline] ADMIN_EMAIL not set; email skipped', {
      subject: opts.subject,
      pdfUrl: opts.pdfUrl,
    });
    return 'skipped';
  }

  if (!resendKey) {
    console.info('[city-notification-pipeline] email stub (no RESEND_API_KEY)', {
      to: adminEmail,
      subject: opts.subject,
      pdfUrl: opts.pdfUrl,
      pdfBytes: opts.pdfBytes.byteLength,
    });
    return 'stubbed';
  }

  // Resend supports attachments as base64 (chunked — avoid stack overflow on large PDFs).
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < opts.pdfBytes.length; i += chunk) {
    binary += String.fromCharCode(...opts.pdfBytes.subarray(i, i + chunk));
  }
  const b64 = btoa(binary);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [adminEmail],
      subject: opts.subject,
      text: opts.text + (opts.pdfUrl ? `\n\nPDF: ${opts.pdfUrl}` : ''),
      attachments: [
        {
          filename: opts.pdfFilename,
          content: b64,
        },
      ],
    }),
  });

  if (!res.ok) {
    console.error('[city-notification-pipeline] Resend failed', res.status, await res.text());
    return 'stubbed';
  }
  return 'sent';
}

function extractEventId(body: Record<string, unknown>): string | null {
  if (typeof body.event_id === 'string' && body.event_id.trim()) return body.event_id.trim();
  if (typeof body.id === 'string' && body.id.trim()) return body.id.trim();
  const record = body.record as Record<string, unknown> | undefined;
  if (record && typeof record.id === 'string') return record.id;
  // Supabase Database Webhook sometimes nests under `record`
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const webhookSecret = Deno.env.get('CITY_NOTIFICATION_WEBHOOK_SECRET');
  if (webhookSecret) {
    const provided =
      req.headers.get('x-webhook-secret') ||
      req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (provided !== webhookSecret) {
      return json({ error: 'Unauthorized' }, 401);
    }
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Missing Supabase env' }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  // Ignore non-INSERT webhook noise if present
  if (typeof body.type === 'string' && body.type !== 'INSERT' && !body.event_id) {
    return json({ received: true, ignored: true, type: body.type });
  }

  const eventId = extractEventId(body);
  if (!eventId) {
    return json({ error: 'Missing event_id / record.id' }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: event, error: eventErr } = await supabase
    .from('city_notification_events')
    .select('id, mission_id, event_type, payload, pdf_status, created_at')
    .eq('id', eventId)
    .maybeSingle();

  if (eventErr || !event) {
    return json({ error: eventErr?.message || 'Event not found' }, 404);
  }

  const row = event as EventRow;
  if (row.pdf_status === 'sent') {
    return json({ ok: true, idempotent: true, event_id: row.id, pdf_status: 'sent' });
  }

  const { data: mission } = await supabase
    .from('missions')
    .select(
      'id, service_type, description, location_lat, location_lng, country, city, expected_price, current_funding, status, crowdfunding_mode, crowdfunding_expires_at, photo_urls, created_at'
    )
    .eq('id', row.mission_id)
    .maybeSingle();

  const eventType = str(row.event_type, 'crowdfunding_expired');
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await buildPdfBytes({
      eventType,
      event: row,
      mission: (mission || null) as MissionRow | null,
    });
  } catch (e: any) {
    console.error('[city-notification-pipeline] PDF build failed', e?.message || e);
    await supabase
      .from('city_notification_events')
      .update({
        pdf_status: 'pending',
        last_error: String(e?.message || 'PDF build failed').slice(0, 500),
      })
      .eq('id', row.id);
    return json({ error: 'PDF generation failed' }, 500);
  }

  await supabase
    .from('city_notification_events')
    .update({ pdf_status: 'generated', last_error: null })
    .eq('id', row.id);

  const filename = `Garbagin_${eventType}_${row.mission_id.slice(0, 8)}.pdf`;
  const pdfUrl = await uploadPdf(row.id, row.mission_id, pdfBytes);

  if (pdfUrl) {
    await supabase
      .from('city_notification_events')
      .update({ pdf_url: pdfUrl })
      .eq('id', row.id);
  }

  const caption =
    eventType === 'crowdfunding_expired'
      ? `🏛 Escalation: crowdfunding expired\nMission ${row.mission_id.slice(0, 8)}…`
      : `✅ Completion report\nMission ${row.mission_id.slice(0, 8)}…`;

  const telegramOk = await sendTelegramPdf({ filename, bytes: pdfBytes, caption });
  const emailStatus = await sendAdminEmailStub({
    subject:
      eventType === 'crowdfunding_expired'
        ? `[Garbagin] Municipal escalation — ${row.mission_id.slice(0, 8)}`
        : `[Garbagin] Completion report — ${row.mission_id.slice(0, 8)}`,
    text: `${caption}\n\nEvent: ${row.id}\nType: ${eventType}`,
    pdfFilename: filename,
    pdfBytes,
    pdfUrl,
  });

  // Mark sent if at least one channel delivered, or generated+uploaded with stubs logged.
  const dispatched = telegramOk || emailStatus === 'sent';
  const finalStatus = dispatched ? 'sent' : 'generated';

  await supabase
    .from('city_notification_events')
    .update({
      pdf_status: finalStatus,
      processed_at: new Date().toISOString(),
      last_error: dispatched
        ? null
        : 'PDF generated; Telegram/email not fully delivered (check env stubs)',
    })
    .eq('id', row.id);

  return json({
    ok: true,
    event_id: row.id,
    event_type: eventType,
    pdf_status: finalStatus,
    pdf_url: pdfUrl,
    telegram: telegramOk,
    email: emailStatus,
  });
});
