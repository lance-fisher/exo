# Incident Response Runbook

> **Governance**: This document defers to the root governance rules at `D:\ProjectsHome\CLAUDE.md`. All security, credential handling, and operational policies defined there take precedence over any guidance in this document.

## Overview

This runbook documents incident response procedures for the Sovereign Operator Console. Each scenario follows a standard format: symptoms, diagnosis steps, resolution, and prevention.

---

## 1. Agent Offline

### Symptoms

- Console UI shows a red hollow circle (DISCONNECTED) for the agent.
- `GET /api/system/agent-status` returns `online: false` for the agent.
- Tasks submitted return HTTP 202 with `status: "queued"` instead of completing.
- No heartbeat received by the broker for 90+ seconds (3 missed 30-second cycles).

### Diagnosis

1. **Check agent status on the Windows workstation**:
   ```powershell
   # Check WinSW service status
   sc query SovereignAgent

   # Check if the process is running
   Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*sovereign*' }
   ```

2. **Check agent logs** (WinSW log directory, typically alongside the service executable):
   ```powershell
   Get-Content C:\path\to\sovereign-agent\logs\agent.log -Tail 50
   ```

3. **Check network connectivity from the workstation**:
   ```powershell
   Test-NetConnection ops.lancewfisher.com -Port 443
   ```

4. **Check broker-side WebSocket status**:
   ```bash
   docker compose logs broker --tail 50 | grep -i websocket
   ```

### Resolution

| Cause | Action |
|---|---|
| Agent service stopped | Restart: `sc start SovereignAgent` or via WinSW |
| Agent crashed | WinSW auto-restarts within 10-60 seconds. If not restarting, check logs for crash reason and fix. |
| Network issue | Verify VPN, Wi-Fi, firewall. The agent retries with exponential backoff (1s initial, 60s max, infinite retries). |
| Workstation asleep | Wake the machine. Agent reconnects automatically on wake. |
| Workstation rebooted | WinSW restarts the agent automatically. Allow 2-5 minutes. |
| mTLS certificate rejected | Certificate may be expired or revoked. See "Certificate Expired" below. |

After reconnection:
- Any queued tasks enter `pending_reconfirm` state.
- The console UI prompts: "Agent reconnected. [N] tasks require re-confirmation."
- Review each queued task and confirm or discard. Tasks are never auto-executed after disconnection.

### Prevention

- Monitor the agent heartbeat via the health endpoint.
- Set up alerting for agent disconnection events longer than 5 minutes.
- Ensure WinSW service is set to auto-start on boot.
- Track agent certificate expiry dates (90-day validity).

---

## 2. Broker Down

### Symptoms

- Console UI fails to load or shows connection errors.
- `https://ops.lancewfisher.com/api/system/health` returns HTTP 502 or is unreachable.
- Agent enters reconnection loop (visible in agent logs).
- External monitoring alerts fire.

### Diagnosis

1. **Check NGINX**:
   ```bash
   sudo systemctl status nginx
   sudo nginx -t
   tail -50 /var/log/nginx/error.log
   ```

2. **Check Docker containers**:
   ```bash
   docker compose ps
   docker compose logs broker --tail 100
   docker compose logs postgres --tail 50
   docker compose logs redis --tail 50
   ```

3. **Check system resources**:
   ```bash
   free -h
   df -h
   top -bn1 | head -20
   ```

### Resolution

| Cause | Action |
|---|---|
| Broker container crashed | `docker compose up -d broker` (auto-restarts if restart policy is set) |
| PostgreSQL down | `docker compose up -d postgres` then `docker compose restart broker` |
| Redis down | `docker compose up -d redis` then `docker compose restart broker` |
| NGINX crashed | `sudo systemctl restart nginx` |
| Disk full | Free space: clean Docker images (`docker system prune`), rotate logs, remove old backups |
| OOM kill | Check `dmesg | grep -i oom`. Increase container memory limits or VPS RAM. |
| NGINX 502 (proxy target down) | Broker container is down or not listening. Restart broker. |

After recovery:
- Agent reconnects automatically (exponential backoff, max 60s between attempts).
- Queued tasks in PostgreSQL survive broker restarts.
- Session state recovers from PostgreSQL. Active sessions may need re-authentication if Redis was also lost.

### Prevention

- Configure Docker restart policy: `restart: unless-stopped` for all services.
- Monitor disk usage and set alerts at 80% capacity.
- Configure container resource limits to prevent OOM.
- External health check monitoring with alerts.

