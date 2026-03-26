# Audit Log Integrity Model

## Overview

The audit log is the forensic backbone of the Sovereign Operator Console. Every authentication event, task submission, approval, execution, configuration change, and system event is recorded in an append-only PostgreSQL table with cryptographic hash chaining.

## Design Goals

1. **Tamper evidence**: Any modification or deletion of log entries is detectable.
2. **Append-only**: No entity in the system has the ability to update or delete audit entries through application-level access.
3. **Self-verifiable**: The integrity of the log can be verified algorithmically without external trust anchors.
4. **Survivable**: Log data survives broker restarts, agent disconnections, and single-component failures.

## Schema

```sql
CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  event_type    TEXT NOT NULL,
  actor_id      TEXT NOT NULL,          -- 'operator', 'agent', 'broker', 'system'
  device_id     TEXT,                   -- Device that initiated the action (if applicable)
  session_id    TEXT,                   -- Session context (if applicable)
  resource_path TEXT,                   -- Affected resource (file, config, device, etc.)
  action        TEXT NOT NULL,          -- Verb: 'authenticate', 'submit', 'approve', 'execute', etc.
  detail        JSONB,                  -- Structured event-specific data
  client_ip     INET,                   -- Source IP address
  user_agent    TEXT,                   -- Browser/client user agent
  timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  prev_hash     TEXT NOT NULL,          -- SHA-256 hash of the previous entry
  entry_hash    TEXT NOT NULL           -- SHA-256 hash of this entry
);

-- Indexes for common queries
CREATE INDEX idx_audit_timestamp ON audit_log (timestamp DESC);
CREATE INDEX idx_audit_event_type ON audit_log (event_type);
CREATE INDEX idx_audit_actor ON audit_log (actor_id);
CREATE INDEX idx_audit_session ON audit_log (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_audit_resource ON audit_log (resource_path) WHERE resource_path IS NOT NULL;
```

## Hash Chain

### Hash Computation

```
entry_hash = SHA-256(
  id + ":" +
  event_type + ":" +
  actor_id + ":" +
  action + ":" +
  timestamp (ISO 8601) + ":" +
  prev_hash
)
```

All fields are converted to their string representation. NULL fields are represented as the literal string `"null"`.

### Genesis Entry

The first entry in the audit log uses a deterministic genesis hash:

```
genesis_hash = SHA-256("SOVEREIGN_CONSOLE_AUDIT_GENESIS")
             = "a1b2c3d4..."  (actual computed value)
```

The genesis entry is inserted during system initialization:

```sql
INSERT INTO audit_log (event_type, actor_id, action, detail, prev_hash, entry_hash)
VALUES (
  'SYSTEM_INIT',
  'system',
  'initialize',
  '{"version": "1.0.0", "genesis": true}',
  SHA-256("SOVEREIGN_CONSOLE_AUDIT_GENESIS"),
  SHA-256(1 || ":" || "SYSTEM_INIT" || ":" || ... || ":" || genesis_hash)
);
```

### Chain Continuity

Every subsequent entry must:

1. Read the `entry_hash` of the most recent existing entry.
2. Use that value as `prev_hash` for the new entry.
3. Compute its own `entry_hash` using the formula above.

This creates a chain where modifying any entry invalidates all subsequent entries' `prev_hash` references.

## Access Control

### Database Roles

