import { trackBetaEvent } from '@/api/client';
const SESSION_KEY = 'beta-session-id';
export function getAnalyticsSessionId() {
    const existing = window.localStorage.getItem(SESSION_KEY);
    if (existing)
        return existing;
    const created = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(SESSION_KEY, created);
    return created;
}
export function trackEvent(eventName, metadata) {
    const payload = {
        eventName,
        path: window.location.pathname,
        sessionId: getAnalyticsSessionId(),
        ...(metadata ? { metadata } : {})
    };
    void trackBetaEvent(payload).catch(() => {
        // Fail silently to avoid impacting user flow.
    });
}
