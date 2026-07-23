/**
 * In-app notifications: fetch, mark-read, realtime subscription, and
 * participant-gated mission event dispatch (server routes to the counterparty).
 */
import { supabase } from '../../services/supabase';

export type NotificationType =
  | 'proof_uploaded'
  | 'proof_rejected'
  | 'mission_approved'
  | 'new_review'
  | 'chat_message'
  | 'bid_new'
  | 'bid_accepted'
  | 'funding_bumped'
  | 'funding_complete'
  | string;

export interface NotificationRow {
  id: string;
  user_id: string;
  actor_id: string | null;
  mission_id: string | null;
  type: NotificationType;
  title: string | null;
  message: string | null;
  is_read: boolean;
  created_at: string;
}

export type OpenNotificationOptions = {
  /** For chat_message: open P2P chat with this peer after briefing loads. */
  openChatWith?: string | null;
};

export async function fetchNotifications(
  userId: string,
  limit = 30
): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, user_id, actor_id, mission_id, type, title, message, is_read, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as NotificationRow[];
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id);
  if (error) throw error;
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false);
  if (error) throw error;
}

/**
 * Dispatch a mission notification to the counterparty. Server validates the
 * caller is a participant and routes by type. Best-effort: never throws.
 */
export async function notifyMissionEvent(
  missionId: string,
  type: NotificationType
): Promise<void> {
  try {
    const { error } = await supabase.rpc('notify_mission_event', {
      p_mission_id: missionId,
      p_type: type,
    });
    if (error) console.warn('notify_mission_event failed:', error.message);
  } catch (err) {
    console.warn('notify_mission_event threw:', err);
  }
}

/** Subscribe to new notification rows for a user. Returns an unsubscribe fn. */
export function subscribeToNotifications(
  userId: string,
  onInsert: (row: NotificationRow) => void
): () => void {
  const channel = supabase
    .channel(`notifications-${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload: { new: NotificationRow }) => {
        if (payload?.new) onInsert(payload.new);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