```sql
-- Role for broker application: INSERT only on audit_log
CREATE ROLE broker_audit WITH LOGIN PASSWORD '${BROKER_AUDIT_PASSWORD}';
GRANT CONNECT ON DATABASE sovereign_console TO broker_audit;
GRANT USAGE ON SCHEMA public TO broker_audit;
GRANT INSERT ON audit_log TO broker_audit;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO broker_audit;
-- Broker also needs SELECT to read prev_hash for chain computation
GRANT SELECT ON audit_log TO broker_audit;

-- Role for agent events (forwarded through broker, but separate identity)
CREATE ROLE agent_audit WITH LOGIN PASSWORD '${AGENT_AUDIT_PASSWORD}';
GRANT CONNECT ON DATABASE sovereign_console TO agent_audit;
GRANT USAGE ON SCHEMA public TO agent_audit;
GRANT INSERT ON audit_log TO agent_audit;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO agent_audit;
GRANT SELECT ON audit_log TO agent_audit;

-- Role for verification job: SELECT only
CREATE ROLE audit_verifier WITH LOGIN PASSWORD '${VERIFIER_PASSWORD}';
GRANT CONNECT ON DATABASE sovereign_console TO audit_verifier;
GRANT USAGE ON SCHEMA public TO audit_verifier;
GRANT SELECT ON audit_log TO audit_verifier;

-- NO role has UPDATE or DELETE on audit_log
-- The postgres superuser technically can, but application roles cannot
```

### Insert Serialization

To maintain chain integrity under concurrent inserts, the broker uses an advisory lock:

