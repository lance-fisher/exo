# Sovereign Operator Console

A single-operator development control plane for managing Claude Code tasks, file operations, and deployments through an authenticated, audited, approval-gated workflow.

## Architecture

```
 Browser (Console UI)            VPS (Broker)                  Windows (Local Agent)
 ┌──────────────────┐    HTTPS   ┌──────────────────┐  mTLS/WSS  ┌──────────────────┐
 │  React + Vite    │──────────▶ │  Fastify API     │◀───────── │  Node.js         │
 │  Passkey auth    │            │  PostgreSQL      │            │  Claude Code CLI │
 │  Approval UI     │            │  Redis           │            │  File governance │
 └──────────────────┘            │  Audit log       │            │  Secret redaction│
                                 └──────────────────┘            └──────────────────┘
```

## Components

### Broker (VPS)
Internet-facing server running on Hostinger VPS (Ubuntu 22.04, Docker). Handles authentication (passkey + TOTP), device trust, approval token lifecycle, append-only audit logging, and WebSocket relay to the local agent.

### Console UI (Browser)
React single-page application. Provides the operator interface for browsing project files, reviewing diffs, approving writes, submitting Claude Code tasks, and viewing audit logs. Authenticates via WebAuthn passkeys.

### Local Agent (Windows)
Runs on the operator's development machine. Connects to the broker over mutual TLS. Executes governed file operations and Claude Code tasks within a sandboxed project scope. Redacts secrets before transmitting content.

## Prerequisites

- **Broker VPS**: Ubuntu 22.04+, Docker, 2GB+ RAM, public IP with DNS
- **Local machine**: Windows 10/11, Node.js 20+, Claude Code CLI
- **Domain**: DNS A record pointing to VPS IP (e.g., `ops.lancewfisher.com`)

## Quick Start

### 1. Set up the broker

```bash
# On your VPS
git clone <repo> && cd sovereign-console
sudo bash scripts/setup-broker.sh
```

This installs Docker, NGINX, Certbot, generates secrets, configures the firewall, and starts all services.

### 2. Generate mTLS certificates

```bash
bash scripts/generate-certs.sh ./certs
# Copy agent certs to your Windows machine
```

### 3. Set up the local agent

```powershell
# On your Windows machine (PowerShell as Administrator)
.\scripts\setup-agent.ps1 -BrokerUrl "https://ops.lancewfisher.com"
```

### 4. Enroll your device

Visit `https://ops.lancewfisher.com` and follow the device enrollment flow. Register a passkey and (optionally) configure TOTP for step-up authentication.

## Security Model

| Layer | Mechanism |
|---|---|
| **Authentication** | WebAuthn/FIDO2 passkeys (primary), TOTP (step-up for writes) |
| **Device trust** | Enrollment registry, max 2 devices, challenge-response verification |
| **Transport** | HTTPS (browser ↔ broker), mTLS over WSS (agent ↔ broker) |
| **Authorization** | Single-use approval tokens bound to device + session + payload hash |
| **File governance** | Project scope enforcement, protected path patterns, extension allowlist |
| **Secret protection** | Automatic redaction of API keys, passwords, tokens, private keys, .env values |
| **Audit** | Append-only SHA-256 hash-chained log in PostgreSQL |
| **Rate limiting** | Per-session (60 ops/min), per-IP (NGINX 10 req/s), TOTP lockout after 5 failures |
| **Emergency** | One-click disable revokes all sessions and blocks all auth |

## Documentation

| Document | Location |
|---|---|
| Architecture design | `docs/` |
| Claude Code instructions | `CLAUDE.md` |
| Broker setup | `scripts/setup-broker.sh` |
| Certificate generation | `scripts/generate-certs.sh` |
| Agent setup (Windows) | `scripts/setup-agent.ps1` |
| Audit log backup | `scripts/backup-audit-logs.sh` |
| Test suites | `tests/` |

## Development

```bash
# Run all tests
npx vitest

# Type-check
cd broker && npm run typecheck

# Dev servers
cd broker && npm run dev        # API on :3100
cd console-ui && npm run dev    # UI on :5173
```

## License

Private. All rights reserved.
