import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { logout as apiLogout } from '@/api/client';
import { refreshAccessToken } from '@/api/http';
import { stopPush } from '@/lib/pushClient';
import {
  getSessionSnapshot,
  isAccessTokenExpiringSoon,
  publishSession,
  readAccessTokenExpiry,
  setForceLogoutHandler,
  subscribeSession
} from '@/lib/sessionBridge';
import type { AuthPayload } from '@/types/api';

type AuthContextValue = {
  session: AuthPayload | null;
  bootstrapping: boolean;
  authNotice: string;
  clearAuthNotice: () => void;
  setSession: (value: AuthPayload | null) => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<AuthPayload | null>(() => getSessionSnapshot());
  const [bootstrapping, setBootstrapping] = useState(true);
  const [authNotice, setAuthNotice] = useState('');
  const refreshTimer = useRef<number | null>(null);

  const setSession = useCallback((value: AuthPayload | null) => {
    if (!value) {
      void stopPush().finally(() => publishSession(null));
      return;
    }
    publishSession(value);
  }, []);

  const clearAuthNotice = useCallback(() => setAuthNotice(''), []);

  const logout = useCallback(async () => {
    await stopPush();
    const active = getSessionSnapshot();
    try {
      if (active) {
        await apiLogout({
          accessToken: active.accessToken,
          refreshToken: active.refreshToken
        });
      }
    } catch {
      /* clear local anyway */
    }
    publishSession(null);
  }, []);

  useEffect(() => {
    return subscribeSession((next) => setSessionState(next));
  }, []);

  useEffect(() => {
    setForceLogoutHandler((reason) => {
      if (reason === 'session_expired') {
        setAuthNotice('sessionExpired');
      }
    });
    return () => setForceLogoutHandler(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const current = getSessionSnapshot();
      if (!current?.refreshToken) {
        if (!cancelled) setBootstrapping(false);
        return;
      }
      if (isAccessTokenExpiringSoon(current.accessToken, 120)) {
        try {
          await refreshAccessToken();
        } catch {
          if (!cancelled) setAuthNotice('sessionExpired');
        }
      }
      if (!cancelled) setBootstrapping(false);
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (refreshTimer.current) {
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
    if (!session?.accessToken) return;

    const exp = readAccessTokenExpiry(session.accessToken);
    if (!exp) return;

    const msUntilRefresh = exp * 1000 - Date.now() - 60_000;
    const delay = Math.max(5_000, msUntilRefresh);

    refreshTimer.current = window.setTimeout(() => {
      void refreshAccessToken().catch(() => {
        setAuthNotice('sessionExpired');
      });
    }, delay);

    return () => {
      if (refreshTimer.current) {
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, [session?.accessToken]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      bootstrapping,
      authNotice,
      clearAuthNotice,
      setSession,
      logout
    }),
    [session, bootstrapping, authNotice, clearAuthNotice, setSession, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth requires AuthProvider');
  return ctx;
}
