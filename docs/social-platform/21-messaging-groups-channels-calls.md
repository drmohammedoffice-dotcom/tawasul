# SecureChat — Phase 2: Direct Messaging, Business Channels, Groups, Calls & Rich Media (Report 21)

**Date:** 2026-10-24  
**Based on:** [20-accounts-business-verification-security.md](./20-accounts-business-verification-security.md)  
**Constraints:** No messaging rewrite from scratch; extend existing Nest Socket.IO + Message/Group/Channel models; no fake “complete calls” without ICE path; no claim of E2E encryption for voice/media.

---

## 1) Pre-check (Phase 1 + existing messaging)

| Area | Status before Phase 2 |
|------|------------------------|
| DM REST + Socket.IO `/realtime` | Present (`MessagingService` / `MessagingGateway`) |
| Message statuses sent/delivered/read | Present |
| MessageMedia attach API | Present (`POST /media/attach`) |
| Groups / channels create + WS rooms | Present |
| Business `accountType` | Present (Phase 1) |
| WebRTC / calls | **Absent** — added in this phase |
| People search for DM (displayName) | Search API existed; Messages UI only filtered local conversations / DEV user-id |
| Pins strip | Absent — added |
| Business-only create | Plan limits only — **now** requires `accountType=business` |

Existing groups/channels were **not** deleted. Owners who were personal keep membership; further **creates** require business.

---

## 2) What was implemented

### 2.1 Messages — people search & DM UX

- Unified search field on Messages: username + display name via `GET /search` (debounced).
- Results show avatar initial, display name, `@username`; blocked users excluded; private bios hidden from non-followers.
- Selecting a user opens / creates conversation via existing private message APIs (no User ID as primary UX).
- Chat header: peer avatar/name, link to profile, online/typing, audio/video call actions when socket available.
- Bubbles, statuses, load-older with scroll preservation, WS reconnect banner, dedupe of `message:new` by id (existing).
- Composer: gallery + camera capture, voice note (MediaRecorder), stickers (emoji set), upload progress hook.
- Media attachments returned on messages (`mediaAttachments[]`); FE resolves signed URLs via `/media/:id/url`.
- **Not claimed:** end-to-end encryption of voice/images beyond existing transport + access control.

### 2.2 Business-only groups & channels

- `FeatureGateService.assertBusinessAccount` before create group/channel.
- FE hides create forms for personal accounts; API still returns **403** if called directly.
- Existing spaces remain listable for members.

### 2.3 Pins strip

- Model `SpacePin` (user-scoped; independent of membership).
- APIs: `GET/POST /messaging/pins`, `DELETE /messaging/pins/:spaceType/:spaceId`, `PUT /messaging/pins/reorder`.
- Horizontal strip above search on Messages (RTL/LTR scroll); pinned first; pin from group detail.

### 2.4 Calls (WebRTC mesh + Socket.IO signaling)

| Piece | Detail |
|-------|--------|
| Schema | `CallSession`, `CallParticipant` (statuses ringing → connecting → connected → ended/failed/rejected) |
| REST | `/calls/ice-servers`, `/calls/dm`, `/calls/space`, accept/reject/end/join |
| WS | `call:invite`, `call:accept`, `call:reject`, `call:end`, `call:signal` |
| ACL | Block check on DM calls; group/channel start limited to owner/admin; participants gated |
| FE | `CallOverlay` + `webrtcCall.ts` (getUserMedia, mute, camera, flip when supported) |
| ICE | Default public STUN; optional `WEBRTC_TURN_*` env — **TURN not configured in this environment** |

**Honest call status:** Signaling + session lifecycle + ICE server endpoint are implemented and smoke-tested (invite/reject, ice-servers). **Live media path between two browsers was NOT RUN** here (needs two clients + preferably TURN). Group calls use mesh capped at 8; **SFU not integrated** — required for large rooms. Focus Mode adds `GET /calls/history` (all/missed) — history UI does not claim SFU-scale group video.

### Focus Mode (Browse / Focus)
- Header toggle **تصفح | تركيز** switches app chrome: Browse keeps IG shell; Focus uses Contacts / Calls / Chats / Settings dock.
- Unified inbox: `GET /messaging/inbox` (DM + groups + channels), server `ChatMute`, pins include `dm`.
- Group/channel create open to all account types (plan limits still apply). Unread cursors: `GroupMessageRead` / `ChannelMessageRead`.
- Contacts: `GET /contacts/suggested` + `POST /contacts/match` (hashed phone sync when Capacitor Contacts available).

### 2.5 Schema / env additions

- `Group`/`Channel`: optional `description`, `avatarUrl`
- `SpacePin`, `CallSession`, `CallParticipant`
- Env: `WEBRTC_STUN_URLS`, optional TURN vars (documented in `.env` comments)

---

## 3) Main files

**Backend:** `prisma/schema.prisma`, `feature-gate.service.ts`, `messaging.service.ts` (+ mediaIds), `call.service.ts`, `calls.controller.ts`, `space-pins.*`, `messaging.gateway.ts` (call events), `search.service.ts` (private bio), `messaging.module.ts`

**Frontend:** `ChatScreen.tsx`, `App.tsx`, `calls/CallOverlay.tsx`, `lib/webrtcCall.ts`, `api/messagingExtras.ts`, `GroupsChannels.tsx`, `social.css`, `i18n/messages.ts`, `types/api.ts`

**Scripts:** `scripts/phase2-messaging-smoke.mjs`

---

## 4) Tests

| Case | Result |
|------|--------|
| Backend `tsc` | **PASS** |
| Frontend `tsc --noEmit` | **PASS** |
| `phase2-messaging-smoke.mjs` (12 checks) | **PASS** |
| Search username + displayName | **PASS** |
| DM send + list | **PASS** |
| Personal create group/channel → 403 | **PASS** |
| Business create group + channel | **PASS** |
| Pin / unpin | **PASS** |
| Block prevents DM | **PASS** |
| ICE servers endpoint | **PASS** |
| DM call invite + reject | **PASS** |
| Image / voice note upload in UI | **NOT RUN** (manual / two-browser) |
| Live 1:1 WebRTC audio/video media | **NOT RUN** (no TURN; no dual-browser lab in this run) |
| Live group call mesh media | **NOT RUN** |
| RTL/LTR strip + mobile layout | **PARTIAL** (CSS shipped; visual QA manual) |

Command:

```bash
node scripts/phase2-messaging-smoke.mjs
```

---

## 5) External / ops requirements (not claimed done)

| Need | Why |
|------|-----|
| TURN server (`WEBRTC_TURN_*`) | Reliable NAT traversal for real calls |
| SFU (LiveKit / mediasoup / etc.) | Scale group/channel calls beyond small mesh |
| Dual-device QA | Confirm camera/mic permissions + flip + reconnect |
| Push notifications for new DMs | Out of scope if not already wired |

---

## 6) Exit criteria

- [x] Extend existing messaging (no greenfield rewrite)
- [x] People search by username/display name for starting DMs
- [x] Richer DM UI + media/voice composer hooks (ACL on media URLs)
- [x] Business-only create groups/channels (API + UI)
- [x] Pins strip persisted server-side
- [x] Call signaling + session model + ICE config endpoint
- [x] Build + Phase 2 smoke **PASS**
- [ ] Live call media verified with TURN — **next ops step**
- [ ] SFU for large group calls — **future**

**Do not start Phase 3** until product accepts STUN-only lab calls or TURN is configured and dual-client media is verified.
