# Operator Guide

> **Governance**: This document defers to the root governance rules at `D:\ProjectsHome\CLAUDE.md`. All security, credential handling, and operational policies defined there take precedence over any guidance in this document.

## Overview

The Sovereign Operator Console is a single-operator remote administration system for dispatching tasks to a local Windows agent running Claude Code. This guide covers day-to-day usage of the console at `https://ops.lancewfisher.com`.

The system supports exactly one operator with two enrolled devices (Windows laptop and iPhone). All write operations require explicit approval tokens, and every action is recorded in an append-only audit log.

---

## Login Flow

### Passkey Authentication (Primary)

1. Navigate to `https://ops.lancewfisher.com`.
2. The console UI initiates a WebAuthn authentication ceremony.
3. Perform biometric verification (Windows Hello on laptop, Face ID/Touch ID on iPhone).
4. The authenticator signs the broker's challenge with your device-bound private key.
5. On success, the broker issues a session token:
   - Stored as an `HttpOnly`, `Secure`, `SameSite=Strict` cookie named `sovereign_session`.
   - 30-minute expiry, automatically extended on activity.
   - Maximum session lifetime: 8 hours (requires full re-authentication after).
   - Bound to the specific device that authenticated.

### TOTP Step-Up Authentication

TOTP verification is required for elevated operations:
- File writes and deletes
- Shell command execution
- Configuration changes
- Device revocation
- Emergency disable

When triggered:
1. The console prompts for a 6-digit TOTP code from your authenticator app.
2. Submit via `POST /api/auth/totp/verify` with the `code` field.
3. On success, TOTP verification status is cached in Redis for the remaining session lifetime.
4. Subsequent step-up operations within the same session do not re-prompt for TOTP (until session expiry).

If you enter an invalid TOTP code 5 times, the account locks out temporarily. See the Runbook for lockout recovery.

---

## Dashboard Overview

After login, the main dashboard shows:

### Agent Status Panel
- **Connection indicator**: Green (connected), yellow (degraded/reconnecting), red (disconnected).
- **Connected agents**: List of registered agents with name, version, and connection time.
- **Queue status**: Count of queued, pending-reconfirmation, and currently executing tasks.

Endpoint: `GET /api/system/agent-status`

### Token Usage Panel
- **Session usage**: Input/output tokens consumed and task count for the current session.
- **Daily usage**: Aggregate token consumption over the last 24 hours with estimated spend.
- **Spend threshold**: Progress toward the configured daily spend limit (`CLAUDE_DAILY_SPEND_THRESHOLD`).
- **Per-model breakdown**: Token usage split by model over the last 7 days.

Endpoints: `GET /api/tasks/usage` (session), `GET /api/system/token-usage` (aggregate)

### Recent Activity
- Audit log entries filtered to the current session.
- Real-time updates via WebSocket push from the broker.

---

## Device Enrollment

### Prerequisites
- An active authenticated session on an already-enrolled device.
- The new device must support WebAuthn (Windows Hello, Face ID, or Touch ID).

### Enrolling a Windows Laptop

1. From the console, navigate to Device Management.
2. Select **Enroll New Device**.
3. Provide:
   - **Name**: A recognizable label (e.g., "ThinkPad X1").
   - **Type**: `laptop`.
   - **Fingerprint**: The device's TPM-backed identifier.
4. The broker returns a challenge with a 5-minute expiry (`expires_in: 300`).
5. On the new device, open the enrollment URL and complete the challenge.
6. Register a WebAuthn passkey (Windows Hello prompts for PIN or biometric).
7. Scan the TOTP QR code with your authenticator app to provision TOTP on this device.
8. For the agent device: the broker issues a client certificate for mTLS. Store this securely; it is used for the agent's WebSocket connection.

### Enrolling an iPhone

1. Same initial steps as above, but select **Type**: `iphone`.
2. Open the enrollment URL on the iPhone (share via QR code or direct link).
3. Register a passkey using Face ID or Touch ID (the credential is stored in iCloud Keychain).
4. Provision TOTP on the phone's authenticator app.
5. No mTLS certificate is issued for the iPhone; the phone authenticates via passkey + device attestation for approval operations.

