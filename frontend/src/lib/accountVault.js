const VAULT_KEY = 'securechat.accountVault.v1';
const CREDS_KEY = 'securechat.savedCreds.v1';
function readVault() {
    try {
        const raw = localStorage.getItem(VAULT_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    }
    catch {
        return [];
    }
}
function writeVault(items) {
    try {
        localStorage.setItem(VAULT_KEY, JSON.stringify(items.slice(0, 8)));
    }
    catch {
        /* ignore */
    }
}
/** Persist / refresh a logged-in account in the multi-account vault (Instagram-style). */
export function upsertVaultAccount(session, extras) {
    const items = readVault().filter((a) => a.userId !== session.user.id);
    const prev = readVault().find((a) => a.userId === session.user.id);
    items.unshift({
        userId: session.user.id,
        username: session.user.username,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        savedAt: Date.now(),
        avatarUrl: extras?.avatarUrl ?? prev?.avatarUrl ?? null,
        displayName: extras?.displayName ?? prev?.displayName ?? null
    });
    writeVault(items);
}
export function patchVaultProfile(userId, patch) {
    writeVault(readVault().map((a) => a.userId === userId
        ? {
            ...a,
            ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
            ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
            ...(patch.username !== undefined ? { username: patch.username } : {})
        }
        : a));
}
export function listVaultAccounts() {
    return readVault();
}
export function removeVaultAccount(userId) {
    writeVault(readVault().filter((a) => a.userId !== userId));
}
export function getVaultAccount(userId) {
    return readVault().find((a) => a.userId === userId) ?? null;
}
export function vaultToSession(a) {
    return {
        user: { id: a.userId, username: a.username, email: null },
        accessToken: a.accessToken,
        refreshToken: a.refreshToken
    };
}
export function saveLoginCredentials(username, password) {
    try {
        const list = readCreds().filter((c) => c.username !== username);
        list.unshift({ username, password, savedAt: Date.now() });
        localStorage.setItem(CREDS_KEY, JSON.stringify(list.slice(0, 8)));
    }
    catch {
        /* ignore */
    }
}
export function readCreds() {
    try {
        const raw = localStorage.getItem(CREDS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    }
    catch {
        return [];
    }
}
export function getSavedPassword(username) {
    return readCreds().find((c) => c.username === username)?.password ?? null;
}
