# Maintenance Guide

> **Governance**: This document defers to the root governance rules at `D:\ProjectsHome\CLAUDE.md`. All security, credential handling, and operational policies defined there take precedence over any guidance in this document.

## Overview

This guide documents the regular maintenance procedures for the Sovereign Operator Console. The system consists of a VPS-hosted broker (Fastify + PostgreSQL + Redis in Docker), a browser-based console UI (Next.js in Docker), and a local Windows agent (WinSW service).

---

## Daily: Audit Log Backup Verification

### Automated Backup

The `scripts/backup-audit-logs.sh` script runs daily via cron on the VPS. It performs:

1. **Hash chain verification** before backup, using a SQL query that checks `prev_hash` linkage across the entire `audit_log` table via `LAG()` window function. If broken links are detected, the backup proceeds but logs a critical warning.
2. **JSON export** of the full `audit_log` table with metadata wrapper (timestamp, hostname, entry count, chain status).
3. **GPG encryption** using the configured recipient key (`lance@lancewfisher.com`).
4. **SHA-256 checksum** generation for the encrypted file.
5. **Rotation** of backups older than 30 days (`RETENTION_DAYS=30`).

Default paths:
- Install directory: `/opt/sovereign-console`
- Backup directory: `/var/backups/sovereign-console`
- Environment file: `/opt/sovereign-console/config/.env`

### Verification Checklist

Each morning, verify:

1. **Backup file exists**: Check `/var/backups/sovereign-console/` for today's `audit_log_YYYYMMDD_HHMMSS.json.gpg` file.
2. **Checksum file exists**: Corresponding `.sha256` file present alongside the backup.
3. **Chain status**: Review the backup script's log output (via cron mail or systemd journal) for "Hash chain integrity verified -- 0 broken links."
4. **No encryption failures**: Ensure the unencrypted `.json` file was removed (only the `.gpg` file should remain).

To manually verify a backup's integrity:

```bash
# Decrypt
gpg --decrypt /var/backups/sovereign-console/audit_log_YYYYMMDD_HHMMSS.json.gpg > /tmp/audit_verify.json

# Verify checksum
sha256sum /var/backups/sovereign-console/audit_log_YYYYMMDD_HHMMSS.json.gpg
cat /var/backups/sovereign-console/audit_log_YYYYMMDD_HHMMSS.json.gpg.sha256

# Inspect entry count
python3 -c "import json; d=json.load(open('/tmp/audit_verify.json')); print(f'Entries: {len(d[\"entries\"])}, Chain: {d[\"chain_status\"]} broken links')"

# Clean up
rm /tmp/audit_verify.json
```

### Cron Configuration

```cron
# Daily audit log backup at 02:00 UTC
0 2 * * * /opt/sovereign-console/scripts/backup-audit-logs.sh >> /var/log/sovereign-console/backup.log 2>&1
```

---

## Weekly: Audit Chain Integrity Verification

Run the chain verification endpoint from the console UI or directly:

```
GET /api/audit/verify
```

This requires passkey authentication. The endpoint walks the entire audit log table and verifies:
- Each entry's `prev_hash` matches the computed chain hash of the previous entry.
- Each entry's `entry_hash` matches the recomputed value from `SHA-256(id + event_type + action + timestamp + prev_hash)`.

Expected response:

```json
{
  "chain_valid": true,
  "entries_checked": 1234,
  "broken_at": null,
  "verified_at": "2026-03-26T10:00:00.000Z"
}
```

If `chain_valid` is `false`, see the Runbook entry for "Audit Chain Broken."

The broker also runs an hourly automated verification job. Weekly manual verification provides an additional human-in-the-loop check.

---

## Monthly: Certificate Expiry Check

### Agent mTLS Client Certificate

- **Validity**: 90 days from issuance.
- **Renewal**: The agent should request renewal before expiry. The broker issues a new certificate after passkey verification.
- **Monitoring**: Check the agent's certificate expiry date:

```bash
# On the Windows workstation
openssl x509 -enddate -noout -in C:\path\to\agent-cert.pem
```

Or check via the device status endpoint:

```
GET /api/devices/:id/status
```

The `has_mtls` field confirms whether the device has a valid mTLS certificate.

### Let's Encrypt TLS Certificate

- **Validity**: 90 days.
- **Renewal**: Automatic via certbot (or equivalent ACME client) configured on the VPS.
- **Monitoring**: Verify auto-renewal is active:

