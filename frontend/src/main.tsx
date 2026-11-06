import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { SocialRoot } from './app/SocialRoot';
import { NativeBackBridge } from './app/NativeBackBridge';
import { I18nProvider } from './i18n/I18nProvider';

/** PWA service workers break Capacitor (stale cache + intercepted API fetch). */
async function clearServiceWorkersOnNative() {
  const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  const isNative = typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform();
  if (!isNative || !('serviceWorker' in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* ignore */
  }
}

void clearServiceWorkersOnNative();

(function initTheme() {
  try {
    const saved = window.localStorage.getItem('chat-theme');
    const theme =
      saved === 'light' || saved === 'dark'
        ? saved
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    document.documentElement.dataset.theme = theme;
  } catch {
    document.documentElement.dataset.theme = 'dark';
  }
})();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <NativeBackBridge />
        <SocialRoot />
      </BrowserRouter>
    </I18nProvider>
  </React.StrictMode>
);
