import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { logout as apiLogout } from '@/api/client';
import { refreshAccessToken } from '@/api/http';
import { stopPush } from '@/lib/pushClient';
import { getSessionSnapshot, isAccessTokenExpiringSoon, publishSession, readAccessTokenExpiry, setForceLogoutHandler, subscribeSession } from '@/lib/sessionBridge';
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
    const [session, setSessionState] = useState(() => getSessionSnapshot());
    const [bootstrapping, setBootstrapping] = useState(true);
    const [authNotice, setAuthNotice] = useState('');
    const refreshTimer = useRef(null);
    const setSession = useCallback((value) => {
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
        }
        catch {
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
                if (!cancelled)
                    setBootstrapping(false);
                return;
            }
            if (isAccessTokenExpiringSoon(current.accessToken, 120)) {
                try {
                    await refreshAccessToken();
                }
                catch {
                    if (!cancelled)
                        setAuthNotice('sessionExpired');
                }
            }
            if (!cancelled)
                setBootstrapping(false);
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
        if (!session?.accessToken)
            return;
        const exp = readAccessTokenExpiry(session.accessToken);
        if (!exp)
            return;
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
    const value = useMemo(() => ({
        session,
        bootstrapping,
        authNotice,
        clearAuthNotice,
        setSession,
        logout
    }), [session, bootstrapping, authNotice, clearAuthNotice, setSession, logout]);
    return _jsx(AuthContext.Provider, { value: value, children: children });
}
export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx)
        throw new Error('useAuth requires AuthProvider');
    return ctx;
}