```bash
# Check certbot timer
sudo systemctl status certbot.timer

# Test renewal
sudo certbot renew --dry-run

# Check current cert expiry
echo | openssl s_client -connect ops.lancewfisher.com:443 -servername ops.lancewfisher.com 2>/dev/null | openssl x509 -noout -enddate
```

If the Let's Encrypt certificate expires, the console UI becomes inaccessible and the agent's mTLS connection fails. See Runbook: Certificate Expired.

---

## Quarterly: Recovery Code Verification

Verify that your break-glass recovery codes are still accessible and readable:

1. Retrieve your physical recovery code storage (safe, safety deposit box).
2. Confirm the codes are legible and the storage medium is not degraded.
3. Do **not** test a code unless you intend to trigger a full rotation (using any code invalidates all 10 and generates a new set).
4. Confirm you know the recovery URL: `https://ops.lancewfisher.com/recover`.
5. If codes are damaged or unreadable, generate a new set while you still have device access.

---

## As-Needed: Software Updates

### Docker Container Updates

```bash
# On the VPS
cd /opt/sovereign-console

# Pull latest images
docker compose pull

# Rebuild if using custom images
docker compose build --no-cache

# Apply updates with zero-downtime restart
docker compose up -d

# Verify health
curl -sf https://ops.lancewfisher.com/api/system/health | jq .
```

After updating, verify:
- Health endpoint returns `healthy`.
- Agent reconnects successfully (check agent status endpoint).
- Audit log chain is still valid.

### Node.js Updates

The broker and agent both target Node.js 20 LTS. When updating:

1. Update the base image version in the Dockerfile (broker).
2. Update Node.js on the Windows workstation (agent).
3. Rebuild and redeploy.
4. Run `npm run typecheck` before deploying to catch any compatibility issues.

### Dependency Updates

```bash
# Check for outdated packages
cd broker && npm outdated
cd console-ui && npm outdated
cd local-agent && npm outdated

# Update within semver range
npm update

# For major version bumps, update individually and test
npm install <package>@latest
npm run typecheck
npx vitest
```

Critical dependencies to monitor for security patches:
- `@simplewebauthn/server` (WebAuthn)
- `otplib` (TOTP)
- `fastify` and plugins
- `pg` (PostgreSQL client)
- `ioredis` (Redis client)

---

## Log Rotation

### NGINX

NGINX log rotation is typically handled by `logrotate` on the VPS:

```
/var/log/nginx/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        [ -s /run/nginx.pid ] && kill -USR1 $(cat /run/nginx.pid)
    endscript
}
```

### Broker

