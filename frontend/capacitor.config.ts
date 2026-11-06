import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.securechat.app',
  appName: 'SecureChat',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
    // Uncomment for live-reload against Vite while developing in Android Studio:
    // url: 'http://192.168.0.144:5173',
    // cleartext: true
  },
  android: {
    allowMixedContent: true
  },
  // Native HTTP bypasses WebView CORS (required for https://localhost → http://API).
  plugins: {
    CapacitorHttp: {
      enabled: true
    },
    PushNotifications: {
      presentationOptions: ['badge']
    }
  }
};

export default config;
