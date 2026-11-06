const STORAGE_KEY = 'secure-messaging.session';
export function loadSession() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export function saveSession(session) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}
export function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
}
export function getOrCreateDeviceId() {
    const key = 'secure-messaging.device-id';
    const existing = localStorage.getItem(key);
    if (existing)
        return existing;
    const generated = `web-${crypto.randomUUID()}`;
    localStorage.setItem(key, generated);
    return generated;
}
