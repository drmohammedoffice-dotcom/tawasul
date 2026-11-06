import { io } from 'socket.io-client';
import { resolveWsUrl } from '@/api/http';
import { getSessionSnapshot, subscribeSession } from '@/lib/sessionBridge';
let shared = null;
let sharedToken = null;
let unsub = null;
function ensureSessionSubscription() {
    if (unsub)
        return;
    unsub = subscribeSession((session) => {
        const token = session?.accessToken ?? null;
        if (!token) {
            teardownRealtime();
            return;
        }
        if (shared && sharedToken !== token) {
            teardownRealtime();
            getRealtimeSocket();
        }
    });
}
/** Single shared Socket.IO connection for social realtime (groups/channels). */
export function getRealtimeSocket() {
    ensureSessionSubscription();
    const session = getSessionSnapshot();
    const token = session?.accessToken;
    if (!token) {
        teardownRealtime();
        return null;
    }
    if (shared && sharedToken === token && shared.connected) {
        return shared;
    }
    if (shared && sharedToken !== token) {
        teardownRealtime();
    }
    if (shared && sharedToken === token) {
        return shared;
    }
    sharedToken = token;
    shared = io(resolveWsUrl(), {
        transports: ['websocket'],
        auth: { token },
        autoConnect: true,
        reconnection: true,
        reconnectionDelay: 800,
        reconnectionAttempts: 20
    });
    return shared;
}
export function teardownRealtime() {
    if (shared) {
        shared.removeAllListeners();
        shared.disconnect();
        shared = null;
        sharedToken = null;
    }
}
export function clientRequestId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