---

## 3. Certificate Expired

### Agent mTLS Client Certificate (90-day expiry)

**Symptoms**:
- Agent fails to connect. Logs show TLS handshake errors.
- Broker logs show client certificate validation failure.
- Agent enters reconnection loop but never reaches CONNECTED state.

**Diagnosis**:
```bash
# Check cert expiry on the workstation
openssl x509 -enddate -noout -in C:\path\to\agent-cert.pem
```

**Resolution**:
1. From the console UI (on a still-valid device), note the agent's device ID.
2. The agent must request a certificate renewal through the broker, which requires passkey verification.
3. If the agent cannot connect at all due to cert expiry, you may need to temporarily configure the broker to accept a new enrollment for the agent device.
4. After issuing a new certificate, restart the agent service.

**Prevention**:
- Monitor certificate expiry monthly (see Maintenance Guide).
- Set a calendar reminder for 2 weeks before the 90-day expiry.
- Implement automated renewal: the agent requests a new cert when fewer than 14 days remain.

### Let's Encrypt TLS Certificate

**Symptoms**:
- Browser shows "Your connection is not private" when accessing the console.
- Agent mTLS handshake fails (server cert not trusted).
- External monitoring reports HTTPS errors.

**Diagnosis**:
```bash
# Check cert from outside
echo | openssl s_client -connect ops.lancewfisher.com:443 -servername ops.lancewfisher.com 2>/dev/null | openssl x509 -noout -dates

# Check certbot status
sudo certbot certificates
sudo systemctl status certbot.timer
```

**Resolution**:
```bash
# Force renewal
sudo certbot renew --force-renewal

# Reload NGINX to pick up new cert
sudo systemctl reload nginx
```

If certbot fails (DNS issue, rate limit), check `sudo certbot renew --dry-run` for details.

**Prevention**:
- Ensure `certbot.timer` or equivalent cron job is active.
- Test renewal monthly: `sudo certbot renew --dry-run`.
- Monitor TLS certificate expiry via external tools.

---

## 4. Authentication Locked Out

### Passkey Failure

**Symptoms**:
- WebAuthn ceremony fails. Browser does not prompt for biometric or returns an error.
- Console shows "Authentication failed."

**Diagnosis**:
- Is the device's biometric sensor functional?
- Has the passkey been deleted from the device's credential store?
- Is the browser up to date (WebAuthn support)?

**Resolution**:
1. Try the other enrolled device.
2. If the passkey was deleted from the device, you need to re-register it. This requires an active session on the other device.
3. If both devices have lost their passkeys, initiate break-glass recovery (see below).

### TOTP Lockout (5 Failed Attempts)

**Symptoms**:
- TOTP verification returns HTTP 429.
- Log entry: `AUTH_TOTP_LOCKOUT`.

**Diagnosis**:
- Was the TOTP code entered correctly (check for clock drift on the authenticator device)?
- Is the correct TOTP secret bound to this account?

**Resolution**:
1. Wait for the lockout period to expire (varies by configuration).
2. Verify your authenticator app's time is synchronized.
3. If the TOTP secret is lost or corrupted, use the other enrolled device to reprovision TOTP.
4. If locked out of both TOTP and passkey on all devices, initiate break-glass recovery.

**Prevention**:
- Keep TOTP secret backed up in a secure location (or synced across devices via the authenticator app).
- Verify TOTP works on both devices during initial setup.

---

## 5. Audit Chain Broken

### Symptoms

- `GET /api/audit/verify` returns `chain_valid: false` with a `broken_at` entry ID.
- Hourly verification job logs `INTEGRITY_CHECK_FAILED`.
- Backup script reports broken links during pre-backup verification.

### Diagnosis

1. **Identify the break point**:
   ```sql
   -- Find the broken entry and its neighbors
   SELECT id, event_type, action, timestamp, prev_hash, entry_hash
   FROM audit_log
   WHERE id BETWEEN <broken_at - 2> AND <broken_at + 2>
   ORDER BY id;
   ```

2. **Verify the chain hash computation** for the entry before the break:
   ```sql
   -- The prev_hash of entry N should be SHA-256(entry N-1's id + event_type + timestamp + prev_hash)
   SELECT id, event_type, timestamp, prev_hash FROM audit_log WHERE id = <broken_at - 1>;
   ```

