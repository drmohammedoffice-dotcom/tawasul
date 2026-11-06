const SAVED_KEY = 'securechat.savedReels';
export function loadSavedReels() {
    try {
        const raw = localStorage.getItem(SAVED_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(arr) ? arr : []);
    }
    catch {
        return new Set();
    }
}
export function persistSavedReels(ids) {
    try {
        localStorage.setItem(SAVED_KEY, JSON.stringify([...ids]));
    }
    catch {
        /* ignore */
    }
}
export function toggleSavedReel(id) {
    const ids = loadSavedReels();
    if (ids.has(id))
        ids.delete(id);
    else
        ids.add(id);
    persistSavedReels(ids);
    return ids.has(id);
}
export function isReelSaved(id) {
    return loadSavedReels().has(id);
}
