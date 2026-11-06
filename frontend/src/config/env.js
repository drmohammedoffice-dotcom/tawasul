function getEnv(name) {
    const value = import.meta.env[name];
    if (!value || typeof value !== 'string') {
        throw new Error(`Missing required frontend env: ${name}`);
    }
    return value;
}
function getOptionalEnv(name) {
    const value = import.meta.env[name];
    if (!value || typeof value !== 'string' || value.trim() === '')
        return undefined;
    return value.trim();
}
function readFirebase() {
    const apiKey = getOptionalEnv('VITE_FIREBASE_API_KEY');
    const projectId = getOptionalEnv('VITE_FIREBASE_PROJECT_ID');
    const messagingSenderId = getOptionalEnv('VITE_FIREBASE_MESSAGING_SENDER_ID');
    const appId = getOptionalEnv('VITE_FIREBASE_APP_ID');
    const vapidKey = getOptionalEnv('VITE_FIREBASE_VAPID_KEY');
    if (!apiKey || !projectId || !messagingSenderId || !appId || !vapidKey)
        return undefined;
    return {
        apiKey,
        authDomain: getOptionalEnv('VITE_FIREBASE_AUTH_DOMAIN') || `${projectId}.firebaseapp.com`,
        projectId,
        messagingSenderId,
        appId,
        vapidKey
    };
}
const firebase = readFirebase();
export const env = {
    apiBaseUrl: getEnv('VITE_API_BASE_URL'),
    wsUrl: getEnv('VITE_WS_URL'),
    nativeApiHost: getOptionalEnv('VITE_NATIVE_API_HOST'),
    ...(firebase ? { firebase } : {})
};
