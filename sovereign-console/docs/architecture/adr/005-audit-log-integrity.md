# ADR-005: Audit Log Integrity via Cryptographic Hash Chaining

## Status

**Accepted**

## Context

The Sovereign Operator Console must maintain tamper-evident audit logs. These logs record every authentication event, task submission, approval, execution, and administrative action. As a single-operator system, the audit log serves two purposes:

1. **Forensic investigation**: If the system is compromised, the audit log must reveal what happened and whether any entries were modified or deleted.
2. **Operator accountability**: The operator can verify that no unauthorized actions occurred during a period.

We need a mechanism that makes log tampering detectable without requiring an external trusted third party.

### Options Evaluated

**Option A: Append-only table with DB constraints** — Use PostgreSQL with no UPDATE/DELETE grants. Rely on database access controls alone.

- Pros: Simple, no additional logic
- Cons: A DBA or attacker with superuser access can still modify rows. No detection mechanism.

**Option B: Cryptographic hash chaining** — Each log entry includes a SHA-256 hash of the previous entry's critical fields. Forms a chain where modifying any entry breaks the chain from that point forward.

- Pros: Tamper-evident even against DB superuser. Verification is algorithmic, not access-control dependent.
- Cons: Adds computational overhead per insert. Chain must be initialized correctly.

**Option C: External append-only log service** — Send logs to an external immutable store (e.g., AWS CloudWatch, Sigstore Rekor, blockchain).

- Pros: External trust anchor, attacker must compromise two systems
- Cons: External dependency, cost, complexity, latency, internet dependency for local agent logging

## Decision

**Option B: Cryptographic hash chaining in an append-only PostgreSQL table.**

Combined with Option A's access controls (INSERT-only DB roles), this provides defense-in-depth: access controls prevent casual tampering, hash chaining detects sophisticated tampering.

### Schema

```sql
CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  event_type    TEXT NOT NULL,
  actor_id      TEXT NOT NULL,
  device_id     TEXT,
  session_id    TEXT,
  resource_path TEXT,
  action        TEXT NOT NULL,
  detail        JSONB,
  timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  prev_hash     TEXT NOT NULL,
  entry_hash    TEXT NOT NULL
);

CREATE INDEX idx_audit_log_timestamp ON audit_log (timestamp);
CREATE INDEX idx_audit_log_event_type ON audit_log (event_type);
CREATE INDEX idx_audit_log_actor ON audit_log (actor_id);
```

### Hash Computation

```
entry_hash = SHA-256(id || event_type || actor_id || action || timestamp || prev_hash)
```

Where `||` denotes string concatenation with a delimiter (`:` character).

The first entry in the chain uses a well-known genesis hash: `SHA-256("SOVEREIGN_CONSOLE_AUDIT_GENESIS")`.

### Verification Algorithm

```
1. Read all entries ordered by id ASC
2. For each entry:
   a. Compute expected_hash = SHA-256(entry.id : entry.event_type : entry.actor_id : entry.action : entry.timestamp : entry.prev_hash)
   b. Assert entry.entry_hash == expected_hash
   c. Assert entry.prev_hash == previous_entry.entry_hash (or genesis hash for first entry)
3. If any assertion fails: ALERT — chain integrity violation at entry [id]
```

### Access Control

```sql
-- Broker role: INSERT only
CREATE ROLE broker_audit WITH LOGIN PASSWORD '...';
GRANT INSERT ON audit_log TO broker_audit;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO broker_audit;

-- Agent role: INSERT only (for local events forwarded to broker)
CREATE ROLE agent_audit WITH LOGIN PASSWORD '...';
GRANT INSERT ON audit_log TO agent_audit;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO agent_audit;

-- Verification role: SELECT only
CREATE ROLE audit_verifier WITH LOGIN PASSWORD '...';
GRANT SELECT ON audit_log TO audit_verifier;

-- No role has UPDATE or DELETE on audit_log
```

## Consequences

### Positive

- **Tamper-evident**: Modifying or deleting any entry breaks the hash chain from that point forward. Detectable by the hourly verification job.
- **Self-contained**: No external dependencies. Verification runs entirely within the system.
- **Compatible with backup**: Exported backups preserve the hash chain. Verification can run on backups independently.
- **Low overhead**: SHA-256 computation per insert is negligible (~microseconds). No measurable impact on insert throughput.

### Negative

- **Not tamper-proof**: An attacker with superuser DB access could recompute the entire chain after modifications. Mitigated by: daily encrypted backups to a separate location enable comparison, and the verification job catches modifications between backup intervals.
- **Sequential dependency**: Each insert must read the previous entry's hash. Mitigated by: using a `SELECT ... FOR UPDATE` or advisory lock to serialize inserts. Throughput impact is negligible for a single-operator system.
- **Genesis hash management**: The genesis hash must be documented and consistent. If lost or changed, the chain appears broken from entry 1. Mitigated by: genesis hash is a deterministic function of a well-known string, documented in code and this ADR.
