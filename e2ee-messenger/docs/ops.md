# Operations Guide

## Prerequisites

- Node.js >= 20.0.0
- npm >= 9.0.0

## Local Development

### 1. Install dependencies

```bash
cd e2ee-messenger
npm install
```

### 2. Start the server

```bash
npm run dev:server
```

The server starts on `http://localhost:3001` with:
- REST API for rendezvous, relay, and signaling
- WebSocket on `ws://localhost:3001/ws`
- SQLite database at `apps/server/data/messenger.db`

### 3. Start the web app

```bash
npm run dev:web
```

The web app starts on `http://localhost:3000`.

### 4. Start both together

```bash
npm run dev
```

## Running Tests

```bash
# All tests
npm test

# Crypto package tests only
npm run test:crypto

# Server tests only
npm run test:server
```

## Building for Production

```bash
npm run build
```

## Server Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DB_PATH` | `apps/server/data/messenger.db` | SQLite database path |
| `ALLOWED_ORIGIN` | `http://localhost:3000` | CORS allowed origin |

## Web App Configuration

Environment variables (in `.env.local`):

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_SERVER_URL` | `http://localhost:3001` | Server API URL |

## Database

The server uses SQLite (via better-sqlite3) for the MVP. Tables:

- `attestations` - Identity attestation statements
- `signed_prekeys` - X3DH signed pre-keys
- `onetime_prekeys` - X3DH one-time pre-keys (consumed on fetch)
- `revocations` - Device revocation statements
- `relay_messages` - Encrypted relay messages (store-and-forward)
- `signaling` - WebRTC signaling messages (ephemeral)

### Automatic Cleanup

The server runs periodic cleanup every 60 seconds:
- Expired relay messages (past TTL) are deleted
- Signaling messages older than 5 minutes are deleted

### Database Migration

For the MVP, the schema is auto-created on first run. For production, implement a proper migration system.

## Deployment

### Server

1. Build: `npm run build -w apps/server`
2. Run: `node apps/server/dist/index.js`
3. Use a reverse proxy (nginx, Caddy) with TLS termination
4. Set `ALLOWED_ORIGIN` to your web app domain

### Web App

1. Build: `npm run build -w apps/web`
2. Deploy as a static site or use `next start`
3. Set `NEXT_PUBLIC_SERVER_URL` to your server URL

### Docker (future)

A Dockerfile for the server and web app is a natural next step.

## STUN/TURN Configuration

For WebRTC P2P connections across NATs:

- STUN: Use public STUN servers (e.g., `stun:stun.l.google.com:19302`) or deploy your own
- TURN: Deploy coturn or use a hosted TURN service for relay when direct P2P fails

Configure in the web app's WebRTC setup.

## Monitoring

- `GET /health` returns server status
- Monitor WebSocket connection count via server logs
- Monitor database size and relay message queue depth

## Security Hardening for Production

See [threat-model.md](./threat-model.md) for the full checklist. Key items:

1. **TLS everywhere** - Never run without HTTPS/WSS in production
2. **Rate limiting** - Already configured, tune thresholds
3. **Database encryption** - Use SQLCipher for encrypted SQLite
4. **Log sanitization** - Sensitive data is already excluded from logs
5. **Reverse proxy** - Hide server behind nginx/Caddy
6. **Tor hidden service** - For metadata-resistant access
7. **Backup** - Database backups (only public data, all messages are encrypted)
