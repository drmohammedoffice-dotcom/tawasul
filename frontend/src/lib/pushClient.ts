import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import {
  fetchPushPrefs,
  registerPushDevice,
  removePushDevice,
  savePushPrefs,
  type PushPlatform
} from '@/api/push';
import { loadNotifPrefs, saveNotifPrefs, type FocusNotifPrefs } from '@/app/focus/focusPrefs';
import { env } from '@/config/env';
import { markPushActive } from '@/app/focus/focusNotify';

const TOKEN_KEY = 'securechat.pushToken';
const OPEN_DM_KEY = 'tawasul.openDm';
const CHANNEL_ID = 'tawasul';

export type PushPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

type PushOpen = { route: string; peerId?: string; kind?: string };

let startedFor: string | null = null;
let openingBound = false;
const openListeners = new Set<(open: PushOpen) => void>();

function webConfig() {
  const cfg = env.firebase;
  if (!cfg?.apiKey || !cfg.projectId || !cfg.messagingSenderId || !cfg.appId || !cfg.vapidKey) {
    return null;
  }
  return cfg;
}

export function consumePendingDmPeer(): string | null {
  try {
    const peer = sessionStorage.getItem(OPEN_DM_KEY);
    if (peer) sessionStorage.removeItem(OPEN_DM_KEY);
    return peer;
  } catch {
    return null;
  }
}

export function subscribePushOpens(listener: (open: PushOpen) => void): () => void {
  openListeners.add(listener);
  return () => openListeners.delete(listener);
}

function emitOpen(open: PushOpen) {
  if (open.kind === 'dm' && open.peerId && open.route === '/messages') {
    try {
      sessionStorage.setItem(OPEN_DM_KEY, open.peerId);
    } catch {
      /* ignore */
    }
  }
  openListeners.forEach((listener) => listener(open));
}

function bindOpenBridge() {
  if (openingBound || typeof window === 'undefined') return;
  openingBound = true;
  window.addEventListener('tawasul:push', (event) => {
    const detail = (event as CustomEvent<Record<string, string>>).detail;
    if (!detail || typeof detail.route !== 'string' || !detail.route.startsWith('/')) return;
    const open: PushOpen = { route: detail.route };
    if (detail.peerId) open.peerId = detail.peerId;
    if (detail.kind) open.kind = detail.kind;
    emitOpen(open);
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data as { type?: string; route?: string } | null;
      if (data?.type === 'PUSH_OPEN' && typeof data.route === 'string' && data.route.startsWith('/')) {
        emitOpen({ route: data.route });
      }
    });
  }
}

export async function readPushPermission(): Promise<PushPermission> {
  if (Capacitor.isNativePlatform()) {
    try {
      const status = await PushNotifications.checkPermissions();
      if (status.receive === 'granted' || status.receive === 'denied' || status.receive === 'prompt') {
        return status.receive;
      }
    } catch {
      return 'unsupported';
    }
    return 'prompt';
  }
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }
  return 'prompt';
}

export async function requestPushPermission(): Promise<PushPermission> {
  if (Capacitor.isNativePlatform()) {
    try {
      const status = await PushNotifications.requestPermissions();
      if (status.receive === 'granted' || status.receive === 'denied') return status.receive;
      return 'prompt';
    } catch {
      return 'unsupported';
    }
  }
  if (!('Notification' in window)) return 'unsupported';
  try {
    const result = await Notification.requestPermission();
    return result === 'granted' || result === 'denied' ? result : 'prompt';
  } catch {
    return Notification.permission === 'granted' ? 'granted' : 'denied';
  }
}

export async function syncPushPrefs(userId: string): Promise<FocusNotifPrefs> {
  const local = loadNotifPrefs(userId);
  try {
    const remote = await fetchPushPrefs();
    if (!remote.saved) {
      await savePushPrefs(local);
      return local;
    }
    const next: FocusNotifPrefs = {
      ...local,
      privateChats: remote.privateChats,
      groups: remote.groups,
      channels: remote.channels,
      stories: remote.stories,
      reactions: remote.reactions,
      newContacts: remote.newContacts,
      inAppPreview: remote.inAppPreview,
      namesOnLockScreen: remote.namesOnLockScreen
    };
    saveNotifPrefs(userId, next);
    return next;
  } catch {
    return local;
  }
}

export async function publishPushPrefs(prefs: FocusNotifPrefs): Promise<void> {
  try {
    await savePushPrefs(prefs);
  } catch {
    /* local copy still applies in the open app */
  }
}

/** Register this install when permission is already granted. Pass request:true from a tap. */
export async function startPush(userId: string, opts?: { request?: boolean }): Promise<void> {
  bindOpenBridge();
  if (startedFor === userId) return;
  startedFor = userId;
  try {
    let permission = await readPushPermission();
    if (permission !== 'granted' && opts?.request) {
      permission = await requestPushPermission();
    }
    if (permission !== 'granted') {
      startedFor = null;
      return;
    }
    const token = Capacitor.isNativePlatform() ? await nativeToken() : await webToken();
    if (!token) {
      startedFor = null;
      return;
    }
    const platform = platformOf();
    await registerPushDevice(token, platform);
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* ignore */
    }
    markPushActive(true);
  } catch {
    startedFor = null;
    markPushActive(false);
  }
}

export async function stopPush(): Promise<void> {
  startedFor = null;
  markPushActive(false);
  let token: string | null = null;
  try {
    token = localStorage.getItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    token = null;
  }
  if (!token) return;
  try {
    await removePushDevice(token);
  } catch {
    /* session may already be ending */
  }
}

function platformOf(): PushPlatform {
  const platform = Capacitor.getPlatform();
  if (platform === 'android' || platform === 'ios') return platform;
  return 'web';
}

async function nativeToken(): Promise<string | null> {
  if (Capacitor.getPlatform() === 'android') {
    await PushNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'تواصل',
      description: 'الرسائل والمكالمات والتفاعلات',
      importance: 5,
      sound: 'default',
      vibration: true,
      visibility: 1
    });
  }
  const tokenPromise = new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('push token timeout')), 15000);
    void PushNotifications.addListener('registration', (event) => {
      window.clearTimeout(timer);
      resolve(event.value);
    });
    void PushNotifications.addListener('registrationError', (err) => {
      window.clearTimeout(timer);
      reject(new Error(err.error || 'push registration failed'));
    });
    void PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const data = (action.notification.data ?? {}) as Record<string, string>;
      window.dispatchEvent(new CustomEvent('tawasul:push', { detail: data }));
    });
  });
  await PushNotifications.register();
  return tokenPromise;
}

let firebaseApp: FirebaseApp | null = null;

async function webToken(): Promise<string | null> {
  const cfg = webConfig();
  if (!cfg) return null;
  if (!(await isSupported())) return null;
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  firebaseApp = firebaseApp ?? initializeApp({
    apiKey: cfg.apiKey,
    authDomain: cfg.authDomain || `${cfg.projectId}.firebaseapp.com`,
    projectId: cfg.projectId,
    messagingSenderId: cfg.messagingSenderId,
    appId: cfg.appId
  });
  const messaging = getMessaging(firebaseApp);
  onMessage(messaging, (payload) => {
    if (document.visibilityState === 'visible') return;
    const data = payload.data ?? {};
    const title = payload.notification?.title || 'تواصل';
    const body = payload.notification?.body || '';
    try {
      registration.showNotification(title, { body, data, tag: data.tag || 'tawasul' });
    } catch {
      /* the service worker shows background messages */
    }
  });
  return getToken(messaging, {
    vapidKey: cfg.vapidKey,
    serviceWorkerRegistration: registration
  });
}
