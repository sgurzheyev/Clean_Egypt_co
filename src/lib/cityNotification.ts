/**
 * City Notification helpers — client/server summary builders.
 *
 * Production PDF + Telegram/email dispatch lives in the Edge Function:
 *   supabase/functions/city-notification-pipeline
 *
 * Rows are queued in `city_notification_events` (pdf_status = pending) by:
 *   • process_expired_crowdfunding_missions → event_type = crowdfunding_expired
 *   • trg_enqueue_crowdfunding_completion_notification → mission_completed
 */
export type CityNotificationPayload = {
  service_type?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  target_budget?: number | null;
  raised?: number | null;
  description?: string | null;
  expired_at?: string | null;
  funding_expires_at?: string | null;
  completed_at?: string | null;
};

export type CityNotificationEvent = {
  id: string;
  mission_id: string;
  event_type: string;
  payload: CityNotificationPayload;
  pdf_status: 'pending' | 'generated' | 'sent' | 'skipped';
  created_at: string;
  pdf_url?: string | null;
  processed_at?: string | null;
  last_error?: string | null;
};

/** Build a plain-text summary suitable for PDF body / email attachment. */
export function buildCityNotificationSummary(
  event: Pick<CityNotificationEvent, 'mission_id' | 'event_type' | 'payload' | 'created_at'>
): string {
  const p = event.payload || {};
  const isExpired = event.event_type === 'crowdfunding_expired';
  const lines = [
    isExpired
      ? 'Garbagin — Official Escalation Request to Municipality'
      : 'Garbagin — Crowdfunding Success / Completion Report',
    '============================================',
    `Mission ID: ${event.mission_id}`,
    `Event type: ${event.event_type}`,
    `Event logged: ${event.created_at}`,
    `Service: ${p.service_type ?? 'n/a'}`,
    `Location: ${p.location_lat ?? '?'}, ${p.location_lng ?? '?'}`,
    `Target budget (USD): ${p.target_budget ?? 0}`,
    `Raised (USD): ${p.raised ?? 0}`,
    isExpired
      ? `Expired at: ${p.expired_at ?? 'n/a'}`
      : `Completed at: ${p.completed_at ?? 'n/a'}`,
    '',
    'Description:',
    p.description?.trim() || '(none)',
    '',
    isExpired
      ? 'Status: Crowdfunding target was not reached within the campaign window. Funds retained as processing fee (no card refunds). Action requested: municipal cleanup follow-up.'
      : 'Status: Campaign funded and mission completed. This report is for municipal / contributor records.',
  ];
  return lines.join('\n');
}

/**
 * @deprecated Prefer Edge Function `city-notification-pipeline`.
 * Kept for local/cron stubs that only need a text summary.
 */
export async function generateCityNotificationPdfPlaceholder(
  event: CityNotificationEvent
): Promise<{ ok: true; summary: string; pdfStatus: 'pending' }> {
  const summary = buildCityNotificationSummary(event);
  console.info('[city-notification] summary ready (PDF via Edge Function)', {
    eventId: event.id,
    missionId: event.mission_id,
    eventType: event.event_type,
    summaryLength: summary.length,
  });
  return { ok: true, summary, pdfStatus: 'pending' };
}
