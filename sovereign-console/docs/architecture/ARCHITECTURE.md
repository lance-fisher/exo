# Sovereign Operator Console - System Architecture

## Overview

The Sovereign Operator Console is a single-operator remote administration system that allows one authenticated human to issue tasks to a local development agent running Claude Code on a Windows workstation. The system is designed for **one operator, two devices** (Windows laptop + iPhone), with defense-in-depth security and full audit logging.

## 5-Tier Model

```
Tier 1: GUI Layer         - Next.js console UI (ops.lancewfisher.com)
Tier 2: Broker Layer      - Fastify API + WebSocket relay (same VPS)
Tier 3: Local Agent        - Node.js Windows service (workstation)
Tier 4: Device Trust       - mTLS, enrolled device registry, client certs
Tier 5: Passkey/TOTP       - WebAuthn passkeys, TOTP step-up auth
```

Each tier enforces its own authorization checks. A request must pass **all** tiers to execute.

## Component Diagram

```
                        +-----------------------+
                        |    ops.lancewfisher.com|
                        |                       |
    Operator            |  +------------------+ |
    (Browser/iPhone)    |  |  Console UI      | |
         |              |  |  (Next.js/Docker)| |
         | HTTPS        |  +--------+---------+ |
         v              |           |            |
    +----+----+         |           | HTTP/WS    |
    |  NGINX  |---------+           |            |
    | reverse |         |  +--------v---------+ |
    | proxy   |         |  |  Broker           | |
    | (TLS)   |         |  |  (Fastify/Docker) | |
    +---------+         |  +--+-----+-----+---+ |
                        |     |     |     |      |
                        |     |     |     |      |
                        |  +--v-+ +-v--+ +v---+ |
                        |  |PG  | |Redis| |Audit| |
                        |  |    | |     | |Logs | |
                        |  +----+ +-----+ +----+ |
                        +-----------+-------------+
                                    |
                                    | WebSocket (mTLS)
                                    | outbound from agent
                                    |
                        +-----------v-------------+
                        |  Windows Workstation     |
                        |                          |
                        |  +--------------------+  |
                        |  | Local Agent        |  |
                        |  | (WinSW service)    |  |
                        |  +--------+-----------+  |
                        |           |              |
                        |           | subprocess   |
                        |           v              |
                        |  +--------+-----------+  |
                        |  | claude --print     |  |
                        |  | (per-task process) |  |
                        |  +--------------------+  |
                        +--------------------------+
```

## Trust Boundaries

| Boundary | Crossing | Protection |
|---|---|---|
| Internet to NGINX | External HTTP | TLS 1.3, rate limiting, HSTS |
| NGINX to Console UI | Docker network | Localhost-only binding |
| NGINX to Broker | Docker network | Localhost-only binding |
| Browser to Broker API | Authenticated API | Passkey session + CSRF token |
| Broker to PostgreSQL | Docker network | DB credentials, role-based access |
| Broker to Agent | Internet/WebSocket | Mutual TLS, enrolled device cert |
| Agent to Claude Code | Local subprocess | OS-level process isolation, capped resources |
| iPhone to Broker | Internet/HTTPS | Passkey + device attestation |

## Data Flow

### Task Execution Flow

```
1. Operator opens Console UI in browser
2. Operator authenticates via WebAuthn passkey
3. Broker issues session token (short-lived, device-bound)
4. Operator submits task via UI
5. Console UI → POST /api/tasks → Broker
6. Broker validates session, checks rate limits
7. For write/delete/execute: Broker creates approval token, sends push to iPhone
8. Operator approves on iPhone (passkey + device attestation)
9. Broker receives signed approval, validates device_id + signature
10. Broker forwards task to Agent via WebSocket
11. Agent assembles context (project manifest, relevant files, token budget)
12. Agent spawns: claude --print --context <assembled_context> "<task>"
13. Claude Code executes, produces output
14. Agent captures stdout/stderr, exit code
15. Agent sends result back to Broker via WebSocket
16. Broker stores result, updates audit log
17. Console UI receives result via WebSocket push or polling
18. Operator reviews result in UI
```

### Read-Only Flow (No Approval Required)

```
1-3. Same authentication as above
4. Operator requests file listing, status, or read-only query
5. Console UI → GET /api/... → Broker
6. Broker validates session
7. Broker forwards to Agent
8. Agent responds with data (no Claude Code invocation needed for simple reads)
9. Response flows back through Broker to UI
```

## Authentication Flow

### Device Enrollment

```
1. Operator accesses enrollment endpoint (time-limited, single-use invite link)
2. Operator registers WebAuthn passkey (platform authenticator)
3. Broker verifies attestation (TPM on Windows, Secure Enclave on iPhone)
4. Broker stores credential in enrolled device registry
5. For agent device: broker issues client certificate for mTLS
6. For iPhone: broker stores device fingerprint for approval validation
7. TOTP secret provisioned via QR code on same device
8. Enrollment link invalidated
9. Full audit log entry created
```

### Authentication → Session

```
1. Operator navigates to ops.lancewfisher.com
2. UI initiates WebAuthn authentication ceremony
3. Operator performs biometric/PIN on device
4. Authenticator signs challenge with private key
5. Broker validates assertion against enrolled credential
6. Broker issues session:
   - session_id (UUID)
   - device_id binding
   - 30-minute expiry (configurable)
   - stored in HttpOnly, Secure, SameSite=Strict cookie
7. Session renewal: automatic on activity, requires re-auth after max lifetime (8 hours)
```

### Step-Up Authentication

