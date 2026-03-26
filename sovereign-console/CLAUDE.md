# Sovereign Operator Console — Claude Code Instructions

## Project Overview

Single-operator development control plane. Three components: a VPS-hosted broker (Fastify + PostgreSQL + Redis), a browser-based console UI (React + Vite), and a local Windows agent that runs alongside Claude Code. All traffic is encrypted; writes require explicit operator approval tokens.

## Development Commands

```bash
# Broker
cd broker && npm run dev          # Start dev server with hot reload (tsx watch)
cd broker && npm run build        # TypeScript compile
cd broker && npm run migrate      # Run database migrations
cd broker && npm run typecheck    # Type-check without emitting

# Console UI
cd console-ui && npm run dev      # Vite dev server
cd console-ui && npm run build    # Production build

# Local Agent (on Windows)
cd local-agent && npm run dev     # Dev mode
cd local-agent && npm run build   # Compile

# Tests
npx vitest                        # Run all tests
npx vitest tests/broker           # Broker tests only
npx vitest tests/agent            # Agent tests only
npx vitest tests/e2e              # E2E tests
npx vitest --watch                # Watch mode
```

## Architecture Summary

```
 [Console UI]  ──HTTPS──▶  [Broker (VPS)]  ◀──mTLS/WSS──  [Local Agent (Windows)]
   React/Vite               Fastify            Node.js + Claude Code CLI
                            PostgreSQL
                            Redis
```

- **Broker**: Internet-facing. Handles auth (passkey + TOTP), device trust, approval tokens, audit log, agent relay via WebSocket. Runs in Docker on Hostinger VPS.
- **Console UI**: SPA served by the broker or separate container. Communicates solely via broker API.
- **Local Agent**: Runs on the operator's Windows machine. Connects to broker over mTLS WebSocket. Executes file operations and Claude Code tasks within a governed scope.

## Key Decisions

- **Single operator**: No multi-user RBAC. One human, two enrolled devices max.
- **Passkey-first auth**: WebAuthn/FIDO2 for primary login; TOTP for step-up (writes, dangerous ops).
- **Approval tokens**: Every write operation requires a single-use, time-limited token bound to device + session + payload hash.
- **Append-only audit log**: SHA-256 hash chain in PostgreSQL. No UPDATE or DELETE on audit_log table.
- **Secret redaction**: Agent redacts secrets (API keys, passwords, private keys, .env values) before sending content to the broker/UI.
- **Command queue with reconfirmation**: If the agent is offline when a command is issued, it queues and requires operator reconfirmation on reconnect.
- **mTLS for agent ↔ broker**: Mutual TLS with custom CA. Agent cert is validated on every WebSocket connection.

## File Structure

```
sovereign-console/
├── broker/               # VPS server
│   ├── src/
│   │   ├── auth/         # Passkey + session logic
│   │   ├── totp/         # TOTP step-up
│   │   ├── device-trust/ # Device enrollment & verification
│   │   ├── approval/     # Approval token lifecycle
│   │   ├── audit/        # Hash-chained audit log
│   │   ├── agent-relay/  # WebSocket relay to agent
│   │   ├── passkey/      # WebAuthn registration/verification
│   │   ├── routes/       # Fastify route handlers
│   │   ├── middleware/    # Auth guards, rate limiting
│   │   ├── db/           # PostgreSQL connection & migrations
│   │   └── types/        # Shared TypeScript types
│   └── package.json
├── console-ui/           # Browser SPA
├── local-agent/          # Windows agent
│   └── src/
│       ├── governance/   # Path scope, protected paths, rate limits
│       ├── services/     # File ops, Claude integration, secret redaction
│       └── types/
├── tests/
│   ├── broker/           # Auth, device trust, approval, audit tests
│   ├── agent/            # Governance, file ops, redaction, Claude, queue tests
│   └── e2e/              # Full-flow integration tests
├── scripts/              # Setup and maintenance scripts
└── docs/                 # Architecture and design documents
```

## Security Notes

- Never commit `.env` files, private keys, or secrets to version control.
- The audit log hash chain must be verified before every backup (see `scripts/backup-audit-logs.sh`).
- Approval tokens are single-use and bound to `(device_id, session_id, payload_hash)`.
- Protected path patterns (`.env`, `*.key`, `*.pem`, `credentials.json`, etc.) cannot be written to by the agent regardless of approval tokens.
- Path traversal (`../`, `..\`) is blocked at the governance layer before any file operation.
- Symlinks and junctions are resolved and checked against the project scope before access.
- The agent enforces a file size read limit (1 MB) and write allowlist by extension.
- Rate limiting is per-session (60 ops/min) and per-IP at the NGINX layer (10 req/s).
- Emergency disable revokes all sessions and blocks all authentication instantly.
