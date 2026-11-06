# SecureChat — Mobile Display & Android App

## What you get

1. **Mobile web** — responsive layout (bottom nav ≤960px, immersive Reels, messages height, safe areas, touch targets).
2. **Android app** — Capacitor wrapper (`com.securechat.app`) under `frontend/android`, packaging the same Vite React UI.

## Mobile web (phone browser)

1. Start backend on the PC (`PORT=3000`, listening on all interfaces).
2. Start Vite with LAN bind:

```bash
cd frontend
npm run dev -- --host 0.0.0.0
```

3. On the phone (same Wi‑Fi), open `http://<PC-LAN-IP>:5173`  
   Example from this machine: `http://192.168.0.144:5173`
4. Ensure `backend/.env` `CLIENT_ORIGINS` includes that exact origin.

The frontend rewrites loopback API URLs to the page host when you open the app via a LAN IP, so `VITE_API_BASE_URL=http://localhost:3000/api` still works from a phone browser.

## Android app (Capacitor)

### Prerequisites

- [Android Studio](https://developer.android.com/studio) (includes JDK + Android SDK)
- Backend running on the host while testing

### Configure API host

In `frontend/.env`:

| Target | `VITE_NATIVE_API_HOST` |
|--------|-------------------------|
| Android Emulator | `10.0.2.2` (default in `.env`) |
| Physical phone | PC LAN IPv4, e.g. `192.168.0.144` |

Keep:

```env
VITE_API_BASE_URL=http://localhost:3000/api
VITE_WS_URL=http://localhost:3000/realtime
```

CORS must allow Capacitor origins (already in `.env.example`):

```text
https://localhost,capacitor://localhost
```

### Build & run

```bash
cd frontend
npm run android:sync    # production web build + copy into android/
npm run android:open    # opens Android Studio
```

In Android Studio: Run on emulator or device.

Build APKs (requires JDK 21 + Android SDK — not Studio’s bundled Java 25):

```bash
cd frontend
npm run android:apk
```

**Install on a phone/emulator (signed debug):**

`frontend/release/SecureChat-debug.apk`

Also produced:

- `frontend/android/app/build/outputs/apk/debug/app-debug.apk`
- `frontend/release/SecureChat-release-unsigned.apk` (needs a release keystore before Play Store)

Note: the project path contains Arabic (`تواصل`); `android.overridePathCheck=true` is set in `frontend/android/gradle.properties`.

### Permissions included

- `INTERNET` / network state
- `CAMERA` / `RECORD_AUDIO` (calls & media; optional hardware features)
- Cleartext HTTP allowed for local API (tighten when API is HTTPS)

## Not done in this pass

- Publishing to Play Store / signing release APK
- Push notifications native plugins
- Separate React Native rewrite (not needed — Capacitor wraps this UI)
