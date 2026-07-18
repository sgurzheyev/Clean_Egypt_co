/**
 * City Notification placeholder — when a Garbage Removal crowdfunding campaign
 * expires underfunded, `process_expired_crowdfunding_missions` inserts a row into
 * `city_notification_events` with pdf_status = 'pending'.
 *
 * This module is the client/server stub for generating a PDF summary for local
 * authorities. Wire a real PDF renderer (e.g. @react-pdf/renderer or a Supabase
 * Edge Function + storage upload) when ready.
 */

export type CityNotificationPayload = {
  service_type?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  target_budget?: number | null;
  raised?: number | null;
  description?: string | null;
  expired_at?: string | null;
};

export type CityNotificationEvent = {
  id: string;
  mission_id: string;
  event_type: string;
  payload: CityNotificationPayload;
  pdf_status: 'pending' | 'generated' | 'sent' | 'skipped';
  created_at: string;
};

/** Build a plain-text summary suitable for PDF body / email attachment. */
export function buildCityNotificationSummary(
  event: Pick<CityNotificationEvent, 'mission_id' | 'payload' | 'created_at'>
): string {
  const p = event.payload || {};
  const lines = [
    'CleanEgypt.co — Municipal Crowdfunding Report',
    '============================================',
    `Mission ID: ${event.mission_id}`,
    `Event logged: ${event.created_at}`,
    `Service: ${p.service_type ?? 'n/a'}`,
    `Location: ${p.location_lat ?? '?'}, ${p.location_lng ?? '?'}`,
    `Target budget (USD): ${p.target_budget ?? 0}`,
    `Raised (USD): ${p.raised ?? 0}`,
    `Expired at: ${p.expired_at ?? 'n/a'}`,
    '',
    'Description:',
    p.description?.trim() || '(none)',
    '',
    'Status: Crowdfunding target was not reached within the campaign window.',
    'Action requested: review for municipal cleanup / public works follow-up.',
  ];
  return lines.join('\n');
}

/**
 * Placeholder PDF generation. Logs the summary and returns a stub "blob" marker.
 * Replace with real PDF bytes + upload to storage, then update pdf_status.
 */
export async function generateCityNotificationPdfPlaceholder(
  event: CityNotificationEvent
): Promise<{ ok: true; summary: string; pdfStatus: 'pending' }> {
  const summary = buildCityNotificationSummary(event);
  console.info('[city-notification] PDF placeholder ready', {
    eventId: event.id,
    missionId: event.mission_id,
    summaryLength: summary.length,
  });
  // Future: return { ok: true, pdfBytes, storagePath } and set pdf_status = 'generated'.
  return { ok: true, summary, pdfStatus: 'pending' };
}
