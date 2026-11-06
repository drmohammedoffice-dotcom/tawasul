import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
const ROOTS = new Set([
    '/',
    '/feed',
    '/explore',
    '/reels',
    '/search',
    '/messages',
    '/profile',
    '/notifications'
]);
/**
 * Hardware back: pop in-app history when possible; double-back exits on root tabs.
 */
export function installNativeBackHandler(navigate, getPath) {
    if (!Capacitor.isNativePlatform()) {
        return () => undefined;
    }
    let lastExitAt = 0;
    const handle = (info) => {
        const path = getPath();
        const atRoot = ROOTS.has(path) ||
            path === '/feed' ||
            /^\/messages\/?$/.test(path) ||
            /^\/reels\/?$/.test(path);
        // Nested screens (settings, catalog, chat open, edit profile, …) always go back first.
        if (!atRoot) {
            navigate(-1);
            return;
        }
        // If WebView reports history, prefer that on root too (e.g. modal routes).
        if (info.canGoBack && window.history.length > 1) {
            // Stay on root tabs — don't exit accidentally from tab switches.
        }
        const now = Date.now();
        if (now - lastExitAt < 1800) {
            void App.exitApp();
            return;
        }
        lastExitAt = now;
    };
    const listener = App.addListener('backButton', handle);
    return () => {
        void listener.then((l) => l.remove());
    };
}
