import { env } from '@/config/env';
import { ApiError, SessionExpiredError, parseApiErrorMessage } from '@/lib/apiError';
import { forceLogout, getSessionSnapshot, isAccessTokenExpiringSoon, publishSession } from '@/lib/sessionBridge';
function isLoopbackHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}
function isPrivateLanHost(hostname) {
    return (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname));
}
function isCapacitorNative() {
    if (typeof window === 'undefined')
        return false;
    const cap = window.Capacitor;
    return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform();
}
/**
 * Rewrite loopback API/WS hosts so phones and Capacitor WebViews can reach the backend.
 * - Capacitor: VITE_NATIVE_API_HOST, else Android emulator gateway 10.0.2.2
 * - Mobile browser on LAN (Vite at 192.168.x.x): use the page host
 * - Desktop loopback: align localhost ↔ 127.0.0.1 with the page
 */
function resolveServiceUrl(configured) {
    const base = configured.replace(/\/$/, '');
    if (typeof window === 'undefined')
        return base;
    try {
        const url = new URL(base);
        if (!isLoopbackHost(url.hostname)) {
            return url.toString().replace(/\/$/, '');
        }
        const pageHost = window.location.hostname;
        const nativeHost = env.nativeApiHost;
        if (isCapacitorNative()) {
            url.hostname = nativeHost || '10.0.2.2';
            return url.toString().replace(/\/$/, '');
        }
        if (nativeHost && isLoopbackHost(pageHost) && window.location.protocol === 'https:') {
            // Capacitor-style https://localhost without Capacitor bridge (rare preview)
            url.hostname = nativeHost;
            return url.toString().replace(/\/$/, '');
        }
        if (isPrivateLanHost(pageHost)) {
            url.hostname = pageHost;
            return url.toString().replace(/\/$/, '');
        }
        if (isLoopbackHost(pageHost)) {
            url.hostname = pageHost;
        }
        return url.toString().replace(/\/$/, '');
    }
    catch {
        return base;
    }
}
export function resolveApiBaseUrl() {
    return resolveServiceUrl(env.apiBaseUrl);
}
export function resolveWsUrl() {
    return resolveServiceUrl(env.wsUrl);
}
let refreshInFlight = null;
async function postRefresh(refreshToken) {
    const response = await fetch(`${resolveApiBaseUrl()}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
    });
    if (!response.ok) {
        const text = await response.text();
        throw new ApiError(parseApiErrorMessage(response.status, text), response.status);
    }
    const envelope = (await response.json());
    return envelope.data;
}
/** Single-flight refresh — concurrent 401s share one refresh call. */
export async function refreshAccessToken() {
    if (refreshInFlight)
        return refreshInFlight;
    refreshInFlight = (async () => {
        const snapshot = getSessionSnapshot();
        const refreshToken = snapshot?.refreshToken;
        if (!refreshToken) {
            forceLogout('session_expired');
            throw new SessionExpiredError();
        }
        try {
            const payload = await postRefresh(refreshToken);
            const previous = getSessionSnapshot();
            const merged = {
                ...payload,
                user: payload.user ?? previous?.user
            };
            if (!merged.user) {
                forceLogout('session_expired');
                throw new SessionExpiredError();
            }
            publishSession(merged);
            return merged;
        }
        catch (err) {
            forceLogout('session_expired');
            if (err instanceof SessionExpiredError)
                throw err;
            throw new SessionExpiredError();
        }
        finally {
            refreshInFlight = null;
        }
    })();
    return refreshInFlight;
}
export async function ensureFreshAccessToken() {
    const session = getSessionSnapshot();
    if (!session?.accessToken) {
        throw new SessionExpiredError();
    }
    if (isAccessTokenExpiringSoon(session.accessToken)) {
        const next = await refreshAccessToken();
        return next.accessToken;
    }
    return session.accessToken;
}
export async function apiRequest(path, init = {}) {
    const { public: isPublic, skipAuthRetry, headers: initHeaders, ...rest } = init;
    const url = `${resolveApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
    const buildHeaders = (token) => {
        const headers = {
            'Content-Type': 'application/json',
            ...initHeaders
        };
        if (!isPublic && token) {
            headers.Authorization = `Bearer ${token}`;
        }
        return headers;
    };
    let token;
    if (!isPublic) {
        token = await ensureFreshAccessToken();
    }
    let response = await fetch(url, {
        ...rest,
        headers: buildHeaders(token)
    });
    if (response.status === 401 && !isPublic && !skipAuthRetry) {
        try {
            const refreshed = await refreshAccessToken();
            response = await fetch(url, {
                ...rest,
                headers: buildHeaders(refreshed.accessToken)
            });
        }
        catch {
            throw new SessionExpiredError();
        }
    }
    if (!response.ok) {
        const text = await response.text();
        if (response.status === 401 && !isPublic) {
            throw new SessionExpiredError(parseApiErrorMessage(401, text));
        }
        throw new ApiError(parseApiErrorMessage(response.status, text), response.status);
    }
    if (response.status === 204) {
        return undefined;
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        return undefined;
    }
    return (await response.json());
}
export async function apiData(path, init) {
    const envelope = await apiRequest(path, init);
    return envelope.data;
}
