import { loadNotifPrefs } from './focusPrefs';
let audioCtx = null;
let pushActive = false;
export function markPushActive(active) {
    pushActive = active;
}
function playInAppSound() {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx)
            return;
        if (!audioCtx)
            audioCtx = new Ctx();
        const ctx = audioCtx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.value = 0.04;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
        osc.stop(ctx.currentTime + 0.2);
    }
    catch {
        /* ignore */
    }
}
export function notifyFocusMessage(input) {
    const prefs = loadNotifPrefs(input.userId);
    const allowed = (input.kind === 'private' && prefs.privateChats) ||
        (input.kind === 'group' && prefs.groups) ||
        (input.kind === 'channel' && prefs.channels) ||
        (input.kind === 'contact' && prefs.newContacts);
    if (!allowed)
        return;
    if (!input.silent) {
        if (prefs.inAppSounds)
            playInAppSound();
        if (prefs.inAppVibrate && typeof navigator.vibrate === 'function') {
            navigator.vibrate(40);
        }
    }
    if (input.silent)
        return;
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        return;
    }
    if (pushActive)
        return;
    if (!('Notification' in window))
        return;
    if (Notification.permission !== 'granted')
        return;
    const body = prefs.inAppPreview
        ? input.body
        : prefs.namesOnLockScreen
            ? input.title
            : '• • •';
    const title = prefs.namesOnLockScreen ? input.title : 'SecureChat';
    try {
        const n = new Notification(title, {
            body,
            tag: input.tag || `focus-${input.kind}`,
            silent: true
        });
        window.setTimeout(() => n.close(), 6000);
    }
    catch {
        /* ignore */
    }
}
export async function ensureNotificationPermission() {
    if (!('Notification' in window))
        return 'unsupported';
    if (Notification.permission === 'granted' || Notification.permission === 'denied') {
        return Notification.permission;
    }
    try {
        return await Notification.requestPermission();
    }
    catch {
        return Notification.permission;
    }
}
