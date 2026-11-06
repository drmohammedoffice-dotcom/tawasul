/** Focus Mode preferences — persisted locally, applied for real (not decorative). */
const NOTIF_KEY = 'securechat.focus.notif';
const STORAGE_KEY = 'securechat.focus.storage';
const APPEAR_KEY = 'securechat.focus.appearance';
export const DEFAULT_NOTIF = {
    privateChats: true,
    groups: true,
    channels: true,
    stories: true,
    reactions: true,
    inAppSounds: true,
    inAppVibrate: false,
    inAppPreview: true,
    namesOnLockScreen: true,
    includeChannelsInBadge: true,
    unreadMessageCount: true,
    newContacts: true
};
export const DEFAULT_STORAGE = {
    autoDownloadCellular: false,
    autoDownloadWifi: true,
    saveGalleryPrivate: false,
    saveGalleryGroups: false,
    saveGalleryChannels: false,
    lessDataForCalls: false,
    dataBytesIn: 0,
    dataBytesOut: 0
};
export const DEFAULT_APPEARANCE = {
    chatTheme: 'classic',
    nightMode: true,
    nightModeAuto: 'system',
    fontSize: 'system',
    bubbleRadius: 'md',
    motionEffects: true,
    stickersEnabled: true,
    accentColor: '#2aabee',
    chatBackground: 'doodle-dark'
};
function scoped(base, userId) {
    return `${base}.${userId || 'anon'}`;
}
function readJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw)
            return { ...fallback };
        const parsed = JSON.parse(raw);
        return { ...fallback, ...parsed };
    }
    catch {
        return { ...fallback };
    }
}
function writeJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    }
    catch {
        /* ignore quota */
    }
}
export function loadNotifPrefs(userId) {
    return readJson(scoped(NOTIF_KEY, userId), DEFAULT_NOTIF);
}
export function saveNotifPrefs(userId, prefs) {
    writeJson(scoped(NOTIF_KEY, userId), prefs);
}
export function loadStoragePrefs(userId) {
    return readJson(scoped(STORAGE_KEY, userId), DEFAULT_STORAGE);
}
export function saveStoragePrefs(userId, prefs) {
    writeJson(scoped(STORAGE_KEY, userId), prefs);
}
export function loadAppearancePrefs(userId) {
    return readJson(scoped(APPEAR_KEY, userId), DEFAULT_APPEARANCE);
}
export function saveAppearancePrefs(userId, prefs) {
    writeJson(scoped(APPEAR_KEY, userId), prefs);
}
export function resetNotifPrefs(userId) {
    const next = { ...DEFAULT_NOTIF };
    saveNotifPrefs(userId, next);
    return next;
}
export function resetAutoDownload(userId) {
    const cur = loadStoragePrefs(userId);
    const next = {
        ...cur,
        autoDownloadCellular: DEFAULT_STORAGE.autoDownloadCellular,
        autoDownloadWifi: DEFAULT_STORAGE.autoDownloadWifi
    };
    saveStoragePrefs(userId, next);
    return next;
}
export function recordDataUsage(userId, direction, bytes) {
    if (!bytes || bytes < 0)
        return;
    const cur = loadStoragePrefs(userId);
    const next = {
        ...cur,
        dataBytesIn: cur.dataBytesIn + (direction === 'in' ? bytes : 0),
        dataBytesOut: cur.dataBytesOut + (direction === 'out' ? bytes : 0)
    };
    saveStoragePrefs(userId, next);
}
export function formatBytes(n) {
    if (n < 1024)
        return `${Math.max(0, Math.round(n))} B`;
    if (n < 1024 * 1024)
        return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024)
        return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
export function isOnlineWifi() {
    const conn = navigator
        .connection;
    if (!conn)
        return true;
    if (conn.type === 'wifi' || conn.type === 'ethernet')
        return true;
    if (conn.type === 'cellular')
        return false;
    return true;
}
/** Whether automatic media fetch is allowed right now. */
export function canAutoDownloadMedia(userId) {
    const prefs = loadStoragePrefs(userId);
    return isOnlineWifi() ? prefs.autoDownloadWifi : prefs.autoDownloadCellular;
}
export const CHAT_THEME_VARS = {
    classic: { bubbleOut: '#2b5278', bubbleOutText: '#fff', accent: '#2aabee' },
    sunset: { bubbleOut: 'linear-gradient(135deg,#f6d365,#fda085)', bubbleOutText: '#1a1a1a', accent: '#fda085' },
    frost: { bubbleOut: 'linear-gradient(135deg,#89f7fe,#66a6ff)', bubbleOutText: '#0b1b2b', accent: '#66a6ff' },
    rose: { bubbleOut: 'linear-gradient(135deg,#f093fb,#f5576c)', bubbleOutText: '#fff', accent: '#f5576c' }
};
export function applyAppearanceToDocument(prefs) {
    const root = document.documentElement;
    const shell = document.querySelector('.focus-shell');
    const theme = CHAT_THEME_VARS[prefs.chatTheme] || CHAT_THEME_VARS.classic;
    let night = prefs.nightMode;
    if (prefs.nightModeAuto === 'system') {
        night = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    root.dataset.theme = night ? 'dark' : 'light';
    try {
        localStorage.setItem('chat-theme', night ? 'dark' : 'light');
    }
    catch {
        /* ignore */
    }
    const font = prefs.fontSize === 'sm' ? '0.9rem' : prefs.fontSize === 'lg' ? '1.12rem' : prefs.fontSize === 'md' ? '1rem' : '';
    const radius = prefs.bubbleRadius === 'sm' ? '10px' : prefs.bubbleRadius === 'lg' ? '22px' : '16px';
    const target = shell || root;
    target.style.setProperty('--focus-bubble-out', theme.bubbleOut);
    target.style.setProperty('--focus-bubble-out-text', theme.bubbleOutText);
    target.style.setProperty('--focus-accent', prefs.accentColor || theme.accent);
    target.style.setProperty('--focus-bubble-radius', radius);
    if (font)
        target.style.setProperty('--focus-chat-font', font);
    else
        target.style.removeProperty('--focus-chat-font');
    target.dataset.focusBg = prefs.chatBackground;
    target.dataset.focusMotion = prefs.motionEffects ? 'on' : 'off';
    target.dataset.focusStickers = prefs.stickersEnabled ? 'on' : 'off';
}
export async function estimateCacheBytes() {
    let total = 0;
    try {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
            const est = await navigator.storage.estimate();
            if (typeof est.usage === 'number')
                return est.usage;
        }
    }
    catch {
        /* fall through */
    }
    try {
        if ('caches' in window) {
            const keys = await caches.keys();
            for (const key of keys) {
                const cache = await caches.open(key);
                const reqs = await cache.keys();
                for (const req of reqs) {
                    const res = await cache.match(req);
                    if (!res)
                        continue;
                    const buf = await res.clone().arrayBuffer();
                    total += buf.byteLength;
                }
            }
        }
    }
    catch {
        /* ignore */
    }
    try {
        let ls = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k)
                continue;
            ls += (k.length + (localStorage.getItem(k)?.length || 0)) * 2;
        }
        total += ls;
    }
    catch {
        /* ignore */
    }
    return total;
}
export async function clearAppCaches() {
    try {
        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
        }
    }
    catch {
        /* ignore */
    }
}
