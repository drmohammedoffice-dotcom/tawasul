import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Prefer an absolute root. On Windows, avoid mixing 8.3 short paths with Unicode
 * long paths — that mismatch makes vite:build-html emit `../../<unicode>/index.html`
 * which Rollup rejects. Use `npm run build` (scripts/build-frontend.mjs) so cwd is
 * the PowerShell FullName path before Vite starts.
 */
const rootDir = path.dirname(fileURLToPath(import.meta.url));

function firebaseMessagingSw(env: Record<string, string>): Plugin {
  const render = () => renderFirebaseMessagingSw(env);
  return {
    name: 'firebase-messaging-sw',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathOnly = req.url?.split('?')[0] ?? '';
        if (pathOnly !== '/firebase-messaging-sw.js') {
          next();
          return;
        }
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Service-Worker-Allowed', '/');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(render());
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'firebase-messaging-sw.js',
        source: render()
      });
    }
  };
}

function renderFirebaseMessagingSw(env: Record<string, string>): string {
  const apiKey = env.VITE_FIREBASE_API_KEY?.trim() ?? '';
  const projectId = env.VITE_FIREBASE_PROJECT_ID?.trim() ?? '';
  const messagingSenderId = env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() ?? '';
  const appId = env.VITE_FIREBASE_APP_ID?.trim() ?? '';
  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN?.trim() || (projectId ? `${projectId}.firebaseapp.com` : '');
  if (!apiKey || !projectId || !messagingSenderId || !appId) {
    return '/* Firebase web push is off until VITE_FIREBASE_* is set. */\n';
  }
  const config = JSON.stringify({ apiKey, authDomain, projectId, messagingSenderId, appId });
  return `/* generated — Firebase Cloud Messaging background handler */
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');
firebase.initializeApp(${config});
firebase.messaging();
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification && event.notification.data ? event.notification.data : {};
  const route = typeof data.route === 'string' && data.route.charAt(0) === '/' ? data.route : '/notifications';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      client.postMessage({ type: 'PUSH_OPEN', route });
      if ('focus' in client) return client.focus();
    }
    return self.clients.openWindow(new URL(route, self.location.origin).href);
  })());
});
`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, '');
  return {
  root: rootDir,
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.svg', 'icons/icon-512.svg'],
      manifest: {
        name: 'SecureChat',
        short_name: 'SecureChat',
        description: 'Secure real-time messaging on desktop and Android.',
        theme_color: '#10182b',
        background_color: '#080d18',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icons/icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any'
          },
          {
            src: '/icons/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      }
    }),
    firebaseMessagingSw(env)
  ],
  resolve: {
    // Prefer TypeScript sources over stale compiled .js siblings in src/
    extensions: ['.mjs', '.mts', '.ts', '.tsx', '.jsx', '.js', '.json'],
    alias: {
      '@': path.resolve(rootDir, 'src')
    }
  },
  build: {
    outDir: path.resolve(rootDir, 'dist'),
    emptyOutDir: true
  },
  server: {
    host: true,
    port: 5173
  }
  };
});