3. **Check for direct database modification** (superuser access, migration error):
   ```sql
   -- Check pg_stat_user_tables for UPDATE/DELETE counts
   SELECT n_tup_upd, n_tup_del FROM pg_stat_user_tables WHERE relname = 'audit_log';
   ```

4. **Review server access logs** for SSH sessions or database connections around the time of the break.

### Resolution

The audit chain is designed to be tamper-evident, not tamper-proof at the database superuser level. A break does not automatically indicate malicious activity; it could be caused by a bug in the hash computation, a database migration error, or a race condition.

1. **Do not attempt to "fix" the chain** by modifying entries. This would compound the integrity violation.
2. **Document the break**: Record the break point, surrounding entries, and probable cause.
3. **Investigate the cause**: Was it a code bug, a database migration, or unauthorized access?
4. **The chain continues from the last entry**: New entries are appended normally. The break remains as a permanent record.
5. **If the break was caused by a code bug**: Fix the bug, add a test, and document the known break in the audit log's own entries.
6. **If unauthorized database access is suspected**: Treat as a potential compromise (see Suspected Compromise below).

### Prevention

- Never grant UPDATE or DELETE on `audit_log` to application roles.
- The `trg_audit_no_update` trigger blocks application-level updates (except the controlled entry_hash set during insert).
- Test the hash chain after any database migration.
- Monitor the hourly verification job alerts.

---

## 6. Approval Token Stuck

### Symptoms

- A pending approval token does not resolve (not approved, not rejected, not expired).
- The operator sees a "pending approval" state in the UI that does not update.
- Queue of pending approvals grows.

### Diagnosis

1. **Check token status**:
   ```
   GET /api/approval/:id/status
   ```
   Look at `status`, `expires_at`, `issued_at`.

2. **Check if the iPhone device is reachable**: Can you access the approval interface on the iPhone?

3. **Check for token expiry**: If `expires_at` has passed but status is still `pending`, the expiry background job may not be running.

### Resolution

| Cause | Action |
|---|---|
| iPhone offline or notifications not received | Open the console on the iPhone manually and check pending approvals at `GET /api/approval/pending`. |
| Token expired but status not updated | The broker's background job should expire tokens. Restart the broker if the job is stalled. |
| Token backlog | Review and reject/approve all pending tokens. Clear the queue. |
| Approval push notification not working | Check WebSocket connection to the iPhone's session. Fall back to polling. |

To manually expire stuck tokens:
```sql
UPDATE approval_tokens
SET status = 'expired'
WHERE status = 'pending' AND expires_at < NOW();
```

### Prevention

- Ensure the broker's token expiry background job is running (check broker logs).
- Keep the iPhone accessible when performing write operations.
- Monitor pending approval count and alert if it exceeds a threshold.

---

## 7. Database Connection Exhausted

### Symptoms

- Broker returns HTTP 500 errors on most requests.
- Broker logs show: "cannot acquire connection" or "connection pool exhausted" or "too many clients."
- `pg_stat_activity` shows 20 active connections (pool maximum).

### Diagnosis

```sql
-- Count active connections
SELECT count(*), state FROM pg_stat_activity
WHERE datname = 'sovereign_console'
GROUP BY state;

-- Find long-running queries
SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
FROM pg_stat_activity
WHERE datname = 'sovereign_console'
  AND state != 'idle'
ORDER BY duration DESC;

-- Check for blocked queries
SELECT blocked_locks.pid AS blocked_pid,
       blocking_locks.pid AS blocking_pid,
       blocked_activity.query AS blocked_query
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
WHERE NOT blocked_locks.granted;
```

### Resolution

1. **Kill long-running queries** (statement timeout is 30 seconds, but advisory locks or serialization waits may exceed this):
   ```sql
   SELECT pg_terminate_backend(<pid>);
   ```

2. **Restart the broker** to reset the connection pool:
   ```bash
   docker compose restart broker
   ```

3. **If caused by audit log advisory lock contention** (unlikely for single-operator, but possible under rapid automated event logging): The `pg_advisory_xact_lock(1)` used in `appendLog` serializes audit inserts. If a transaction is stuck holding this lock, all subsequent audit writes block.

4. **Increase pool size** if the workload has legitimately grown (update broker configuration).

### Prevention

- Monitor active connection count via the health endpoint or direct query.
- Set appropriate `statement_timeout` in PostgreSQL configuration.
- The advisory lock in `appendLog` is transaction-scoped (`pg_advisory_xact_lock`), so it releases automatically when the transaction ends.

---

## 8. Redis Memory Full