### Post-Enrollment

After enrollment, the enrollment link is invalidated. The device appears in the device list with status `active`. Verify by checking `GET /api/devices`.

---

## Task Dispatch

### Composing a Task

1. Select the target project from the project browser (`GET /api/files/projects`).
2. Write the task prompt (up to 50,000 characters).
3. Optionally configure:
   - **Allowed tools**: Restrict which Claude Code tools the agent may use.
   - **Max tokens**: Cap token usage for this task (capped at `CLAUDE_MAX_TOKENS_PER_TASK`).
   - **Context files**: Additional files to include in the task context.
4. Submit via `POST /api/tasks`.

### Approval Flow for Write Operations

If the task involves file writes or other elevated actions:
1. The system creates an approval token (`POST /api/approval/request`).
2. The token is pushed to the iPhone for review.
3. On the iPhone, review the action details (action type, resource path, operation description).
4. Approve (`POST /api/approval/:id/approve`) or reject (`POST /api/approval/:id/reject`).
5. Once approved, the broker forwards the task to the agent.

Approval tokens are single-use and time-limited:
- Write/delete/exec operations: TTL configured via `APPROVAL_TOKEN_TTL_WRITE`.
- Dangerous/deploy operations: TTL configured via `APPROVAL_TOKEN_TTL_DANGEROUS`.

### Monitoring Progress via SSE Stream

After submission, connect to the SSE endpoint to monitor real-time progress:

```
GET /api/tasks/:id/stream
```

Events:
- `connected`: Stream established, includes `task_id`.
- Progress events from the agent (stdout chunks, tool usage, completion status).
- Heartbeat every 15 seconds (`:heartbeat` comment line).

The stream closes when the task completes, fails, or times out.

### Task Status

Check the status of any task:

```
GET /api/tasks/:id
```

Returns: `task_id`, `status` (queued/executing/completed/expired/rejected), `queued_at`, `completed_at`, and `result`.

List all tasks in the current session:

```
GET /api/tasks/session
```

### Cancelling a Task

```
POST /api/tasks/:id/cancel
Body: { "agent_id": "<uuid>" }
```

This sends a cancel signal to the agent (if connected) and updates the queue status to `rejected`. If the agent is offline, only the queue status is updated.

### Task Limits

- **Per-session task limit**: Configured via `CLAUDE_MAX_TASKS_PER_SESSION`. Returns HTTP 429 with code `TASK_LIMIT_REACHED` when exceeded.
- **Daily spend threshold**: Estimated at $0.01 per 1K tokens. Returns HTTP 429 with code `SPEND_LIMIT_REACHED` when exceeded.

---

## File Operations

All file operations are relayed through the broker to the local agent. The agent enforces path scoping, protected path restrictions, and file size limits.

### Browsing Directories

```
GET /api/files/browse?path=/path/to/dir&agent_id=<uuid>
```

Returns the directory listing from the agent. Path must be absolute and cannot contain `..` traversal.

### Reading Files

```
GET /api/files/read?path=/path/to/file&agent_id=<uuid>&line_start=1&line_end=100
```

- `line_start` and `line_end` are optional; omit to read the full file.
- The agent enforces a 1 MB read limit.
- **Secret redaction**: Content matching known sensitive patterns (passwords, API keys, private keys) is replaced with `[REDACTED]` before being sent to the browser. This redaction happens at the broker layer.

### Writing Files

```
POST /api/files/write
Body: {
  "path": "/path/to/file",
  "content": "file contents",
  "agent_id": "<uuid>",
  "approval_token_id": "<uuid>"
}
```

- Requires a valid, unexpired approval token.
- The approval token is consumed (single-use) upon successful write.
- The agent blocks writes to protected paths (`.env`, `*.key`, `*.pem`, `credentials.json`, etc.) regardless of approval token status.
- Path traversal is blocked at both the broker and agent layers.

### Viewing Diffs

```
GET /api/files/diff?path=/path/to/file&agent_id=<uuid>
```

Returns the git diff for the specified file. Sensitive content in diffs is redacted.

---

