import { clearSession, loadSession, saveSession } from '@/lib/session';
let current = loadSession();
const listeners = new Set();
let forceLogoutHandler = null;
export function getSessionSnapshot() {
    return current;
}
export function subscribeSession(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
export function setForceLogoutHandler(handler) {
    forceLogoutHandler = handler;
}
export function publishSession(session) {
    current = session;
    if (session)
        saveSession(session);
    else
        clearSession();
    listeners.forEach((listener) => listener(session));
}
export function forceLogout(reason = 'session_expired') {
    publishSession(null);
    forceLogoutHandler?.(reason);
}
/** Decode JWT exp without verifying signature (client scheduling only). */
export function readAccessTokenExpiry(accessToken) {
    try {
        const part = accessToken.split('.')[1];
        if (!part)
            return null;
        const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
        const payload = JSON.parse(json);
        return typeof payload.exp === 'number' ? payload.exp : null;
    }
    catch {
        return null;
    }
}
export function isAccessTokenExpiringSoon(accessToken, skewSeconds = 60) {
    const exp = readAccessTokenExpiry(accessToken);
    if (!exp)
        return false;
    return exp * 1000 <= Date.now() + skewSeconds * 1000;
}