### Symptoms

- Redis commands fail or return errors.
- Broker logs show Redis connection errors or OOM responses.
- Health endpoint reports `redis: { status: "error" }`.
- If eviction is enabled: sessions may be prematurely expired (users get logged out unexpectedly).

### Diagnosis

```bash
docker compose exec redis redis-cli INFO memory
docker compose exec redis redis-cli INFO stats | grep evicted_keys
docker compose exec redis redis-cli DBSIZE

# Find the largest keys
docker compose exec redis redis-cli --bigkeys
```

### Resolution

1. **If eviction is enabled (`allkeys-lru`)**: Redis is already evicting old keys. The impact is that cached session verifications (passkey, TOTP) may be lost, requiring re-authentication. This is not data loss, just inconvenience.

2. **If eviction is disabled (`noeviction`)**: Redis rejects new writes. Clear stale keys:
   ```bash
   # Remove expired session keys
   docker compose exec redis redis-cli KEYS "session:*" | head -100

   # Flush all (nuclear option, forces re-auth for everyone)
   docker compose exec redis redis-cli FLUSHDB
   ```

3. **Increase memory limit**:
   ```bash
   docker compose exec redis redis-cli CONFIG SET maxmemory 512mb
   ```
   Update `docker-compose.yml` to persist the change.

### Prevention

- Monitor Redis memory usage weekly (see Maintenance Guide).
- Set appropriate `maxmemory` based on expected key count.
- Ensure TTLs are set on all cached keys (sessions, rate limiters) so they expire naturally.
- For a single-operator system, 256 MB should be more than sufficient under normal conditions.

---

## 9. Emergency Disable Recovery

### Symptoms

- System is in emergency disabled state (intentionally triggered via `POST /api/system/emergency-disable`).
- All sessions are revoked. No authentication is possible through normal flow.
- The `system:emergency_disabled` flag is set in Redis.
- All agent registrations are suspended.

### Diagnosis

```bash
# Verify emergency flag
docker compose exec redis redis-cli GET system:emergency_disabled
# Returns "1" if disabled

# Check agent registration status
docker compose exec postgres psql -U sovereign_console -c \
  "SELECT id, name, status FROM agent_registrations;"
```

### Resolution

1. **Assess the situation**: Determine why emergency disable was triggered. Check the audit log for the `system.emergency_disable` entry:
   ```sql
   SELECT * FROM audit_log WHERE event_type = 'system.emergency_disable' ORDER BY id DESC LIMIT 1;
   ```

2. **Clear the emergency flag**:
   ```bash
   docker compose exec redis redis-cli DEL system:emergency_disabled
   ```

3. **Reactivate agent registrations**:
   ```sql
   UPDATE agent_registrations SET status = 'active' WHERE status = 'suspended';
   ```

4. **Authenticate normally**: Navigate to the console and log in with passkey. A new session will be created.

5. **Verify system state**: Check health endpoint, agent connection, audit chain.

6. **If emergency was triggered due to suspected compromise**: Do not re-enable until the compromise investigation is complete. See "Suspected Compromise" below.

### Prevention

- Emergency disable is a deliberate action requiring both passkey and TOTP. It cannot be triggered accidentally.
- Document the reason for triggering emergency disable in the audit log.

---

## 10. Break-Glass Recovery

### Symptoms

- Both enrolled devices are unavailable (lost, stolen, destroyed, corrupted).
- Normal authentication is impossible.
- No active sessions exist.

### Resolution

Follow the full break-glass recovery procedure documented in `docs/architecture/BREAK_GLASS_RECOVERY.md`:

1. **Access recovery URL**: `https://ops.lancewfisher.com/recover` (no authentication required to load the page).
2. **Enter recovery code**: One of the 10 single-use recovery codes stored in your physical secure location.
   - Rate limited: 3 attempts per 15 minutes per IP.
   - After 5 failures from any IP: 1-hour lockout.
3. **Optional TOTP**: If you have access to your authenticator app on a separate device, enter the TOTP code for stronger assurance.
4. **Device re-enrollment**: The broker generates a 15-minute enrollment invite. Open it on the replacement device and complete:
   - WebAuthn passkey registration.
   - TOTP provisioning.
   - Client certificate issuance (if Windows workstation).
5. **Recovery code rotation**: After using one code, ALL 10 codes are invalidated and a new set of 10 is generated. Save these to your secure physical location.
6. **Second device enrollment**: After the first device is enrolled, authenticate normally and enroll the second device.

