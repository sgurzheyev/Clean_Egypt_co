/**
 * Phase 5 — register push tokens after login.
 * Soft-fails when Firebase/VAPID env is not configured yet.
 */
import { useEffect, useRef, useState } from 'react';
import {
  registerPushNotifications,
  type PushRegistrationResult,
} from '../services/pushNotifications';

export function usePushNotifications(userId: string | null | undefined) {
  const [result, setResult] = useState<PushRegistrationResult | null>(null);
  const registeredForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) {
      registeredForRef.current = null;
      setResult(null);
      return;
    }
    if (registeredForRef.current === userId) return;
    registeredForRef.current = userId;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const res = await registerPushNotifications();
        if (!cancelled) {
          setResult(res);
          if (res.ok) {
            console.info('[push] device token registered', res.platform);
          } else if (res.reason && res.reason !== 'permission_denied') {
            console.info('[push] registration skipped:', res.reason);
          }
        }
      })();
    }, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [userId]);

  return { result };
}

export default usePushNotifications;
