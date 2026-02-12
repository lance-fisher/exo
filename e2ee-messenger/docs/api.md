# API Specification

## Base URL

```
http://localhost:3001
```

## Authentication

The server does not authenticate clients by design. It is a zero-trust relay:
- It stores only encrypted blobs and public attestations
- It cannot read message contents
- Client authentication happens at the cryptographic layer (PGP signatures, X3DH, Double Ratchet)

Rate limiting is applied to prevent abuse.

---

## Rendezvous Service

### POST /rendezvous/publish

Publish identity attestation and pre-keys for discovery.

**Request Body:**
```json
{
  "attestation": {
    "version": 1,
    "pgpFingerprint": "abcd1234...",
    "messagingIdentityPublicKey": "<base64>",
    "deviceId": "device-xxxx",
    "timestamp": 1700000000000,
    "pgpSignature": "-----BEGIN PGP SIGNATURE-----\n...\n-----END PGP SIGNATURE-----"
  },
  "signedPreKey": {
    "keyId": 0,
    "publicKey": "<base64>",
    "signature": "<base64>",
    "timestamp": 1700000000000
  },
  "oneTimePreKeys": [
    { "keyId": 0, "publicKey": "<base64>" },
    { "keyId": 1, "publicKey": "<base64>" }
  ]
}
```

**Response:** `200 OK`
```json
{ "success": true }
```

**Rate Limit:** 10 requests/minute

---

### GET /rendezvous/lookup/:fingerprint

Fetch identity attestation and pre-key bundle for a PGP fingerprint.

One one-time pre-key is consumed per request (deleted from server after fetch).

**Response:** `200 OK`
```json
{
  "fingerprint": "abcd1234...",
  "devices": [
    {
      "attestation": {
        "version": 1,
        "pgpFingerprint": "abcd1234...",
        "messagingIdentityPublicKey": "<base64>",
        "deviceId": "device-xxxx",
        "timestamp": 1700000000000,
        "pgpSignature": "..."
      },
      "signedPreKey": {
        "keyId": 0,
        "publicKey": "<base64>",
        "signature": "<base64>",
        "timestamp": 1700000000000
      },
      "oneTimePreKey": {
        "keyId": 0,
        "publicKey": "<base64>"
      }
    }
  ]
}
```

**Response:** `404 Not Found` if fingerprint not registered.

---

### POST /rendezvous/revoke

Publish a signed device revocation.

**Request Body:**
```json
{
  "revocation": {
    "version": 1,
    "pgpFingerprint": "abcd1234...",
    "revokedDeviceId": "device-xxxx",
    "timestamp": 1700000000000,
    "pgpSignature": "..."
  }
}
```

**Response:** `200 OK`
```json
{ "success": true }
```

---

## Relay Service

### POST /relay/send

Store an encrypted message blob for a recipient.

**Request Body:**
```json
{
  "recipientFingerprint": "abcd1234...",
  "recipientDeviceId": "device-xxxx",
  "senderFingerprint": "efgh5678...",
  "encryptedPayload": "<base64 encrypted blob>",
  "ttl": 604800
}
```

**Constraints:**
- Max payload size: 64KB
- Max stored messages per recipient: 1000
- Default TTL: 7 days (604800 seconds)

**Response:** `200 OK`
```json
{ "success": true }
```

**Error Responses:**
- `413`: Payload too large
- `429`: Recipient mailbox full

---

### GET /relay/fetch/:fingerprint/:deviceId

Fetch pending encrypted messages. Messages are marked as fetched (won't be returned again).

**Response:** `200 OK`
```json
{
  "messages": [
    {
      "id": 1,
      "senderFingerprint": "efgh5678...",
      "encryptedPayload": "<base64>",
      "timestamp": 1700000000
    }
  ]
}
```

---

### DELETE /relay/ack

Permanently delete fetched messages.

**Request Body:**
```json
{
  "messageIds": [1, 2, 3]
}
```

**Response:** `200 OK`
```json
{ "success": true }
```

---

## Signaling Service

### POST /signaling/send

Send a WebRTC signaling message.

**Request Body:**
```json
{
  "recipientFingerprint": "abcd1234...",
  "recipientDeviceId": "device-xxxx",
  "senderFingerprint": "efgh5678...",
  "senderDeviceId": "device-yyyy",
  "signalType": "offer",
  "payload": "{\"sdp\": \"...\"}"
}
```

**Valid signalType values:** `offer`, `answer`, `ice-candidate`

**Response:** `200 OK`

---

### GET /signaling/poll/:fingerprint/:deviceId

Poll for pending signaling messages. Messages are deleted after retrieval.

**Response:** `200 OK`
```json
{
  "signals": [
    {
      "senderFingerprint": "efgh5678...",
      "senderDeviceId": "device-yyyy",
      "signalType": "offer",
      "payload": { "sdp": "..." },
      "timestamp": 1700000000
    }
  ]
}
```

---

## WebSocket

### Connection

```
ws://localhost:3001/ws
```

### Registration

After connecting, send:
```json
{ "type": "register", "fingerprint": "abcd1234...", "deviceId": "device-xxxx" }
```

### Real-time Signaling

Send signaling messages through WebSocket for lower latency:
```json
{
  "type": "signal",
  "recipientFingerprint": "...",
  "recipientDeviceId": "...",
  "senderFingerprint": "...",
  "senderDeviceId": "...",
  "signalType": "offer",
  "payload": { "sdp": "..." }
}
```

### Relay Notifications

Notify a recipient that a new relay message is available:
```json
{
  "type": "relay-notify",
  "recipientFingerprint": "...",
  "recipientDeviceId": "...",
  "senderFingerprint": "..."
}
```

---

## Health Check

### GET /health

```json
{ "status": "ok", "timestamp": 1700000000000 }
```

---

## Metadata Exposure

The server necessarily sees:
- IP addresses of connecting clients
- PGP fingerprints (public identifiers)
- Device IDs
- Message sizes and timing
- Which fingerprints communicate with which

The server **cannot** see:
- Message contents (encrypted end-to-end)
- Private keys
- Plaintext of any kind

See [threat-model.md](./threat-model.md) for full analysis.