All break-glass events are fully logged:
- `BREAK_GLASS_PAGE_ACCESSED`, `BREAK_GLASS_CODE_ATTEMPT`, `BREAK_GLASS_INITIATED`, `BREAK_GLASS_COMPLETED`, `RECOVERY_CODES_ROTATED`, `DEVICE_REVOKED`.

### Prevention

- Store recovery codes in a physically secure location (safe, safety deposit box).
- Verify codes are accessible quarterly (see Maintenance Guide).
- Do not store codes digitally on any connected device.

---

## 11. Suspected Compromise

### Symptoms

- Unrecognized entries in the audit log (unknown IP addresses, unexpected operations).
- Devices you did not enroll appearing in the device list.
- Files modified that you did not authorize.
- Break-glass recovery events you did not initiate.
- Audit chain integrity violations.

### Immediate Actions

1. **Trigger emergency disable**:
   ```
   POST /api/system/emergency-disable
   ```
   This revokes all sessions, expires all approval tokens, rejects all queued commands, and suspends all agents.

2. **If you cannot authenticate** (attacker changed credentials): Use break-glass recovery to regain access, then immediately trigger emergency disable.

### Investigation

1. **Capture the audit log**:
   ```bash
   # Export full audit log
   docker compose exec postgres pg_dump -U sovereign_console -t audit_log --data-only \
     > /tmp/incident_audit_$(date +%Y%m%d).sql
   ```

2. **Review for unauthorized activity**:
   ```sql
   -- Recent auth events from unknown IPs
   SELECT * FROM audit_log
   WHERE event_type LIKE 'auth.%'
   ORDER BY id DESC LIMIT 100;

   -- Device enrollment events
   SELECT * FROM audit_log
   WHERE event_type LIKE 'device.%'
   ORDER BY id DESC LIMIT 50;

   -- File write events
   SELECT * FROM audit_log
   WHERE event_type = 'file.write'
   ORDER BY id DESC LIMIT 50;

   -- Break-glass events
   SELECT * FROM audit_log
   WHERE event_type LIKE 'device.recovery%'
   ORDER BY id DESC;
   ```

3. **Check VPS access logs**:
   ```bash
   # SSH access
   last -50
   grep 'sshd' /var/log/auth.log | tail -50

   # NGINX access to sensitive endpoints
   grep -E '/api/(auth|devices|system)' /var/log/nginx/access.log | tail -100
   ```

### Credential Rotation

After investigation, rotate all credentials:

1. **Revoke all devices** and re-enroll from scratch.
2. **Rotate recovery codes**: Use one code to trigger rotation, or generate a fresh set.
3. **Reprovision TOTP**: Generate a new TOTP secret on all devices.
4. **Rotate database passwords**: Update credentials for `broker_audit`, `agent_audit`, and `audit_verifier` database roles.
5. **Rotate Redis password** if one is configured.
6. **Regenerate agent mTLS certificates**: Revoke old certs and issue new ones.
7. **Rotate the broker's session signing key** (if applicable): This invalidates all existing sessions.
8. **Update the GPG key** used for audit backup encryption if there is any chance it was compromised.

### Session Revocation

```sql
-- Verify all sessions are revoked (should already be done by emergency disable)
SELECT id, operator_id, device_id, created_at, expires_at, revoked_at
FROM sessions
WHERE revoked_at IS NULL AND expires_at > NOW();

-- Force revoke if any remain
UPDATE sessions SET revoked_at = NOW()
WHERE revoked_at IS NULL AND expires_at > NOW();
```

### Forensics

- Preserve all logs before rotating anything.
- Back up the current database state.
- Compare the audit log against known-good backups to identify the first unauthorized entry.
- Check if the audit chain was broken (indicating direct database manipulation).
- Review the VPS for rootkits or unauthorized software: `rkhunter`, `chkrootkit`, or equivalent.

### Re-Enable After Investigation

1. Clear emergency disable flag.
2. Reactivate agent registrations.
3. Re-enroll all devices with fresh credentials.
4. Verify the audit chain.
5. Resume normal operations.
6. Document the incident: what happened, how access was obtained, what was changed, and what mitigations were applied.

### Prevention

- Enforce strong SSH key-only access to the VPS (no password authentication).
- Keep all software updated (OS, Docker, Node.js, dependencies).
- Monitor for unusual audit log patterns.
- Verify recovery codes are physically secure.
- Regularly review enrolled devices and active sessions.
