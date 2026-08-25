/**
 * Offline / weak-network upload queue for contractor store media + chat photos.
 * Failed uploads are stored in IndexedDB and retried when the network returns.
 */
import { uploadStorePhoto, uploadSupplyPhoto } from './contractorStore';
import { uploadChatPhoto } from './chatPhotoUpload';
import { supabase } from '../../services/supabase';

export type OfflineUploadKind = 'store_photo' | 'supply_photo' | 'chat_photo';

export type OfflineUploadItem = {
  id: string;
  userId: string;
  kind: OfflineUploadKind;
  blob: Blob;
  fileName: string;
  createdAt: number;
  /** chat_photo: mission thread id */
  missionId?: string;
  /** chat_photo: message receiver (creator or bidder) */
  receiverId?: string;
  /** chat_photo: optional caption queued with the photo */
  messageText?: string;
};

const DB_NAME = 'garbagin-offline-uploads';
const DB_VERSION = 1;
const STORE = 'queue';

export const OFFLINE_UPLOAD_FLUSHED_EVENT = 'garbagin:offline-upload-flushed';
export const WEAK_CONNECTION_TOAST_EVENT = 'garbagin:weak-connection-toast';

export type OfflineUploadFlushedDetail = {
  userId: string;
  kind: OfflineUploadKind;
  url: string;
  queueId: string;
  missionId?: string;
  receiverId?: string;
  messageId?: string;
};

export function isLikelyNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = String(
    (err as { message?: string } | null)?.message ?? err ?? ''
  ).toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('network error') ||
    msg.includes('load failed') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('offline') ||
    msg.includes('net::') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('fetch error') ||
    msg.includes('abort')
  );
}

/** Narrower helper used by store panel / chat — treat TypeError from fetch as network. */
export function isUploadNetworkFailure(err: unknown): boolean {
  if (isLikelyNetworkError(err)) return true;
  if (err instanceof TypeError) return true;
  const status = Number(
    (err as { status?: number; statusCode?: number })?.status ??
      (err as { statusCode?: number })?.statusCode
  );
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export async function enqueueOfflineUpload(params: {
  userId: string;
  kind: OfflineUploadKind;
  file: Blob;
  fileName?: string;
  missionId?: string;
  receiverId?: string;
  messageText?: string;
}): Promise<string> {
  if (params.kind === 'chat_photo') {
    if (!params.missionId || !params.receiverId) {
      throw new Error('chat_photo queue requires missionId and receiverId');
    }
  }

  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `q_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const item: OfflineUploadItem = {
    id,
    userId: params.userId,
    kind: params.kind,
    blob: params.file,
    fileName: params.fileName || `offline_${Date.now()}.jpg`,
    createdAt: Date.now(),
    ...(params.kind === 'chat_photo'
      ? {
          missionId: params.missionId,
          receiverId: params.receiverId,
          messageText: String(params.messageText || '').trim().slice(0, 4000),
        }
      : {}),
  };
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await idbReq(tx.objectStore(STORE).put(item));
  } finally {
    db.close();
  }
  return id;
}

export async function listOfflineUploads(userId?: string): Promise<OfflineUploadItem[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const all = (await idbReq(tx.objectStore(STORE).getAll())) as OfflineUploadItem[];
    return userId ? all.filter((i) => i.userId === userId) : all;
  } finally {
    db.close();
  }
}

async function removeQueued(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await idbReq(tx.objectStore(STORE).delete(id));
  } finally {
    db.close();
  }
}

async function flushChatPhotoItem(item: OfflineUploadItem): Promise<{
  url: string;
  messageId?: string;
}> {
  const missionId = String(item.missionId || '').trim();
  const receiverId = String(item.receiverId || '').trim();
  if (!missionId || !receiverId) {
    throw new Error('Queued chat photo missing missionId/receiverId');
  }

  const file = new File([item.blob], item.fileName, {
    type: item.blob.type || 'image/jpeg',
  });
  const objectKey = await uploadChatPhoto({
    file,
    missionId,
    userId: item.userId,
  });

  const body = String(item.messageText || '').trim().slice(0, 4000);
  const payload: Record<string, unknown> = {
    mission_id: missionId,
    sender_id: item.userId,
    receiver_id: receiverId,
    message: body,
    image_url: objectKey,
  };

  const { data, error } = await supabase
    .from('mission_chats')
    .insert(payload)
    .select('id')
    .single();
  if (error) throw error;

  return {
    url: objectKey,
    messageId: data?.id ? String(data.id) : undefined,
  };
}

let flushing = false;

/** Retry queued uploads; emits OFFLINE_UPLOAD_FLUSHED_EVENT per success. */
export async function flushOfflineUploadQueue(userId?: string): Promise<number> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;
  if (flushing) return 0;
  flushing = true;
  let ok = 0;
  try {
    const items = await listOfflineUploads(userId);
    for (const item of items) {
      try {
        let url = '';
        let messageId: string | undefined;

        if (item.kind === 'chat_photo') {
          const result = await flushChatPhotoItem(item);
          url = result.url;
          messageId = result.messageId;
        } else {
          const file = new File([item.blob], item.fileName, {
            type: item.blob.type || 'image/jpeg',
          });
          url =
            item.kind === 'supply_photo'
              ? await uploadSupplyPhoto(item.userId, file)
              : await uploadStorePhoto(item.userId, file);
        }

        await removeQueued(item.id);
        ok += 1;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent<OfflineUploadFlushedDetail>(OFFLINE_UPLOAD_FLUSHED_EVENT, {
              detail: {
                userId: item.userId,
                kind: item.kind,
                url,
                queueId: item.id,
                missionId: item.missionId,
                receiverId: item.receiverId,
                messageId,
              },
            })
          );
        }
      } catch (err) {
        console.warn('[offlineUploadQueue] flush item failed', item.id, err);
        // Stop on first failure to avoid hammering a still-weak link.
        if (isUploadNetworkFailure(err)) break;
        // Permanent failure — drop the item so the queue is not stuck forever.
        await removeQueued(item.id);
      }
    }
  } finally {
    flushing = false;
  }
  return ok;
}

let listenersBound = false;

/** Bind once: flush queue when the browser comes back online. */
export function ensureOfflineUploadListeners(): void {
  if (typeof window === 'undefined' || listenersBound) return;
  listenersBound = true;
  window.addEventListener('online', () => {
    void flushOfflineUploadQueue();
  });
  // Opportunistic flush on focus / visibility.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushOfflineUploadQueue();
  });
}

export function notifyWeakConnectionToast(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(WEAK_CONNECTION_TOAST_EVENT));
}
