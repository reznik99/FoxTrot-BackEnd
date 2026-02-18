<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node">
  <img src="https://img.shields.io/badge/typescript-5.x-blue" alt="TypeScript">
  <img src="https://img.shields.io/badge/express-5.x-lightgrey" alt="Express">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
</p>

# FoxTrot Backend

Backend server for [FoxTrot](https://github.com/reznik99/FoxTrot-Front-End) — a secure, real-time messaging and calling application with end-to-end encryption and WebRTC voice/video calls.

This service handles user authentication, message routing, WebRTC signaling, push notifications, and contact management. Messages are delivered in real-time over WebSockets when users are online, and fall back to Firebase Cloud Messaging (FCM) push notifications when they're not.

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
└──────────────┘         │           └──────────┘  └──────────────┘     │
                         └──────────────────────────────────────────────┘
```

### Message Flow

1. **Online delivery** — Messages sent via REST are persisted in PostgreSQL, then proxied directly to the recipient's WebSocket connection.
2. **Offline delivery** — If the recipient is offline, an FCM push notification is dispatched. Messages are retrieved from the database when the client reconnects.
3. **Call signaling** — WebRTC offers, answers, and ICE candidates are relayed via WebSocket. When a callee is briefly offline, signaling data is cached for up to 90 seconds and replayed on reconnect.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js + TypeScript |
| Framework | Express 5 |
| Database | PostgreSQL |
| Real-time | WebSockets (`ws`) |
| Auth | Passport.js (local + JWT), bcrypt |
| Push notifications | Firebase Admin SDK (FCM) |
| Monitoring | Prometheus (`prom-client`) |
| Logging | Pino (structured JSON) |
| WebRTC infra | TURN server with HMAC credential generation |

---

## API Overview

All endpoints are prefixed with `/foxtrot-api`.

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/signup` | — | Register a new account |
| `POST` | `/login` | — | Authenticate and receive a JWT |
| `GET` | `/validateToken` | JWT | Validate current token |
| `POST` | `/sendMessage` | JWT | Send a message to a contact |
| `GET` | `/getConversations` | JWT | Fetch message history |
| `POST` | `/addContact` | JWT | Add a contact |
| `DELETE` | `/removeContact` | JWT | Remove a contact |
| `GET` | `/getContacts` | JWT | List contacts with online status |
| `GET` | `/searchUsers/:prefix` | JWT | Search users by phone number |
| `POST` | `/savePublicKey` | JWT | Store E2E encryption public key |
| `POST` | `/registerPushNotifications` | JWT | Register FCM device token |
| `GET` | `/turnServerKey` | JWT | Get TURN server credentials |
| `GET` | `/metrics` | Basic | Prometheus metrics |

### WebSocket

Connect to `/foxtrot-api/ws?token=<jwt>`. Supported message types:

- `MSG` — Text message
- `CALL_OFFER` — WebRTC SDP offer
- `CALL_ANSWER` — WebRTC SDP answer
- `CALL_ICE_CANDIDATE` — ICE candidate exchange

---

## Getting Started

### Prerequisites

- Node.js >= 18
- PostgreSQL
- Firebase project with Cloud Messaging enabled
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
- TURN credentials generated per-user via HMAC-SHA1
- Client-side E2E encryption supported via public key exchange
- Sender identity enforced server-side on all proxied messages

---

## Related

- **Frontend** — [FoxTrot-Front-End](https://github.com/reznik99/FoxTrot-Front-End)
