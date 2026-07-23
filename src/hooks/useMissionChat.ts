/**
 * Phase 4 — mission-scoped P2P chat (history + Realtime INSERT).
 * Pair with migration: supabase/migrations/20260723_p2p_chat_system.sql
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../services/supabase';

export type MissionChatMessage = {
  id: string;
  mission_id: string;
  sender_id: string;
  receiver_id: string;
  message: string;
  created_at: string;
  is_read: boolean;
};

const PAGE_SIZE = 100;

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
        .select('id, mission_id, sender_id, receiver_id, message, created_at, is_read')
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
    async (text: string) => {
      const body = String(text ?? '').trim();
      if (!body || !missionId || !otherUserId) return null;
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

        const { data, error: insErr } = await supabase
          .from('mission_chats')
          .insert({
            mission_id: missionId,
            sender_id: uid,
            receiver_id: otherUserId,
            message: body,
          })
          .select('id, mission_id, sender_id, receiver_id, message, created_at, is_read')
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
