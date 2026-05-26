# FoxTrot — Security Review

**Scope:** `1FoxTrot-BackEnd` (Node/Express/Postgres/WS) + `1FoxTrot-FrontEnd` (React Native, E2EE messenger).
**Date:** 2026-05-20
**Methodology:** Line-by-line audit of REST routes, WS signaling, auth middleware, crypto primitives, Keychain/MMKV/SQLCipher key storage, key-rotation flow, S3 pre-signed URL handling. Findings prioritized by real exploit cost, not theoreticals.

---

## Top 10 Findings

### 1. 🚨 CRITICAL — Identity private key, DB key, and MMKV key are NOT biometric/passcode-protected

**README claim:** *"Identity keys stored in device secure hardware via react-native-keychain, protected by biometric or device passcode."*

**Reality** — every cryptographic key that matters is stored with `AES_GCM_NO_AUTH` (no biometric/passcode prompt required):

- `src/store/actions/user.ts:115` — identity ECDH **private key**: `storage: AES_GCM_NO_AUTH`
- `src/global/keyImport.ts:57` — imported identity keypair: `AES_GCM_NO_AUTH`
- `src/global/database.ts:57` — SQLCipher DB key (decrypts all messages): `AES_GCM_NO_AUTH`
- `src/global/storage.ts:34` — MMKV encryption key: `AES_GCM_NO_AUTH`

The **only** thing protected behind `BIOMETRY_ANY_OR_DEVICE_PASSCODE` is the *cached login password / JWT* (`src/store/actions/auth.ts:43-44`). That's a UX convenience, not security — because the private key sits next to it, unprotected.

**Impact:** on any device where Keychain entries are extractable (root, ADB backup misconfig, debug builds, custom recovery), an attacker reads the identity private key + DB cipher key + MMKV key without ever triggering a biometric prompt. Then they decrypt SQLCipher, dump all messages, derive all session keys, and impersonate the user. The "biometric protection" advertised in the README is theatrical.

**Fix:** set `accessControl: BIOMETRY_ANY_OR_DEVICE_PASSCODE` and `storage: AES_GCM` (auth-required) on all three keychain writes. Update the README if any key must remain unauth'd.

---

### 2. 🚨 HIGH — `CALL_OFFER` allows ringing any user with no relationship check

`src/sockets.ts:93-102` — when an authenticated client sends a `CALL_OFFER`, the server proxies it to whatever `reciever_id` the sender chose. If the target is offline, it **also** sends a high-priority FCM push that triggers a full-screen incoming-call notification:

```ts
case 'CALL_OFFER': {
    const success = wsProxyMessage(ws, parsedData);
    if (!success) {
        webrtcCacheMessage(parsedData);
        sendPushNotificationForCall(parsedData);  // ring victim's phone
    }
}
```

No check that the caller is a contact, that the callee accepts calls from them, or that there's any rate limit. Combined with finding #3 (full enumeration of every phone number on the system), one attacker script can ring every user's phone repeatedly. Zero-cost weaponized DoS / harassment.

`/sendMessage` (`src/routes.ts:92-155`) has the same pattern — no `contacts`-table check before relaying a message and FCM-pushing it.

**Fix:** before proxying any CALL_* signaling or relaying a sendMessage, `SELECT 1 FROM contacts WHERE user_id = $1 AND contact_id = $2` (or require a mutual contact / accepted-call-request relationship). Add per-user rate limits to `CALL_OFFER` (e.g. 5/min/peer).

---

### 3. 🚨 HIGH — `/searchUsers/:prefix` enables wholesale phone-number enumeration

`src/routes.ts:242`:

```ts
'SELECT id, phone_no, public_key FROM users WHERE phone_no ILIKE $1 AND phone_no != $2 LIMIT 10'
[`${prefix}%`, user.phone_no]
```

Two problems:
- `ILIKE` is unsanitized — `prefix=%` matches **everything**, `prefix=_` matches every single-character phone, etc. SQL LIKE wildcards are passed through.
- Even without that, the `LIMIT 10` does not stop a recursive enumeration (`0`, `00`, `01`… `09`, …) — every authenticated user can dump the entire user directory in seconds.

