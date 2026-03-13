<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node">
  <img src="https://img.shields.io/badge/typescript-5.x-blue" alt="TypeScript">
  <img src="https://img.shields.io/badge/express-5.x-lightgrey" alt="Express">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
</p>

# FoxTrot Backend

Backend server for [FoxTrot](https://github.com/reznik99/FoxTrot-FrontEnd) — a secure, real-time messaging and calling application with end-to-end encryption and WebRTC voice/video calls.

This service handles user authentication, message routing, media storage, WebRTC signaling, push notifications, and contact management. Messages are delivered in real-time over WebSockets when users are online, and fall back to Firebase Cloud Messaging (FCM) push notifications when they're not.

---

## Architecture

```
┌──────────────┐         ┌──────────────────────────────────────────────┐
│   FoxTrot    │         │              FoxTrot Backend                 │
│   Client     │         │                                              │
│  (React      │  REST   │  ┌────────┐  ┌──────┐  ┌───────────────┐     │
│   Native)    ├────────►│  │ Routes │──│ Auth │──│  PostgreSQL   │     │
│              │         │  └────────┘  └──────┘  └───────────────┘     │
│              │  WS     │  ┌────────────────┐                          │
│              ├────────►│  │ WebSocket Srv  │─── signaling ──┐         │
│              │         │  └────────────────┘                │         │
│              │         │  ┌─────┐  ┌──────────┐  ┌─────────▼────┐     │
│              │◄────────│  │ FCM │  │ Metrics  │  │ TURN Server  │     │
│              │  Push   │  └─────┘  │(Prometheus)│  │ (CoTURN)   │     │
└──────────────┘         │  ┌─────┐  └──────────┘  └──────────────┘     │
                         │  │ S3  │ (encrypted media)                   │
                         │  └─────┘                                     │
                         └──────────────────────────────────────────────┘
```

### Message Flow

1. **Online delivery** — Messages sent via REST are persisted in PostgreSQL, then proxied directly to the recipient's WebSocket connection.
2. **Offline delivery** — If the recipient is offline, an FCM push notification is dispatched. Messages are retrieved from the database when the client reconnects.
3. **Call signaling** — WebRTC offers, answers, and ICE candidates are relayed via WebSocket. When the callee is offline, signaling data is cached for up to 90 seconds and replayed on reconnect.
4. **Media** — Encrypted media files are uploaded/downloaded via S3 pre-signed URLs. The server never sees plaintext media — encryption keys are exchanged inside E2EE message payloads.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js + TypeScript |
| Framework | Express 5 |
| Database | PostgreSQL |
| Object storage | AWS S3 (pre-signed URLs) |
| Real-time | WebSockets (`ws`) |
| Auth | Passport.js (local + JWT), bcrypt |
| Push notifications | Firebase Admin SDK (FCM) |
| Monitoring | Prometheus (`prom-client`) |
| Logging | Pino (structured JSON) |
| WebRTC infra | TURN server with HMAC credential generation |

---

## API Overview

All endpoints are prefixed with `/foxtrot-api`. Auth via `Authorization: JWT <token>` header.

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/signup` | — | Register a new account |
| `POST` | `/login` | — | Authenticate and receive a JWT |
| `GET` | `/validateToken` | JWT | Validate current token |
| `POST` | `/sendMessage` | JWT | Send a message to a contact |
| `GET` | `/getConversations` | JWT | Fetch message history |
| `POST` | `/addContact` | JWT | Add a contact |
| `DELETE` | `/removeContact` | JWT | Remove a contact |
| `GET` | `/getContacts` | JWT | List contacts with online status and last seen |
| `GET` | `/searchUsers/:prefix` | JWT | Search users by phone number |
| `POST` | `/savePublicKey` | JWT | Store or rotate E2E public key (`force: true` to overwrite) |
| `POST` | `/registerPushNotifications` | JWT | Register FCM device token |
| `GET` | `/turnServerKey` | JWT | Get time-limited TURN credentials |
| `POST` | `/media/upload-url` | JWT | Generate pre-signed S3 upload URL |
| `POST` | `/media/download-url` | JWT | Generate pre-signed S3 download URL |
| `GET` | `/metrics` | Basic | Prometheus metrics |

### WebSocket

Connect to `/foxtrot-api/ws?token=<jwt>`.

**Client → Server:**

| Type | Description |
|---|---|
| `CALL_OFFER` | WebRTC SDP offer |
| `CALL_ANSWER` | WebRTC SDP answer |
| `CALL_ICE_CANDIDATE` | ICE candidate exchange |

**Server → Client:**

| Type | Description |
|---|---|
| `MSG` | New message from a contact |
| `CONTACT_STATUS` | Contact came online/offline (with `last_seen` timestamp) |
| `KEY_ROTATED` | Contact rotated their public key — re-derive session key |

The server maintains a 30-second heartbeat ping/pong to detect dead connections. A 5-second grace period prevents flapping when connections briefly drop (e.g. app backgrounding).

---

## Getting Started

### Prerequisites

- Node.js >= 18
- PostgreSQL
- Firebase project with Cloud Messaging enabled
- AWS S3 bucket for media storage
- (Optional) CoTURN or equivalent TURN server

### Setup

```bash
git clone https://github.com/reznik99/FoxTrot-BackEnd.git
cd FoxTrot-BackEnd
npm install
```

Create a `.env` file:

```env
PORT=1234
NODE_ENV=development

# PostgreSQL
DB_USER=postgres
DB_HOST=localhost
DB_DATABASE=foxtrot
DB_PASSWORD=your_password
DB_PORT=5432

# Auth
JWT_SECRET=your_jwt_secret

# S3 media storage
S3_BUCKET=your_bucket_name
S3_REGION=your_region
S3_ACCESS_KEY_ID=your_access_key
S3_SECRET_ACCESS_KEY=your_secret_key

# Monitoring
METRICS_PASSWORD=your_metrics_password

# WebRTC TURN server
TURN_SECRET=your_turn_shared_secret
TURN_TTL=3600

# Logging
LOG_LEVEL=debug
```

Place your Firebase Admin SDK credentials at the project root as `foxtrot-push-notifications-firebase-adminsdk.json`.

### Run

```bash
npm run build   # Compile TypeScript
npm start       # Start server

# Development
npm run lint    # Run ESLint
```

---

## Monitoring

Prometheus metrics are exposed at `/foxtrot-api/metrics` (HTTP Basic Auth).

| Metric | Type | Description |
|---|---|---|
| `foxtrot_api_requests_total` | Counter | Total API requests by path |
| `foxtrot_api_requests_errors_total` | Counter | Failed requests by path |
| `foxtrot_api_messages_total` | Counter | Messages proxied |
| `foxtrot_api_calls_total` | Counter | Calls proxied |
| `foxtrot_websockets_active` | Gauge | Active WebSocket connections |

---

## Security

- Passwords hashed with bcrypt (12 salt rounds)
- JWT tokens with 1-hour expiry
- Parameterized SQL queries throughout
- TURN credentials generated per-user via HMAC-SHA1 with configurable TTL
- Sender identity enforced server-side on all proxied WebSocket messages (prevents spoofing)
- Client-side E2E encryption — server stores and relays ciphertext only
- Media files encrypted client-side before upload; server issues pre-signed URLs but never handles plaintext
- Key rotation broadcast to contacts via WebSocket when a user updates their public key

---

## Related

- **Frontend** — [FoxTrot-FrontEnd](https://github.com/reznik99/FoxTrot-FrontEnd)
