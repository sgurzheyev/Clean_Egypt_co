/**
 * Notification bell for the map header: unread badge + dropdown feed.
 * Clicking a notification marks it read and navigates to the mission (and chat when relevant).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeToNotifications,
  type NotificationRow,
  type OpenNotificationOptions,
} from '../src/lib/notifications';
import { formatSubmittedRelative } from '../src/lib/missionFilterSort';

interface NotificationBellProps {
  userId: string | null;
  onOpenMission?: (missionId: string, opts?: OpenNotificationOptions) => void;
}

const TYPE_LABEL_KEYS: Record<string, string> = {
  proof_uploaded: 'notifProofUploaded',
  proof_rejected: 'notifProofRejected',
  mission_approved: 'notifMissionApproved',
  new_review: 'notifNewReview',
  chat_message: 'notifChatMessage',
  bid_new: 'notifBidNew',
  bid_accepted: 'notifBidAccepted',
  funding_bumped: 'notifFundingBumped',
  funding_complete: 'notifFundingComplete',
};

const TYPE_ICON: Record<string, string> = {
  proof_uploaded: '📸',
  proof_rejected: '↩️',
  mission_approved: '✅',
  new_review: '⭐',
  chat_message: '💬',
  bid_new: '🙋',
  bid_accepted: '✅',
  funding_bumped: '📈',
  funding_complete: '🎯',
};

function notificationBody(
  n: NotificationRow,
  fallback: string
): string {
  if (n.message?.trim()) return n.message.trim();
  if (n.title?.trim()) return n.title.trim();
  return fallback;
}

const NotificationBell: React.FC<NotificationBellProps> = ({ userId, onOpenMission }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const unread = items.reduce((n, x) => (x.is_read ? n : n + 1), 0);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setItems(await fetchNotifications(userId, 40));
    } catch (err) {
      console.warn('fetchNotifications failed:', err);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setItems([]);
      setOpen(false);
      return;
    }
    void load();
    const unsub = subscribeToNotifications(userId, (row) => {
      setItems((prev) => (prev.some((p) => p.id === row.id) ? prev : [row, ...prev]));
    });
    return unsub;
  }, [userId, load]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const handleToggle = () => {
    if (!userId) return;
    setOpen((v) => !v);
    if (!open) void load();
  };

  const handleClickItem = async (n: NotificationRow) => {
    if (!n.is_read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      try {
        await markNotificationRead(n.id);
      } catch (err) {
        console.warn('markNotificationRead failed:', err);
      }
    }
    setOpen(false);
    if (n.mission_id && onOpenMission) {
      const openChat =
        n.type === 'chat_message' || n.type === 'CHAT' ? n.actor_id : null;
      onOpenMission(n.mission_id, { openChatWith: openChat });
    } else if (n.actor_id) {
      navigate(`/profile/${n.actor_id}`);
    }
  };

  const handleMarkAll = async () => {
    if (!userId) return;
    setItems((prev) => prev.map((x) => ({ ...x, is_read: true })));
    try {
      await markAllNotificationsRead(userId);
    } catch (err) {
      console.warn('markAllNotificationsRead failed:', err);
    }
  };

  if (!userId) return null;

  return (
    <div
      ref={panelRef}
      className="fixed right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[10025] flex flex-col items-end"
    >
      <button
        type="button"
        onClick={handleToggle}
        className={`relative glass-button flex h-11 w-11 items-center justify-center rounded-full border text-cyan-200 ${
          unread > 0
            ? 'border-cyan-300/80 shadow-[0_0_22px_rgba(34,211,238,0.55)] animate-pulse'
            : 'border-cyan-400/50'
        }`}
        aria-label={t('notifications')}
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" strokeWidth={2.25} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border border-red-300/60 bg-red-500 px-1 text-[10px] font-black text-white shadow-[0_0_12px_rgba(239,68,68,0.75)]">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="mt-2 flex w-[min(88vw,22rem)] flex-col overflow-hidden glass-panel"
          style={{
            maxHeight:
              'calc(100svh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 5.5rem)',
          }}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-300">
              {t('notifications')}
              {unread > 0 ? (
                <span className="ml-2 rounded-full bg-red-500/90 px-1.5 py-0.5 text-[9px] text-white">
                  {unread}
                </span>
              ) : null}
            </p>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void handleMarkAll()}
                className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 hover:text-slate-200"
              >
                <CheckCheck className="h-3.5 w-3.5" strokeWidth={2.5} />
                {t('notifMarkAllRead')}
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch] pb-[env(safe-area-inset-bottom,0px)]">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-500">{t('notifEmpty')}</p>
            ) : (
              items.map((n) => {
                const headline = n.title?.trim() || null;
                const labelKey = TYPE_LABEL_KEYS[n.type] || 'notifGeneric';
                const body = notificationBody(
                  n,
                  t(labelKey, { defaultValue: 'New notification' })
                );
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => void handleClickItem(n)}
                    className={`flex w-full items-start gap-3 border-b border-white/5 px-4 py-3 text-left transition-colors hover:bg-white/5 ${
                      n.is_read ? 'opacity-70' : 'bg-cyan-500/5'
                    }`}
                  >
                    <span className="mt-0.5 text-lg" aria-hidden>
                      {TYPE_ICON[n.type] || '🔔'}
                    </span>
                    <span className="min-w-0 flex-1">
                      {headline && (
                        <span className="mb-0.5 block text-[10px] font-black uppercase tracking-[0.12em] text-cyan-300/90">
                          {headline}
                        </span>
                      )}
                      <span className="block text-xs font-semibold leading-snug text-slate-100">
                        {body}
                      </span>
                      <span className="mt-0.5 block text-[10px] uppercase tracking-[0.1em] text-slate-500">
                        {formatSubmittedRelative(n.created_at, i18n.language)}
                      </span>
                    </span>
                    {!n.is_read && (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" aria-hidden />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
