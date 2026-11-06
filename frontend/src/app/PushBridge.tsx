import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { startPush, subscribePushOpens, syncPushPrefs } from '@/lib/pushClient';

/** Keeps the device token and opens the right screen when a push is tapped. */
export function PushBridge() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const userId = session?.user?.id;

  useEffect(() => {
    return subscribePushOpens((open) => {
      navigate(open.route);
    });
  }, [navigate]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      await syncPushPrefs(userId);
      if (!cancelled) await startPush(userId);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return null;
}