```
Triggered by: write ops, delete ops, execute ops, sensitive config changes

1. Broker determines step-up required based on action_type
2. Broker sends approval request to iPhone via push / WebSocket
3. Operator opens approval on iPhone
4. iPhone presents action details for review
5. Operator confirms with passkey (biometric) + TOTP code
6. iPhone sends signed approval response to Broker
7. Broker validates: device_id, signature, TOTP, approval token match
8. Action proceeds
```

## Architecture Choice: Separate Subdomain on Hostinger VPS

**Decision**: Deploy the Broker and Console UI on a Hostinger VPS at `ops.lancewfisher.com`, served via NGINX reverse proxy with Docker containers.

### Why This Approach

1. **Best isolation**: The operator console is completely separate from any public-facing sites. No shared hosting, no shared process space, no shared routing.

2. **Separate TLS certificate**: `ops.lancewfisher.com` gets its own Let's Encrypt certificate. No wildcard cert sharing, no SNI-based routing to the wrong backend.

3. **No accidental public route exposure**: The console never shares an NGINX config with a marketing site, blog, or API. There is zero chance a misconfigured `location` block exposes the console publicly.

4. **Clean CORS policy**: Origin is `https://ops.lancewfisher.com` and nothing else. No complicated CORS allow-lists. No `Access-Control-Allow-Origin: *` anywhere.

5. **Cost-effective**: Hostinger VPS plans provide sufficient compute (2+ vCPU, 2+ GB RAM) at low cost for a single-operator system.

6. **Full control**: Root SSH access, custom firewall rules, custom NGINX config, Docker runtime — no platform restrictions.

## Broker: Node.js/TypeScript + Fastify

- **Runtime**: Node.js 20 LTS
- **Framework**: Fastify (chosen for performance, schema validation, plugin ecosystem)
- **Database**: PostgreSQL 16 (sessions, audit logs, device registry, approval tokens)
- **Queue**: Redis 7 (task queue, rate limiting counters, pub/sub for WebSocket relay)
- **WebSocket**: Fastify WebSocket plugin for both UI push and agent connection
- **Auth**: @simplewebauthn/server for WebAuthn, otplib for TOTP

## Console UI: Next.js + Tailwind CSS

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS with dark theme as default and only theme
- **State**: React Query for server state, Zustand for UI state
- **WebSocket**: Native WebSocket for real-time task updates
- **Auth UI**: WebAuthn browser API integration
- **Deployment**: Docker container, served by NGINX

## Local Agent: Node.js/TypeScript + WinSW

- **Runtime**: Node.js 20 LTS
- **Service wrapper**: WinSW (XML config, auto-restart, log rotation)
- **Connection**: Outbound WebSocket to `wss://ops.lancewfisher.com/agent/ws`
- **mTLS**: Client certificate issued during enrollment, validated by broker
- **Claude Code**: Subprocess invocation via `claude --print`
- **File access**: Scoped to configured project directories only

## Claude Code Invocation: Subprocess Per Task

**Chosen approach**: Spawn a new `claude` process for each task using `--print` flag.

**Rationale**:
- **Stateless**: Each task gets a clean environment. No leaked context between tasks.
- **Predictable**: Process lifecycle is clear — start, execute, capture output, exit.
- **No session persistence dependency**: The Claude Code CLI's interactive session is not designed for long-running automation. Relying on it introduces fragility.
- **Full toolchain preserved**: `--print` mode still has access to file read/write, search, and other tools.
- **Clean context**: Each task gets exactly the context the agent assembles — no stale conversation history.
- **Resource isolation**: OS-level process boundaries. A hung task can be killed without affecting the agent.

See [ADR-002](adr/002-claude-code-invocation-model.md) for full option analysis.

## Agent Offline Policy

When the agent is disconnected from the broker:

1. **Queue with TTL**: Tasks are queued at the broker with a default TTL of 5 minutes.
2. **Reject after TTL**: If the agent does not reconnect within TTL, the task is marked `expired` and the operator is notified.
3. **Reconfirm on reconnect**: When the agent reconnects, any queued tasks require explicit operator re-confirmation before execution. Tasks are never auto-executed after a disconnection.

See [ADR-004](adr/004-agent-offline-policy.md) for rationale.

## Mutual TLS: Agent to Broker

The agent-to-broker WebSocket channel requires mutual TLS:

- **Broker**: Presents its server certificate (Let's Encrypt for `ops.lancewfisher.com`)
- **Agent**: Presents a client certificate issued during device enrollment
- **Broker validates**: Client cert signature, expiry, and that the cert fingerprint matches the enrolled device registry
- **Revocation**: Broker maintains a revocation list. Revoked certs are rejected immediately.
- **Renewal**: Client certs have 90-day expiry. Agent requests renewal before expiry; broker issues new cert after passkey verification.

## Audit Logs

All operations are recorded in an append-only PostgreSQL table with cryptographic hash chaining:

- **Hash chain**: Each entry includes `prev_hash = SHA-256(previous_entry.id + previous_entry.event + previous_entry.timestamp + previous_entry.prev_hash)`
- **Immutability**: Database roles for agent and broker have INSERT-only permission on the audit table. No UPDATE or DELETE grants.
- **Integrity verification**: Hourly job walks the hash chain and alerts on any discontinuity.
- **Export**: Daily encrypted backup to S3-compatible storage or local encrypted archive.

See [AUDIT_LOG_INTEGRITY.md](AUDIT_LOG_INTEGRITY.md) and [ADR-005](adr/005-audit-log-integrity.md) for details.