## Audit Log Review

### Browsing Audit Entries

```
GET /api/audit?page=1&limit=50
```

Optional filters:
- `event_type`: Filter by event type (e.g., `auth.login`, `task.submit`, `file.write`).
- `operator_id`: Filter by operator UUID.
- `session_id`: Filter by session UUID.
- `from` / `to`: ISO 8601 datetime range.

Pagination: `page` (1-indexed), `limit` (1-200, default 50). Response includes `total`, `has_more`, and `data` array.

### Chain Verification

```
GET /api/audit/verify
```

Requires passkey authentication (step-up). Returns:
- `chain_valid`: Boolean indicating whether the full hash chain is intact.
- `entries_checked`: Total entries verified.
- `broken_at`: Entry ID where the chain breaks (null if valid).
- `verified_at`: Timestamp of the verification.

### Exporting Audit Logs

```
GET /api/audit/export?format=json
GET /api/audit/export?format=csv&from=2026-01-01T00:00:00Z&to=2026-03-01T00:00:00Z
```

Requires passkey authentication. Returns up to 10,000 entries as a downloadable file. Supports date range filtering.

---

## Device Management

### Viewing Enrolled Devices

```
GET /api/devices
```

Returns all devices for the authenticated operator, including:
- ID, name, type (laptop/iphone), status (active/suspended/revoked).
- Enrollment timestamp, last seen timestamp.
- Risk flags, passkey registration status.

### Checking Device Status

```
GET /api/devices/:id/status
```

Returns detailed status including mTLS certificate status (`has_mtls`) and passkey status (`has_passkey`).

### Revoking a Device

```
POST /api/devices/:id/revoke
Body: { "reason": "Lost device" }
```

Requires both passkey and TOTP verification. Immediately revokes the device:
- Its passkey credential is invalidated.
- Its mTLS client certificate (if any) is added to the revocation list.
- Active sessions on that device are terminated.

### Re-Enrolling After Revocation

After revoking a device, enroll the replacement using the standard enrollment flow from your remaining active device.

---

## Session Management

### Session Lifecycle

- **Initial duration**: 30 minutes.
- **Auto-extension**: The session is extended automatically on activity when you check session info (`GET /api/auth/session`).
- **Maximum lifetime**: 8 hours. After 8 hours, full re-authentication is required regardless of activity.
- **Cookie**: `sovereign_session`, `HttpOnly`, `Secure`, `SameSite=Strict`.

### Checking Session Status

```
GET /api/auth/session
```

Returns: `session_id`, `operator_id`, `device_id`, `created_at`, `expires_at`, `passkey_verified`, `totp_verified`.

### Logout

```
POST /api/auth/logout
```

Revokes the current session and clears the session cookie. All in-flight operations continue to completion but no new operations can be submitted on the revoked session.

---

## Emergency Disable

The emergency disable is a kill switch that immediately shuts down all system operations.

### What It Does

1. **Revokes all active sessions** across all devices.
2. **Expires all pending approval tokens** (both pending and approved but unconsumed).
3. **Rejects all queued commands** (queued, pending reconfirmation, and confirmed).
4. **Sets a global disable flag** in Redis (`system:emergency_disabled`).
5. **Suspends all agent registrations**.

### When to Use It

- You suspect your account has been compromised.
- You notice unauthorized operations in the audit log.
- The agent is executing tasks you did not authorize.
- A device has been stolen and you need to immediately block all access.

### How to Trigger

```
POST /api/system/emergency-disable
```

Requires both passkey and TOTP verification. This is the highest-privilege operation in the system.

### Recovery After Emergency Disable

After triggering emergency disable, the system is fully locked down. To resume operations:

1. Clear the `system:emergency_disabled` flag in Redis.
2. Reactivate agent registrations in the database (`UPDATE agent_registrations SET status = 'active' WHERE status = 'suspended'`).
3. Authenticate normally to create a new session.
4. Review the audit log to understand what triggered the emergency.
5. If compromise is suspected, rotate all credentials (see Runbook: Suspected Compromise).

See the Runbook (`RUNBOOK.md`) for the full recovery procedure.
