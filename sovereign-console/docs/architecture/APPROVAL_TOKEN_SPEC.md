# Approval Token Specification

## Overview

Approval tokens are the mechanism by which the broker gates destructive or sensitive operations. Before any write, delete, or execute operation proceeds, the broker issues an approval token that must be explicitly approved by the operator (typically via iPhone), consumed exactly once, and bound to the specific action and device.

## Token Schema

```typescript
interface ApprovalToken {
  id: string;              // UUIDv4, globally unique
  action_type: string;     // e.g., "file.write", "file.delete", "task.execute", "config.update"
  resource_path: string;   // Specific resource (e.g., "/src/main.ts", "task:abc123")
  operation: 'write' | 'delete' | 'execute';
  device_id: string;       // ID of the device that must approve
  session_id: string;      // Session that requested the action
  issued_at: string;       // ISO 8601 timestamp
  expires_at: string;      // ISO 8601 timestamp
  issuer: 'broker';        // Always "broker" — no other entity issues tokens
  nonce: string;           // Cryptographically random, 32 bytes hex-encoded
  payload_hash: string;    // SHA-256 hex digest of the action payload
  status: 'pending' | 'approved' | 'used' | 'expired' | 'revoked';
}
```

## Database Schema

```sql
CREATE TABLE approval_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type   TEXT NOT NULL,
  resource_path TEXT NOT NULL,
  operation     TEXT NOT NULL CHECK (operation IN ('write', 'delete', 'execute')),
  device_id     TEXT NOT NULL REFERENCES enrolled_devices(device_id),
  session_id    TEXT NOT NULL REFERENCES sessions(session_id),
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  issuer        TEXT NOT NULL DEFAULT 'broker' CHECK (issuer = 'broker'),
  nonce         TEXT NOT NULL UNIQUE,
  payload_hash  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'used', 'expired', 'revoked')),
  approved_at   TIMESTAMPTZ,
  used_at       TIMESTAMPTZ,
  approval_device_id TEXT REFERENCES enrolled_devices(device_id),
  approval_signature TEXT
);

CREATE INDEX idx_approval_tokens_status ON approval_tokens (status) WHERE status = 'pending';
CREATE INDEX idx_approval_tokens_expires ON approval_tokens (expires_at) WHERE status = 'pending';
```

## TTL Rules

| Operation | TTL | Rationale |
|---|---|---|
| `write` | 5 minutes | Standard operations, reasonable review time |
| `delete` | 2 minutes | Destructive, should not linger |
| `execute` | 2 minutes | Arbitrary execution, tighter window |

The `expires_at` field is set to `issued_at + TTL` at creation time. The broker runs a background job every 30 seconds to transition `pending` tokens past their `expires_at` to `expired` status.

## Scope Binding

Each token is bound to:

1. **Specific action_type**: The exact operation category (e.g., `file.write`).
2. **Specific resource_path**: The exact resource being acted upon. Wildcards and globs are never allowed.
3. **Specific operation**: One of `write`, `delete`, `execute`.
4. **Specific payload_hash**: SHA-256 of the serialized action payload. If the payload changes after approval, the hash will not match and the token is invalid.

A token for `file.write` on `/src/main.ts` cannot be used for `file.write` on `/src/index.ts` or for `file.delete` on `/src/main.ts`.

## Single-Use Enforcement

Tokens are consumed exactly once:

1. Before execution, broker checks `status = 'approved'`.
2. Broker atomically transitions status to `'used'` and sets `used_at`:
   ```sql
   UPDATE approval_tokens
   SET status = 'used', used_at = NOW()
   WHERE id = $1 AND status = 'approved'
   RETURNING id;
   ```
3. If `RETURNING` yields no rows, the token was already consumed, expired, or revoked. The action is rejected.
4. The atomic UPDATE prevents race conditions — only one execution can consume the token.

## Device Binding

- `device_id`: The enrolled device that is authorized to approve this token. For most operations, this is the iPhone.
- The approval response must include the `device_id` of the approving device.
- Broker validates that `approval_device_id` matches an enrolled device in the device registry.
- Broker validates that the device is currently enrolled (not revoked).

## Expiration Handling

If a token expires while the operator is reviewing it:

1. The approval UI shows "This approval request has expired."
2. The original action in the Console UI shows "Approval expired."
3. The operator must re-initiate the action from the Console UI, which generates a new token.
4. The expired token remains in the database with status `expired` for audit purposes.

## Status Transitions

```
pending → approved    (operator approves)
pending → expired     (TTL elapsed)
pending → revoked     (operator or system cancels)
approved → used       (action executed)
approved → expired    (approved but not executed within TTL — should not happen in normal flow)
approved → revoked    (operator revokes after approving but before use)
```

No backwards transitions. A `used`, `expired`, or `revoked` token can never return to `pending` or `approved`.

## Transmission Security

- Tokens are included in the **request body**, never in URL parameters or query strings.
- All communication is over TLS 1.3.
- Token `id` and `nonce` are never logged in full in application logs (truncated to first 8 chars for correlation).
- The `approval_signature` field is not logged.

## iPhone Approval Integration

### Approval Flow

```
1. Broker creates approval token with status 'pending'
2. Broker sends approval request to iPhone via push notification / WebSocket
3. Notification includes: action_type, resource_path, operation, token.id (for correlation)
4. Operator opens approval on iPhone
5. iPhone UI displays: action details, resource path, timestamp
6. Operator authenticates with passkey (Face ID / Touch ID)
7. iPhone constructs approval response:
   {
     token_id: token.id,
     device_id: iPhone's enrolled device_id,
     approved_at: ISO8601,
     signature: sign(token_id + device_id + approved_at, device_private_key)
   }
8. iPhone sends approval response to broker over HTTPS
9. Broker validates:
   a. token_id exists and status is 'pending'
   b. token has not expired
   c. device_id matches an enrolled iPhone device
   d. signature validates against the enrolled device's public key
10. Broker transitions token to 'approved'
11. Broker proceeds with action execution
```

### Device Attestation

The iPhone's approval response includes a signature produced by the device's Secure Enclave private key (the same key backing the WebAuthn credential). The broker validates this signature against the public key stored during enrollment.

## Audit Logging

All token lifecycle events are recorded in the audit log:

| Event | Logged Fields |
|---|---|
| Token created | token_id (truncated), action_type, resource_path, operation, device_id, expires_at |
| Token approved | token_id (truncated), approval_device_id, approved_at |
| Token used | token_id (truncated), used_at, execution result summary |
| Token expired | token_id (truncated), expired_at |
| Token revoked | token_id (truncated), revoked_by, revoked_at, reason |
| Validation failure | token_id (truncated), failure_reason (e.g., "device_id mismatch", "expired", "already used") |
