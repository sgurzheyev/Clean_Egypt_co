/**
 * Placeholder cron/webhook endpoint for expired Garbage Removal crowdfunding campaigns.
 *
 * Intended flow (wire when deploying a scheduled job):
 * 1. Call Supabase RPC `process_expired_crowdfunding_missions()` with service role.
 * 2. Fetch pending rows from `city_notification_events`.
 * 3. Generate PDF via `generateCityNotificationPdfPlaceholder` (replace with real PDF).
 * 4. Upload PDF + mark pdf_status = 'generated' | 'sent'.
 *
 * No Paymob — platform billing remains Stripe-only.
 */
import {
  buildCityNotificationSummary,
  generateCityNotificationPdfPlaceholder,
  type CityNotificationEvent,
} from '../src/lib/cityNotification';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Auth gate for cron secrets should be added before production use.
  const secret = req.headers?.['x-cron-secret'] || req.headers?.['authorization'];
  if (!secret) {
    res.status(401).json({ error: 'Missing cron secret' });
    return;
  }

  try {
    // Placeholder: real implementation uses SUPABASE_SERVICE_ROLE_KEY + rpc + select.
    console.info('[process-expired-crowdfunding] stub invoked', {
      at: new Date().toISOString(),
      summaryHelperReady: typeof buildCityNotificationSummary === 'function',
      pdfHelperReady: typeof generateCityNotificationPdfPlaceholder === 'function',
    });

    const sample: CityNotificationEvent = {
      id: 'stub',
      mission_id: '00000000-0000-0000-0000-000000000000',
      event_type: 'crowdfunding_expired',
      payload: {
        service_type: 'junk_removal',
        target_budget: 0,
        raised: 0,
      },
      pdf_status: 'pending',
      created_at: new Date().toISOString(),
    };
    await generateCityNotificationPdfPlaceholder(sample);

    res.status(200).json({
      ok: true,
      message:
        'Placeholder only. Deploy cron to call process_expired_crowdfunding_missions and generate PDFs.',
    });
  } catch (err: any) {
    console.error('[process-expired-crowdfunding]', err);
    res.status(500).json({ error: err?.message || 'Failed' });
  }
}
