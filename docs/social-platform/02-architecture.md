# SecureChat Social Platform — Architecture

## High-level

```text
Browser / Capacitor / Electron
        |  HTTPS + WSS
        v
 React (Vite) SPA + React Router
        |
        +--> REST /api/*
        +--> Socket.IO /realtime
        v
 NestJS monolith (modular)
        |
   +----+----+------------------+
   |         |                  |
 Prisma   Redis            MediaStorageProvider
   |         |               /     |     \
PostgreSQL  cache/         local   s3    r2
            sessions              (MinIO) (Cloudflare)
            rate-limit
            pub/sub
```

## Backend modules (extended)

| Module | Responsibility |
|--------|----------------|
| auth / users | JWT auth, profile fields |
| messaging / groups / channels | Telegram-like chat |
| media | Upload tickets, complete, delete, local endpoints |
| video (in media) | Optional Cloudflare Stream direct upload + webhook |
| social | posts, feed, explore, follow, stories, reels, notifications, reports/blocks |
| wallet / gifts / engagement / monetization | Existing gamification |
| ai | Mock/rule assistants |

## Media abstraction

`MEDIA_STORAGE_PROVIDER` token → `LocalMediaStorageProvider` | `S3CompatibleMediaStorageProvider`

- Driver selected by `MEDIA_STORAGE_DRIVER` / `MEDIA_STORAGE_PROVIDER`: `local` | `s3` | `r2`
- Object keys are **server-generated** (`u/{userId}/{purpose}/{mediaId}/{safeName}`)
- Binary never stored in PostgreSQL; only `MediaAsset` metadata

## Frontend navigation

Routes: `/feed`, `/explore`, `/reels`, `/messages`, `/notifications`, `/create`, `/profile`, `/settings`

Messages reuses the existing chat `App` under `/messages`.

## What is intentionally deferred

- Full BullMQ worker fleet (recommend next; Redis available)
- FFmpeg thumbnail pipeline in-process (must not run on HTTP thread)
- Production E2EE claims
- Admin console UI
