# API Reference (Social + Media extensions)

Base: `/api`  
Auth: `Authorization: Bearer <accessToken>` unless noted.

## Media

| Method | Path | Notes |
|--------|------|-------|
| POST | `/media/upload-ticket` | Create upload session + MediaAsset |
| POST | `/media/complete` | Verify object exists; mark ready/processing |
| POST | `/media/:mediaId/delete` | Owner delete + storage delete |
| GET | `/media/:mediaId/url` | Signed/local read URL |
| POST | `/media/attach` | Attach to chat message |
| POST | `/media/local-upload/:mediaId` | Local driver only (token query) |
| GET | `/media/local-file/:mediaId` | Local driver only |

## Video / Stream

| Method | Path | Notes |
|--------|------|-------|
| POST | `/video/stream/direct-upload` | Requires Stream config |
| POST | `/video/stream/webhook` | Signature required |

## Social

| Method | Path |
|--------|------|
| GET | `/feed` |
| GET | `/explore` |
| POST | `/posts` |
| POST | `/posts/:id/like` |
| DELETE | `/posts/:id/like` |
| POST | `/posts/:id/comments` |
| POST | `/posts/:id/bookmark` |
| DELETE | `/posts/:id/bookmark` |
| DELETE | `/posts/:id` |
| POST | `/stories` |
| GET | `/stories/feed` |
| POST | `/stories/:id/view` |
| DELETE | `/stories/:id` |
| POST | `/reels` |
| GET | `/reels/feed` |
| POST | `/reels/:id/like` |
| POST | `/reels/:id/view` |
| GET | `/notifications` |
| POST | `/notifications/:id/read` |
| GET/PATCH | `/users/me/profile` |
| GET | `/users/:idOrUsername/profile` |
| POST/DELETE | `/users/:id/follow` |
| POST | `/users/:followerId/follow/accept` |
| POST/DELETE | `/users/:id/block` |
| POST | `/reports` |

Existing auth/messaging/groups/channels/wallet APIs remain unchanged.
