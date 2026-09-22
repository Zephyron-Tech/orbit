import { useEffect, useState } from 'react';

import { getExpoPushToken, isPushAvailable, requestPushPermission, type PushPermissionStatus } from '../lib/push-notifications';

export type PushTokenStatus = 'idle' | 'requesting' | PushPermissionStatus | 'unavailable';

/**
 * Requests notification permission and resolves the Expo push token once
 * `enabled` is true (e.g. once the user is actually authenticated — running
 * this on every mount regardless would prompt for permission before the
 * user has even signed in).
 */
export function usePushToken(enabled: boolean): { token: string | null; status: PushTokenStatus } {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<PushTokenStatus>('idle');

  useEffect(() => {
    if (!enabled) return;

    if (!isPushAvailable()) {
      setStatus('unavailable');
      return;
    }

    let cancelled = false;
    setStatus('requesting');

    void (async () => {
      const permission = await requestPushPermission();
      if (cancelled) return;
      setStatus(permission);

      if (permission !== 'granted') return;
      const resolved = await getExpoPushToken();
      if (!cancelled) setToken(resolved);
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { token, status };
}