The endpoint returns `id, phone_no, public_key` — i.e., enough to spam-call (finding #2), spam-message, or harvest the public keys of every user for offline analysis.

**Fix:** escape `%`/`_` in prefix (`prefix.replace(/[%_\\]/g, '\\$&')`), require a minimum prefix length (e.g. ≥6 digits), and rate-limit the endpoint per user.

---

### 4. 🚨 HIGH — `/media/download-url`: no ownership/recipient check

`src/routes.ts:349-373`:

```ts
const { objectKey } = req.body;
if (!objectKey || ... !objectKey.startsWith('media/')) { ... return; }
const result = await generateDownloadUrl(objectKey);
```

Any logged-in user can ask for a signed download URL for **any** `media/...` key. The server doesn't check that the requester sent the message that referenced this object or that they're the intended recipient. Confidentiality of media uploads reduces to *"the random UUID in the path is unguessable"* — a single accidental key leak (DB compromise, server log, S3 access-log mirror, etc.) and the entire historic media corpus is downloadable. The media is still per-file AES-GCM encrypted with a key in the E2EE payload — but for any media where that payload also leaks (or where the attacker has compromised the recipient), this becomes a one-step exfiltration endpoint. Defense in depth is absent.

**Fix:** add a `media_objects(object_key, owner_id, recipient_ids[])` table; on download, verify the requester is owner or in the recipient list. Tighten `S3_DOWNLOAD_EXPIRY` from 3600s to closer to 60-300s.

---

### 5. 🚨 HIGH — JWT in WebSocket URL query string

`src/sockets.ts:56` (server) and `src/global/websocketManager.ts:141` (client):

```
wss://francescogorini.com/foxtrot-api/ws?token=<JWT>
```

JWTs in URLs land in nginx/ALB access logs, the `pinoHttp` request logger (`src/index.ts:49`), any reverse-proxy log, CDN logs, browser history (irrelevant here, but the pattern travels). Tokens are valid for 1 hour and there is **no server-side revocation** (`/logout` doesn't even hit the server — `src/store/actions/auth.ts:103-110`), so anyone with read access to a log line can hijack the live session for up to an hour.

**Fix:** pass the JWT via `Sec-WebSocket-Protocol` (the `ws` client supports `new WebSocket(url, [`jwt.${token}`])`) or issue a short-lived single-use ticket via REST that the WS handshake consumes.

---

### 6. 🚨 HIGH — No rate limiting / no lockout on `/login`

`src/middlware/auth.ts` and `src/routes.ts:21` — bcrypt cost is 12 (~250 ms), which slows individual attempts, but there is *no* attempt counter, *no* IP throttle, *no* lockout. Distributed online brute-force against a known phone number is feasible. Same applies to `/signup` (free account creation → enables findings #2/#3/#4), `/sendMessage`, `/savePublicKey`, and `CALL_OFFER` signaling. The `express-rate-limit`/`express-slow-down` middlewares aren't installed.

**Fix:** install `express-rate-limit` with stricter buckets on `/login` and `/signup` (e.g. 10/hour/IP, 5/hour/phone_no) and lighter buckets on authenticated endpoints. Add a `failed_login_attempts` counter on the users row with exponential backoff.

---

### 7. 🚨 MEDIUM/HIGH — Contact-graph metadata leaks to FCM/Google

`src/routes.ts:135-145`:

```ts
notification: {
    title: `Message from ${user.phone_no}`,
    body: message.substring(0, 200),
    imageUrl: `https://robohash.org/${user.id}?size=150x150`,
},
```

The body is the base64 ciphertext (harmless), but the **title encodes the sender's phone number** and the **imageUrl is a 3rd-party request that ties user IDs to recipient devices via robohash.org**. Every offline message tells Google (a) who is messaging whom, (b) when, and (c) hits robohash with a stable identifier. Same in `src/sockets.ts:355-358` for calls.

For an app whose pitch is end-to-end encryption with privacy, this contact graph + timing metadata leak to Google + robohash defeats much of the point. Signal goes to extraordinary lengths (sealed sender, etc.) to avoid exactly this.

**Fix:** send a **data-only** FCM message (no `notification` object); have the client compose the visible notification locally after pulling the message from the server. Drop `imageUrl` to robohash; serve avatars from the FoxTrot backend or build them locally.

---

### 8. ⚠️ MEDIUM — No forward secrecy + no replay protection

`src/global/crypto.ts:51-77` — `generateSessionKeyECDH` produces a single AES-256-GCM key from `ECDH(my_priv, peer_pub)` and it is reused for every message in the conversation. The code comments acknowledge it (`GCM_RATCHET_V2 // TODO`).

Consequences if a private key ever leaks (and given finding #1, that's a lower bar than it should be):
- All past ciphertext stored in the SQLite DB *and* on the server is decryptable retroactively.
- All future messages until both sides rotate keys are decryptable.

Additionally, AES-GCM authenticates but doesn't bind to a sequence number or to the prior message — the server (or any intermediary) can **replay** an old ciphertext and `decrypt()` will happily return the same plaintext. No counter / Double-Ratchet means message re-ordering and replay produce no client-side warning.

**Fix:** implement the planned `GCM_RATCHET_V2` (Signal-style X3DH + Double Ratchet, or at minimum a symmetric KDF chain per message). Include a per-conversation monotonic counter inside the AAD so replays are caught.

---

### 9. ⚠️ MEDIUM — Key-rotation acceptance is not blocking; new session key applied before user verifies

`src/global/websocketManager.ts:359-365` + `src/store/reducers/user.ts:267-319` — when a `KEY_ROTATED` arrives:

1. The new public key is **immediately** stored.
2. A new session key is **immediately** derived via ECDH.
3. A system message is appended to the chat: *"X changed their security key. Verify their identity if this was unexpected."*

But there's no UI block, no "I trust this" confirmation, no greyed-out send button. The very next message the user types is already encrypted to the *new* (potentially attacker-controlled) public key. A user who taps past the notification or doesn't scroll up sees nothing — and the server (or any attacker holding `JWT_SECRET` / admin DB access) can substitute keys via `/savePublicKey` with `force: true` (`src/routes.ts:62-91`) on any account at any time. Signal's safety-numbers UX exists precisely to make this attack noisy; here it's quiet.

**Fix:** on `KEY_ROTATED`, mark the conversation as "unverified" and disable sending until the user explicitly taps "Trust new key" (showing the new fingerprint). Persist a per-contact `trusted_fingerprint` separate from the live `public_key`.

---

### 10. ⚠️ MEDIUM — JWT tokens are unrevocable; logout is client-only

`src/routes.ts:31-33` mints `expiresIn: 60 * 60` tokens. `src/middlware/auth.ts:64-75` validates them with `{ id, phone_no }` and looks up the user — but there's no `jti`, no token version on the user row, and `/logout` doesn't exist server-side at all (client `logOut` in `src/store/actions/auth.ts:104` just clears local state). If a token leaks (see finding #5) or a device is lost, the only mitigation is `JWT_SECRET` rotation, which logs out **every** user.

**Fix:** add a `token_version int` column to `users`, include it in the JWT payload, check it in the strategy, and bump it on logout / password reset. Or maintain a Redis denylist keyed by `jti`.

---

## Honorable Mentions

Worth fixing but lower severity / smaller blast radius:

- **`src/config/envConfig.ts:20`** — `JWT_SECRET: process.env.JWT_SECRET || ''` falls back to empty string. The startup check at `src/index.ts:20-22` catches it today, but the `|| ''` is a footgun if the check is ever moved.
- **`src/routes.ts:298-308`** — the `devices` map caches FCM tokens forever in-memory with no invalidation on `/registerPushNotifications` update from the same user → stale tokens persist across token rotations.
- **`src/sockets.ts:158-160`** — `wsParseMessage` only coerces `reciever_id` to Number; other fields are trusted from JSON. Sender info is overridden in the live proxy path (good), but `sendPushNotificationForCall` reads `parsedData.data.sender_id` from the cached payload *before* the override happens → cached push notifications can show attacker-chosen sender details on the recipient's lockscreen.
- **`src/storage.ts:48-58`** — pre-signed download URLs default to **1-hour expiry** (`S3_DOWNLOAD_EXPIRY=3600`). For E2EE media the URL itself is not sensitive, but combined with finding #4 this widens the exposure window.
- **`src/global/database.ts:280`** — `dbSaveConversation` writes the *phone number* as the conversation `id` column; if a user ever changes their phone number (or it's re-registered by a different person), the local conversation index breaks — a privacy-regression waiting to happen.
- **`src/global/crypto.ts:264-301`** — `extractVersioningFromMessage` heuristically infers the protocol version from separator count and IV length when no version prefix is present. A crafted ciphertext could be routed to the wrong decrypt path; today both paths terminate in authenticated AES, but this is fragile parsing — version-prefix every message and reject anything else.
- **`src/global/keyExport.ts`** — exported key file is `Foxtrot encrypted keys\n<iter>\n<salt>\n<iv>\n<ciphertext>`. PBKDF2-SHA256 with 250k iterations is on the low end for 2026 (Argon2id would be the modern choice). Also the file is written to `RNFS.DownloadDirectoryPath`, which on Android is world-readable by other apps with storage permission.
- **`src/routes.ts:140`** — `imageUrl: \`https://robohash.org/${user.id}?size=150x150\`` in the notification payload sends user IDs to a third party every time an offline user receives a message.

---

## Suggested Fix Priority

| # | Finding | Effort | Why this order |
|---|---|---|---|
| 1 | Keychain `accessControl` on identity key + DB key + MMKV key | Small | This is the finding that most directly contradicts the security pitch. Fix it first. |
| 2 | `/sendMessage` + `CALL_OFFER` contact check, `/searchUsers` sanitization, rate limiting (#2 + #3 + #6 together) | Medium | Kills the trivial harassment/enumeration story in one pass. |
| 3 | Move WS JWT off the query string (#5) + add `jti` / `token_version` revocation (#10) | Small | Tokens stop being free-flowing in logs and can be revoked. |
| 4 | Add ACL on `/media/download-url` (#4) | Small | The message that referenced an objectKey was sent to *someone specific*; verify that's the requester. |
| 5 | Land `GCM_RATCHET_V2` (#8) + harden key-rotation UX (#9) | Large | Long-term cryptographic improvements; require the rest to be solid first. |

---

## What I Didn't Find

For completeness — these were checked and are OK:

- **SQL injection** — all queries are parameterized (`$1`/`$2`). The `ILIKE` pattern issue in #3 is a logic flaw, not injection.
- **bcrypt cost** — 12 rounds is fine for 2026.
- **AES-GCM nonce reuse** — IVs are 12 random bytes per message; with a single static session key, collision probability remains negligible until ~2³² messages between the same pair.
- **WebRTC media plane** — DTLS-SRTP is enabled by react-native-webrtc defaults; ICE/TURN credentials are time-limited via HMAC. Standard for WebRTC.
- **CORS / clickjacking** — the API is consumed only by the React Native client; no browser surface to defend.
