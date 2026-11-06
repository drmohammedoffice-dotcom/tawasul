# API Contract (Gateway)

## Auth
- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/auth/refresh`

## Chats
- `POST /v1/chats`
  - types: `direct`, `group`, `channel`

## Messaging
- `POST /v1/messages` (encrypted envelope only)
- `POST /v1/receipts` (`sent|delivered|read`)
- `GET /ws` (real-time event stream)

## Envelope shape
```json
{
  "chatId": "uuid",
  "ciphertextB64": "base64",
  "nonceB64": "base64",
  "keyVersion": 1,
  "messageType": "text",
  "clientMsgId": "uuid"
}
```
