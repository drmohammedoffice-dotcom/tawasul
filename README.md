# Secure Real-Time Messaging Monorepo

Production-ready monorepo scaffold for a secure real-time messaging platform using:
- `backend`: NestJS (Node.js + TypeScript)
- `frontend`: React + Vite (TypeScript)
- `shared`: shared TypeScript contracts/interfaces
- `infrastructure`: Docker + deployment manifests

## Project Structure

```txt
.
├─ backend/
│  ├─ src/
│  │  ├─ modules/
│  │  │  ├─ config/
│  │  │  ├─ health/
│  │  │  └─ messaging/
│  │  ├─ app.module.ts
│  │  └─ main.ts
│  ├─ .env.example
│  ├─ package.json
│  ├─ nest-cli.json
│  └─ tsconfig*.json
├─ frontend/
│  ├─ src/
│  │  ├─ app/
│  │  ├─ config/
│  │  └─ main.tsx
│  ├─ .env.example
│  ├─ package.json
│  ├─ index.html
│  ├─ tsconfig.json
│  └─ vite.config.ts
├─ shared/
│  ├─ src/
│  │  ├─ types/
│  │  └─ index.ts
│  ├─ package.json
│  └─ tsconfig.json
├─ infrastructure/
│  ├─ docker/
│  │  ├─ backend.Dockerfile
│  │  └─ frontend.Dockerfile
│  ├─ deploy/kubernetes/
│  │  ├─ backend-deployment.yaml
│  │  └─ frontend-deployment.yaml
│  └─ docker-compose.yml
├─ .eslintrc.cjs
├─ .prettierrc
├─ package.json
└─ tsconfig.base.json
```

## Monorepo Tooling

- TypeScript configured at root via `tsconfig.base.json`.
- ESLint + Prettier configured at root and reused in all packages.
- npm workspaces configured in root `package.json`.
- Environment validation in backend using `@nestjs/config` + Joi.

## Getting Started

1. Install workspace dependencies:
   ```bash
   npm install
   ```
2. Create env files:
   - copy `backend/.env.example` to `backend/.env`
   - copy `frontend/.env.example` to `frontend/.env`
3. Run all workspace dev scripts:
   ```bash
   npm run dev
   ```

## Infrastructure

- One-command local stack: `docker-compose.yml` at repo root
- Dockerfiles:
  - `infrastructure/docker/backend.Dockerfile`
  - `infrastructure/docker/frontend.Dockerfile`
- Kubernetes baseline manifests:
  - `infrastructure/deploy/kubernetes/backend-deployment.yaml`
  - `infrastructure/deploy/kubernetes/frontend-deployment.yaml`

## Notes

- `shared` package is used by both backend and frontend to keep contracts synchronized.
- Messaging module currently includes both REST and WebSocket starter flows for real-time features.
- This repository now has the core monorepo foundation ready for domain expansion (auth, chats, media, notifications, encryption workflows).

## Docker Quick Start

1. Optional: copy `.env.docker.example` to `.env` and adjust values.
2. Optional: copy `backend/.env.docker.example` to `backend/.env.docker` and set secure JWT secrets.
3. Run:
   ```bash
   docker compose up --build
   ```

Services:
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3000/api`
- Health: `http://localhost:3000/health`

## Mobile and Desktop App Packaging

The frontend now supports native packaging for Android (`APK`) and Windows (`EXE`).

### Android APK (Capacitor)

From `frontend/`:

```bash
npm run android:sync
npm run android:apk
```

Output debug APK:
- `frontend/android/app/build/outputs/apk/debug/app-debug.apk`

Useful commands:
- `npm run android:open` to open Android Studio project.

### Windows EXE (Electron)

From `frontend/`:

```bash
npm run desktop:dist
```

Output files:
- `frontend/release/SecureChat Setup 1.0.0.exe`
- `frontend/release/SecureChat 1.0.0.exe`
- unpacked app folder: `frontend/release/win-unpacked/`