```typescript
async function appendAuditEntry(entry: AuditEntry): Promise<void> {
  await db.transaction(async (tx) => {
    // Acquire advisory lock (prevents concurrent audit inserts)
    await tx.query('SELECT pg_advisory_xact_lock(1)');

    // Get previous entry's hash
    const prev = await tx.query(
      'SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1'
    );
    const prevHash = prev.rows[0]?.entry_hash ?? genesisHash();

    // Compute this entry's hash
    const entryHash = computeHash(entry, prevHash);

    // Insert
    await tx.query(
      `INSERT INTO audit_log (event_type, actor_id, device_id, session_id,
        resource_path, action, detail, client_ip, user_agent, prev_hash, entry_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [entry.eventType, entry.actorId, entry.deviceId, entry.sessionId,
       entry.resourcePath, entry.action, entry.detail, entry.clientIp,
       entry.userAgent, prevHash, entryHash]
    );
  });
}
```

The advisory lock ensures that only one audit insert proceeds at a time, maintaining strict chain ordering. For a single-operator system, this serialization has negligible performance impact.

## Logged Event Types

| Event Type | Actor | Description |
|---|---|---|
| `AUTH_PASSKEY_SUCCESS` | operator | Successful passkey authentication |
| `AUTH_PASSKEY_FAILURE` | operator | Failed passkey authentication |
| `AUTH_TOTP_SUCCESS` | operator | Successful TOTP validation |
| `AUTH_TOTP_FAILURE` | operator | Failed TOTP validation |
| `AUTH_TOTP_LOCKOUT` | system | TOTP lockout triggered |
| `SESSION_CREATED` | broker | New session issued |
| `SESSION_EXPIRED` | broker | Session expired |
| `SESSION_REVOKED` | operator | Session manually revoked |
| `TASK_SUBMITTED` | operator | Task submitted for execution |
| `TASK_QUEUED` | broker | Task queued (agent offline) |
| `TASK_RECONFIRMED` | operator | Queued task re-confirmed after reconnect |
| `TASK_DISCARDED` | operator | Queued task discarded |
| `TASK_DISPATCHED` | broker | Task sent to agent |
| `TASK_EXECUTING` | agent | Agent began executing task |
| `TASK_COMPLETED` | agent | Task execution finished |
| `TASK_FAILED` | agent | Task execution failed |
| `TASK_TIMEOUT` | agent | Task killed due to timeout |
| `APPROVAL_REQUESTED` | broker | Approval token created |
| `APPROVAL_GRANTED` | operator | Approval token approved |
| `APPROVAL_DENIED` | operator | Approval token denied |
| `APPROVAL_EXPIRED` | broker | Approval token TTL elapsed |
| `APPROVAL_USED` | broker | Approval token consumed |
| `DEVICE_ENROLLED` | operator | New device enrolled |
| `DEVICE_SUSPENDED` | operator | Device suspended |
| `DEVICE_REVOKED` | operator | Device revoked |
| `DEVICE_REACTIVATED` | operator | Device reactivated from suspension |
| `AGENT_CONNECTED` | agent | Agent WebSocket connected |
| `AGENT_DISCONNECTED` | broker | Agent WebSocket disconnected |
| `AGENT_RECONNECTED` | agent | Agent reconnected after disconnection |
| `CERT_ISSUED` | broker | Client certificate issued |
| `CERT_RENEWED` | broker | Client certificate renewed |
| `CERT_REVOKED` | broker | Client certificate revoked |
| `TOTP_PROVISIONED` | operator | TOTP secret provisioned |
| `TOTP_REPROVISIONED` | operator | TOTP secret replaced |
| `BREAK_GLASS_INITIATED` | operator | Break-glass recovery started |
| `BREAK_GLASS_COMPLETED` | operator | Break-glass recovery completed |
| `RECOVERY_CODE_USED` | operator | Recovery code consumed |
| `RECOVERY_CODES_ROTATED` | system | All recovery codes regenerated |
| `CONFIG_CHANGED` | operator | System configuration modified |
| `INTEGRITY_CHECK_PASSED` | system | Hourly hash chain verification passed |
| `INTEGRITY_CHECK_FAILED` | system | Hash chain integrity violation detected |
| `SYSTEM_INIT` | system | System initialized |

## Integrity Verification

### Hourly Verification Job

A scheduled job runs every hour using the `audit_verifier` database role:

```typescript
async function verifyAuditChain(): Promise<VerificationResult> {
  const entries = await db.query(
    'SELECT id, event_type, actor_id, action, timestamp, prev_hash, entry_hash FROM audit_log ORDER BY id ASC'
  );

  let expectedPrevHash = genesisHash();
  const violations: ChainViolation[] = [];

  for (const entry of entries.rows) {
    // Check prev_hash linkage
    if (entry.prev_hash !== expectedPrevHash) {
      violations.push({
        entryId: entry.id,
        type: 'prev_hash_mismatch',
        expected: expectedPrevHash,
        actual: entry.prev_hash,
      });
    }

    // Recompute entry_hash
    const computedHash = computeHash(entry, entry.prev_hash);
    if (entry.entry_hash !== computedHash) {
      violations.push({
        entryId: entry.id,
        type: 'entry_hash_mismatch',
        expected: computedHash,
        actual: entry.entry_hash,
      });
    }

    expectedPrevHash = entry.entry_hash;
  }

  return { valid: violations.length === 0, violations };
}
```

### On Violation

If the verification job detects a chain break:

1. Log `INTEGRITY_CHECK_FAILED` with details of the first violation.
2. Send alert to operator via all available channels (UI notification, email if configured).
3. Do **not** automatically repair or discard entries — this requires human investigation.
4. Continue logging new entries (the chain continues from the last valid entry).

## Backup and Export

### Daily Export

A daily cron job exports the audit log:

```bash
# Export all entries since last export
pg_dump -U audit_verifier -t audit_log --data-only --inserts \
  sovereign_console | \
  gpg --symmetric --cipher-algo AES256 --passphrase-file /root/.audit-backup-key \
  > /var/backups/audit/audit-$(date +%Y%m%d).sql.gpg
```

### Export Verification

After export, the backup is verified:

1. Decrypt the export to a temp file.
2. Load into a separate database.
3. Run the chain verification algorithm.
4. If verification passes, the backup is valid.
5. Upload to S3-compatible storage (if configured).
6. Delete local copy after successful upload (retain last 7 days locally).

### Retention

- **In database**: Indefinite (single-operator system, growth rate is manageable).
- **Local backups**: 7 days.
- **Remote backups**: 1 year minimum.

## Performance Considerations

- **Insert overhead**: SHA-256 computation adds ~0.01ms per insert. Negligible.
- **Advisory lock**: Serializes inserts. For a single-operator system generating at most a few hundred entries per day, this has zero practical impact.
- **Verification job**: Full chain walk reads all entries sequentially. For 100K entries (~1 year of heavy use), this takes ~5-10 seconds. Acceptable for an hourly job.
- **Index maintenance**: Standard B-tree indexes on timestamp, event_type, actor_id. No special considerations.