Broker logs are written to stdout/stderr within the Docker container. Docker manages rotation:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "5"
  }
}
```

Configure in `/etc/docker/daemon.json` or per-service in `docker-compose.yml`.

### Local Agent (WinSW)

The WinSW service wrapper handles agent log rotation:
- Maximum file size: 10 MB per log file.
- Maximum file count: 5 rotated files.
- Configured in the WinSW XML configuration file on the Windows workstation.

### PostgreSQL

PostgreSQL logging within Docker:
- Configure `log_rotation_age` and `log_rotation_size` in `postgresql.conf`.
- Default: rotate daily, 10 MB max per file.
- WAL files are managed separately; ensure `max_wal_size` is appropriate for the workload.

### Redis

Redis logs to stdout within Docker (same container log management as the broker). AOF rewrite logs are managed by Redis internally.

---

## Database Maintenance

### VACUUM

PostgreSQL autovacuum is enabled by default. For the `audit_log` table (append-only, no updates or deletes through the application), vacuuming overhead is minimal. However, the entry_hash update within the `appendLog` transaction creates dead tuples, so autovacuum is still necessary.

Manual full vacuum (requires exclusive table lock, run during maintenance window):

```sql
VACUUM (FULL, ANALYZE) audit_log;
VACUUM (FULL, ANALYZE) sessions;
VACUUM (FULL, ANALYZE) approval_tokens;
VACUUM (FULL, ANALYZE) command_queue;
VACUUM (FULL, ANALYZE) token_usage;
```

### Index Rebuild

Rebuild indexes if query performance degrades:

```sql
REINDEX TABLE audit_log;
REINDEX TABLE sessions;
REINDEX TABLE command_queue;
```

Key indexes on `audit_log`:
- `idx_audit_timestamp` (timestamp DESC)
- `idx_audit_event_type` (event_type)
- `idx_audit_actor` (actor_id)
- `idx_audit_session` (session_id, partial)
- `idx_audit_resource` (resource_path, partial)

### Connection Pool Monitoring

The broker uses a PostgreSQL connection pool. Monitor via:

```sql
SELECT count(*) FROM pg_stat_activity WHERE datname = 'sovereign_console';
```

Pool configuration:
- Maximum connections: 20.
- Statement timeout: 30 seconds.

If connections are exhausted, the broker returns 500 errors. See Runbook: Database Connection Exhausted.

---

## Redis Monitoring

### Memory Usage

```bash
docker compose exec redis redis-cli INFO memory
```

Key metrics:
- `used_memory_human`: Current memory usage.
- `maxmemory`: Configured limit (256 MB).
- `maxmemory_policy`: Eviction policy (should be `allkeys-lru` or `noeviction` depending on configuration).

### Key Count and Types

```bash
docker compose exec redis redis-cli INFO keyspace
docker compose exec redis redis-cli DBSIZE
```

Expected key patterns:
- `session:passkey:<session_id>`: Passkey verification cache.
- `session:totp:<session_id>`: TOTP verification cache.
- `system:emergency_disabled`: Emergency disable flag.
- Rate limiting counters.

### Eviction Monitoring

```bash
docker compose exec redis redis-cli INFO stats | grep evicted_keys
```

If evictions are occurring, either increase `maxmemory` or investigate which keys are consuming the most space.

---

## Health Checks

### System Health Endpoint

```
GET /api/system/health
```

No authentication required (designed for external monitoring). Returns:

```json
{
  "status": "healthy",
  "checks": {
    "database": { "status": "ok", "latency_ms": 2 },
    "redis": { "status": "ok", "latency_ms": 1 },
    "agents": { "status": "ok" }
  },
  "timestamp": "2026-03-26T10:00:00.000Z"
}
```

- HTTP 200: All checks pass.
- HTTP 503: One or more checks failed (`status: "degraded"`).
- `agents` reports `degraded` if no agents are connected (this is normal when the workstation is off).

### Agent Heartbeat Monitoring

The agent sends a WebSocket ping every 30 seconds. The broker detects:
- **Degraded**: No ping in 45 seconds (1 missed cycle).
- **Disconnected**: No ping in 90 seconds (3 missed cycles).

Connection state changes are pushed to the console UI in real time.

### External Monitoring

Configure uptime monitoring (e.g., Uptime Kuma, Pingdom) to poll:
- `https://ops.lancewfisher.com/api/system/health` every 60 seconds.
- Alert if HTTP status is not 200 for 3 consecutive checks.

---

## Backup Strategy

### Audit Logs (Daily, Encrypted)

- **Script**: `scripts/backup-audit-logs.sh`
- **Schedule**: Daily at 02:00 UTC via cron.
- **Format**: Full JSON export, GPG-encrypted with recipient key.
- **Checksum**: SHA-256 alongside each backup.
- **Local retention**: 30 days.
- **Remote**: Upload to S3-compatible storage if configured.

### Database (pg_dump)

```bash
# Full database backup
docker compose exec postgres pg_dump -U sovereign_console sovereign_console \
  | gzip > /var/backups/sovereign-console/db_$(date +%Y%m%d).sql.gz

# Restore
gunzip < /var/backups/sovereign-console/db_YYYYMMDD.sql.gz \
  | docker compose exec -T postgres psql -U sovereign_console sovereign_console
```

Schedule daily alongside or immediately after the audit log backup. Retain 7 days locally, 90 days remotely.

### Redis (AOF Persistence)

Redis is configured with AOF (Append Only File) persistence. The AOF file is written to the Redis data volume.

- AOF rewrite happens automatically when the file grows large.
- For manual backup: copy the AOF file from the Docker volume.
- Redis data is ephemeral cache (sessions, rate limiters). Loss of Redis data requires re-authentication but does not lose critical system state. All persistent state is in PostgreSQL.

### Recovery Priority

In a disaster recovery scenario, restore in this order:

1. **PostgreSQL** (contains all persistent state: audit logs, device registry, operator accounts, recovery codes).
2. **Docker containers** (broker, console UI, postgres, redis).
3. **NGINX and TLS certificates** (Let's Encrypt will auto-renew; NGINX config from version control).
4. **Redis** (will repopulate from active sessions; no manual restore needed).
5. **Local agent** (reinstall WinSW service, re-issue mTLS certificate if needed).
