/**
 * Phase 4 — mission-scoped P2P chat (history + Realtime INSERT).
 * Pair with migrations:
 *   supabase/migrations/20260723_p2p_chat_system.sql
 *   supabase/migrations/20260727_mission_chat_photos.sql
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../services/supabase';

export type MissionChatMessage = {
  id: string;
  mission_id: string;
  sender_id: string;
  receiver_id: string;
  message: string;
  image_url?: string | null;
  created_at: string;
  is_read: boolean;
};

const PAGE_SIZE = 100;

const CHAT_SELECT =
  'id, mission_id, sender_id, receiver_id, message, image_url, created_at, is_read';

function isPairMessage(
  row: MissionChatMessage,
  userId: string,
  otherUserId: string
): boolean {
  return (
    (row.sender_id === userId && row.receiver_id === otherUserId) ||
    (row.sender_id === otherUserId && row.receiver_id === userId)
  );
}

export function useMissionChat(
  missionId: string | null | undefined,
  otherUserId: string | null | undefined
) {
  const [messages, setMessages] = useState<MissionChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const appendMessage = useCallback((row: MissionChatMessage) => {
    if (!row?.id || seenIdsRef.current.has(row.id)) return;
    seenIdsRef.current.add(row.id);
    setMessages((prev) => {
      if (prev.some((m) => m.id === row.id)) return prev;
      return [...prev, row].sort(
        (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
      );
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!missionId || !otherUserId) {
      setMessages([]);
      seenIdsRef.current = new Set();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      setCurrentUserId(uid);
      if (!uid) {
        setMessages([]);
        return;
      }

      const { data, error: qErr } = await supabase
        .from('mission_chats')
        .select(CHAT_SELECT)
        .eq('mission_id', missionId)
        .or(
          `and(sender_id.eq.${uid},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${uid})`
        )
        .order('created_at', { ascending: true })
        .limit(PAGE_SIZE);

      if (qErr) throw qErr;
      const rows = (data || []) as MissionChatMessage[];
      seenIdsRef.current = new Set(rows.map((r) => r.id));
      setMessages(rows);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('useMissionChat refresh', msg);
      setError(msg || 'Failed to load chat');
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [missionId, otherUserId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Realtime: new rows on this mission thread
  useEffect(() => {
    if (!missionId || !otherUserId) return;

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid || cancelled) return;
      setCurrentUserId(uid);

      channel = supabase
        .channel(`mission-chat-${missionId}-${uid}-${otherUserId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'mission_chats',
            filter: `mission_id=eq.${missionId}`,
          },
          (payload: { new: MissionChatMessage }) => {
            const row = payload?.new;
            if (!row?.id) return;
            if (!isPairMessage(row, uid, otherUserId)) return;
            appendMessage(row);
          }
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [appendMessage, missionId, otherUserId]);

  const sendMessage = useCallback(
    async (text: string, imageUrl?: string | null) => {
      const body = String(text ?? '').trim();
      const img = String(imageUrl ?? '').trim() || null;
      if ((!body && !img) || !missionId || !otherUserId) return null;
      if (body.length > 4000) {
        setError('Message too long (max 4000 characters)');
        return null;
      }

      setSending(true);
      setError(null);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) throw new Error('Not authenticated');

        const payload: Record<string, unknown> = {
          mission_id: missionId,
          sender_id: uid,
          receiver_id: otherUserId,
          message: body,
        };
        if (img) payload.image_url = img;

        const { data, error: insErr } = await supabase
          .from('mission_chats')
          .insert(payload)
          .select(CHAT_SELECT)
          .single();

        if (insErr) throw insErr;
        const row = data as MissionChatMessage;
        appendMessage(row);
        return row;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('useMissionChat sendMessage', msg);
        setError(msg || 'Failed to send message');
        return null;
      } finally {
        setSending(false);
      }
    },
    [appendMessage, missionId, otherUserId]
  );

  const markThreadRead = useCallback(async () => {
    if (!missionId || !otherUserId || !currentUserId) return;
    try {
      const { error: upErr } = await supabase
        .from('mission_chats')
        .update({ is_read: true })
        .eq('mission_id', missionId)
        .eq('receiver_id', currentUserId)
        .eq('sender_id', otherUserId)
        .eq('is_read', false);
      if (upErr) throw upErr;
      setMessages((prev) =>
        prev.map((m) =>
          m.receiver_id === currentUserId && m.sender_id === otherUserId
            ? { ...m, is_read: true }
            : m
        )
      );
    } catch (e) {
      console.warn('useMissionChat markThreadRead', e);
    }
  }, [currentUserId, missionId, otherUserId]);

  return {
    messages,
    loading,
    sending,
    error,
    currentUserId,
    refresh,
    sendMessage,
    markThreadRead,
  };
}
