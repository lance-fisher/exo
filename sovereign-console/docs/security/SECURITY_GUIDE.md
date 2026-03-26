# Sovereign Operator Console -- Security Architecture Guide

> **Governance note**: This document defers to root governance (CLAUDE.md Sections 0.6, 6, 13)
> for overarching security rules. Security rules defined here may only tighten root
> protections, never loosen them. In particular: credentials must never be committed to
> version control (Section 13, Rule 2), DRY_RUN defaults must never be loosened (Section 13,
> Rule 1), and all sensitive data handling follows Section 0.6 security defaults.

## Document Purpose

This guide describes the security architecture of the Sovereign Operator Console for the
operator. It covers the defense-in-depth strategy, key security decisions, hardening
procedures, and operational security practices. Use this document as the reference for
deployment, configuration, and ongoing security maintenance.

---

## 1. Defense-in-Depth Architecture

The system implements five independent security layers. A request must pass through all
applicable layers to execute. Compromise of any single layer does not grant full access.

### Layer 1: Transport Security (TLS + mTLS)

**Browser to Broker**:
- TLS 1.3 via NGINX reverse proxy with Let's Encrypt certificate for `ops.lancewfisher.com`.
- HSTS with 1-year max-age, includeSubDomains, and preload directive.
- No TLS 1.2 fallback. Only TLS 1.3 cipher suites are permitted.

**Agent to Broker**:
- Mutual TLS over WebSocket (`wss://ops.lancewfisher.com/agent/ws`).
- Agent presents a client certificate signed by the system's internal CA during enrollment.
- Broker validates the client certificate fingerprint against the enrolled device registry on every connection (`broker/src/agent-relay/index.ts`).
- Certificates expire after 90 days. Renewal is initiated automatically by the agent 14 days before expiry.

**Key decision**: mTLS for the agent channel was chosen over API key authentication because it provides mutual verification (both sides prove identity), is resistant to credential theft via network interception, and integrates with the existing certificate infrastructure. An API key transmitted over TLS would protect against interception but not against server impersonation if TLS is compromised.

### Layer 2: Authentication (WebAuthn Passkeys)

**Primary authentication**: WebAuthn / FIDO2 passkeys with platform authenticators.
- Windows: TPM 2.0-backed credential. Non-extractable, non-syncable.
- iPhone: Secure Enclave-backed credential. Synced via iCloud Keychain (mitigated by device trust layer).
- No password authentication exists in the system. There is no password field, no password hash, and no password reset flow.
- Registration is only possible during time-limited enrollment windows (15-minute single-use invite links).

**Authentication ceremony validation** (`broker/src/auth/webauthn.ts`):
1. Challenge matches server-issued challenge (replay prevention).
2. Origin matches `https://ops.lancewfisher.com`.
3. RP ID matches `ops.lancewfisher.com`.
4. User verification (UV) flag is set in authenticator data.
5. Signature validates against stored public key.
6. Signature counter is strictly greater than stored counter (clone detection).
7. Credential ID matches an enrolled device in `active` status.

**Key decision**: Passkeys were chosen over passwords because they are phishing-resistant (bound to the RP origin), cannot be reused across services, and do not require the operator to manage or remember credentials. TPM attestation on Windows ensures the key cannot be extracted or synced to unauthorized locations.

### Layer 3: Step-Up Authentication (TOTP)

**When required**: All write operations, delete operations, execute operations, sensitive configuration changes, device revocation, and re-enrollment.

**Implementation** (`broker/src/auth/totp.ts`):
- RFC 6238 TOTP with 30-second period, 6-digit codes, HMAC-SHA1.
- 1-step window tolerance (accepts t-1, t, t+1 for clock skew).
- Secrets encrypted at rest with AES-256-GCM. Encryption key derived from `TOTP_ENCRYPTION_KEY` environment variable.
- Secrets decrypted only at the moment of validation, in memory, and immediately discarded.
- Replay prevention: Each code can only be used once per period (tracked via Redis with 90-second TTL).

**Rate limiting**:
- 3 attempts per 90-second window.
- 5 failures within 5 minutes triggers 15-minute lockout.
- Lockout scope is per-operator (not global).

**Key decision**: TOTP was chosen as the step-up factor because it is independent of both the passkey ecosystem and the device trust layer. If either the passkey or the device is compromised, TOTP on a separate authenticator app (backed up to the cloud) provides an independent barrier. TOTP's simplicity and wide authenticator app support also reduce the risk of the operator being locked out.

### Layer 4: Authorization (Approval Tokens)

**When required**: Every write, delete, or execute operation.

**Properties** (implemented in `broker/src/approval/index.ts`):
- Single-use: Atomically consumed via `UPDATE ... WHERE status = 'approved' RETURNING id`.
- Time-limited: 5-minute TTL for writes, 2-minute TTL for deletes and executes.
- Scope-bound: Tied to specific `(action_type, resource_path, operation, payload_hash)`.
- Device-bound: Must be approved by a different device than the one that requested the action.
- Cryptographically random nonce (32 bytes) per token.
- Payload hash (SHA-256) prevents post-approval payload modification.

**Cross-device approval**: Neither device can self-approve destructive actions. If a write is requested from the Windows laptop, approval must come from the iPhone, and vice versa.

**Key decision**: The cross-device approval requirement was chosen to ensure that compromise of a single device cannot authorize write operations. An attacker who compromises the Windows workstation still cannot write files without the iPhone's approval. This is the strongest single defense against device compromise.

### Layer 5: Audit (Hash-Chained Log)

**Implementation** (`broker/src/audit/index.ts`):
- Append-only PostgreSQL table with SHA-256 hash chaining.
- Each entry's `prev_hash` links to the previous entry; `entry_hash` covers the entry's own fields.
- Database roles restricted to INSERT + SELECT only. A trigger (`trg_audit_no_update`) blocks UPDATE operations except during the initial hash computation.
- Advisory lock (`pg_advisory_xact_lock(1)`) serializes inserts to maintain strict chain ordering.
- Hourly verification job walks the entire chain and alerts on discontinuity.
- Daily encrypted backups exported and verified.

**Key decision**: Hash chaining was chosen over a simple append-only table because it provides cryptographic tamper evidence. A simple append-only table relies on database-level access controls, which can be bypassed by a superuser. The hash chain means that even if an entry is modified at the database level, the modification is detectable by any party that can verify the chain.

---

## 2. Key Security Decisions and Rationale

| Decision | Rationale |
|---|---|
| No passwords anywhere in the system | Eliminates credential stuffing, password reuse, and phishing attacks against passwords. |
| Two-device maximum enrollment | Limits the attack surface. Every additional device is an additional compromise vector. |
| Cross-device approval for writes | Ensures single-device compromise cannot authorize destructive operations. |
| Agent connects outbound (not inbound) | The workstation firewall does not need to accept inbound connections. The agent initiates the WebSocket connection to the broker. |
| Subprocess-per-task for Claude Code | Each task gets a clean environment with no leaked context. Process lifecycle is clear and killable. |
| Secret redaction before transmission | Secrets in project files are redacted at the agent before leaving the workstation. Even a compromised broker cannot see raw secrets from project files. |
| Session tokens hashed before storage | The raw session token is never stored in PostgreSQL or Redis. Only the SHA-256 hash is stored (`broker/src/auth/session.ts` line 11). If the database is dumped, session tokens cannot be extracted. |
| Recovery codes as last resort | Break-glass recovery exists but is intentionally high-friction to prevent it from becoming an easy bypass. |

---

## 3. Hardening Checklist

### 3.1 NGINX

- [ ] TLS 1.3 only (`ssl_protocols TLSv1.3;`)
- [ ] Strong cipher suite (`ssl_ciphers 'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256';`)
- [ ] HSTS header with preload (`add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;`)
- [ ] Disable server tokens (`server_tokens off;`)
- [ ] Rate limiting (`limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;`)
- [ ] Connection limiting (`limit_conn_zone $binary_remote_addr zone=addr:10m; limit_conn addr 20;`)
- [ ] Request body size limit (`client_max_body_size 1m;`)
- [ ] Disable unnecessary HTTP methods (`if ($request_method !~ ^(GET|HEAD|POST|PUT|DELETE|OPTIONS)$) { return 405; }`)
- [ ] Proxy headers for real IP (`proxy_set_header X-Real-IP $remote_addr; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`)
- [ ] Proxy WebSocket upgrade for agent endpoint (`proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`)
- [ ] mTLS on agent WebSocket endpoint (`ssl_client_certificate /etc/nginx/certs/ca.pem; ssl_verify_client optional_no_ca;` on the agent location, with validation delegated to the broker)
- [ ] Access log and error log enabled with rotation

### 3.2 Docker

- [ ] Run containers as non-root user (`USER node` in Dockerfile)
- [ ] Read-only filesystem where possible (`--read-only` flag with tmpfs for `/tmp`)
- [ ] No privileged mode (`--security-opt=no-new-privileges`)
- [ ] Drop all capabilities, add back only what is needed (`--cap-drop=ALL`)
- [ ] Restrict network: broker and UI containers on an internal Docker network; only NGINX is exposed
- [ ] Pin base images to specific digests (not just tags)
- [ ] Scan images for vulnerabilities (`docker scout` or Trivy)
- [ ] Mount secrets as read-only volumes or use Docker secrets, not environment variables in the Dockerfile
- [ ] Health checks defined for all containers
- [ ] Resource limits (`--memory`, `--cpus`) to prevent resource exhaustion

### 3.3 PostgreSQL

- [ ] Run in Docker with localhost-only port binding (`127.0.0.1:5432:5432`)
- [ ] Separate database roles per function:
  - `broker_app`: Full CRUD on sessions, devices, approval_tokens, operators, passkey_credentials, totp_secrets; INSERT + SELECT on audit_log
  - `audit_verifier`: SELECT only on audit_log
  - No application role has superuser or CREATEROLE privileges
- [ ] `pg_hba.conf`: Restrict connections to localhost and Docker network only; no `host all all 0.0.0.0/0` entries
- [ ] `postgresql.conf`:
  - `ssl = on` (even for localhost, defense in depth)
  - `log_connections = on`
  - `log_disconnections = on`
  - `log_statement = 'ddl'` (log all DDL statements)
  - `password_encryption = 'scram-sha-256'`
- [ ] No default `postgres` password; generate a strong random password
- [ ] Regular `pg_dump` backups with encrypted export (see audit log backup procedure)
- [ ] Enable the `trg_audit_no_update` trigger on the `audit_log` table
- [ ] Verify no UPDATE or DELETE grants exist on `audit_log` for application roles

### 3.4 Redis

- [ ] Run in Docker with localhost-only port binding (`127.0.0.1:6379:6379`)
- [ ] Set `requirepass` in Redis configuration with a strong random password
- [ ] Disable dangerous commands: `rename-command FLUSHDB ""`, `rename-command FLUSHALL ""`, `rename-command CONFIG ""`, `rename-command DEBUG ""`
- [ ] Set `maxmemory` and `maxmemory-policy allkeys-lru`
- [ ] Disable RDB persistence if Redis is used only for ephemeral data (sessions, rate limits, nonces)
- [ ] No public network exposure

### 3.5 Node.js (Broker and Agent)

- [ ] Run on Node.js 20 LTS (latest security patches)
- [ ] Use `--experimental-permission` flag if available, restricting filesystem and network access
- [ ] Set `NODE_ENV=production`
- [ ] Disable `X-Powered-By` header (Fastify does not set this by default)
- [ ] Run `npm audit` before every deployment; resolve critical and high vulnerabilities
- [ ] Pin all dependencies in `package-lock.json`; verify integrity with `npm ci` (not `npm install`)
- [ ] Do not install `devDependencies` in production images
- [ ] Set appropriate `ulimit` values for the Node.js process (file descriptors, memory)

### 3.6 Firewall (VPS)

- [ ] Default policy: deny all inbound, allow all outbound
- [ ] Allow inbound: TCP 80 (HTTP, for Let's Encrypt ACME challenge and redirect to HTTPS), TCP 443 (HTTPS), TCP 22 (SSH, restricted to operator's IP or VPN)
- [ ] Block all other inbound ports
- [ ] If using `ufw`:
  ```
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow from <operator-ip> to any port 22
  ufw enable
  ```
- [ ] Verify with `ufw status verbose` or `iptables -L -n`
- [ ] Review and update allowed SSH source IPs when the operator's IP changes

### 3.7 SSH (VPS)

- [ ] Key-based authentication only (`PasswordAuthentication no`)
- [ ] Disable root login (`PermitRootLogin no`)
- [ ] Use a non-default SSH port (optional but reduces noise)
- [ ] Install and configure `fail2ban` for SSH brute-force protection
- [ ] Restrict SSH to the operator's IP range in the firewall

---

## 4. Security Headers Configuration

All security headers are set in `broker/src/middleware/security.ts` via the Fastify `onSend` hook. They apply to every response from the broker.

| Header | Value | Purpose |
|---|---|---|
| `Content-Security-Policy` | `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` | Prevents XSS, inline script execution, framing, and form submission to external origins |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | Enforces HTTPS for 1 year; prevents TLS downgrade |
| `X-Frame-Options` | `DENY` | Prevents clickjacking (redundant with CSP frame-ancestors but included for older browsers) |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME type confusion attacks |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits referrer information leakage to same-origin requests |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` | Disables browser APIs that the console does not need |
| `Cache-Control` | `no-store, no-cache, must-revalidate, private` | Prevents caching of sensitive responses |
| `Pragma` | `no-cache` | HTTP/1.0 cache prevention (backward compatibility) |

**CSP notes**:
- `connect-src 'self' wss:` allows WebSocket connections for real-time task updates and agent status.
- No `unsafe-inline` or `unsafe-eval` directives. All JavaScript must be served from the same origin.
- `frame-ancestors 'none'` is the CSP equivalent of `X-Frame-Options: DENY`.

---

## 5. Rate Limiting Configuration

Rate limiting is applied at two layers: NGINX (network layer) and application (Fastify/agent).

### NGINX Layer (Per-IP)

| Endpoint Pattern | Rate | Burst | Purpose |
|---|---|---|---|
| All endpoints (default) | 10 req/s | 20 | General protection against automated scanning |
| `/api/auth/*` | 5 req/s | 10 | Protect authentication endpoints from brute force |
| `/recover` | 1 req/s | 3 | Strict limit on break-glass recovery attempts |

### Application Layer (Per-Session)

| Scope | Limit | Window | Implementation |
|---|---|---|---|
| API operations | 60 ops/min | 1 minute | Fastify middleware checking Redis counter per session_id |
| TOTP validation | 3 attempts | 90 seconds | Redis counter per operator_id (`broker/src/auth/totp.ts`) |
| TOTP lockout | 5 failures | 5 minutes | 15-minute lockout triggered (`broker/src/auth/totp.ts`) |
| Recovery codes | 3 attempts | 15 minutes | Per-IP; 5 failures from any IP triggers 1-hour endpoint lockout |
| Recovery lockout escalation | 3 lockouts | 24 hours | 24-hour lockout |

### Agent Layer (Per-Session)

| Scope | Limit | Window | Implementation |
|---|---|---|---|
| All commands | 30/min | 1 minute | In-memory rate limiter (`local-agent/src/governance/index.ts`) |
| Tasks per session | 20 max | Session lifetime | Configuration limit (`maxTasksPerSession`) |
| Tokens per task | 50,000 max | Per-task | Configuration limit (`maxTokensPerTask`) |

---

## 6. Secret Management Practices

### 6.1 Secret Inventory

| Secret | Storage Location | Rotation Frequency | Notes |
|---|---|---|---|
| `JWT_SECRET` | Broker `.env` | Annually or on suspected compromise | Min 64 characters |
| `SESSION_SECRET` | Broker `.env` | Annually or on suspected compromise | Min 32 characters; used for request signature HMAC |
| `TOTP_ENCRYPTION_KEY` | Broker `.env` | Annually; requires re-encrypting all TOTP secrets | Min 64 hex characters (32 bytes) |
| `DATABASE_URL` | Broker `.env` | On suspected compromise | Contains PostgreSQL password |
| `REDIS_URL` | Broker `.env` | On suspected compromise | Contains Redis password (if configured) |
| `AGENT_SECRET` | Agent `.env` | Annually or on suspected compromise | Min 16 characters; used for approval token HMAC |
| mTLS CA private key | VPS secure storage | When CA cert approaches expiry | Never transmitted; never stored in application code |
| mTLS broker cert/key | `AGENT_MTLS_CERT` / `AGENT_MTLS_KEY` | 90 days (auto-renewal via Let's Encrypt) | |
| mTLS agent cert/key | Agent `certs/` directory | 90 days (auto-renewal initiated by agent) | |
| Recovery codes | Operator's physical safe | After any single use (entire set rotated) | 10 codes, 32-char alphanumeric, bcrypt-hashed in DB |
| WebAuthn private keys | Device hardware (TPM/Secure Enclave) | Non-extractable; replaced only on device re-enrollment | Never accessible to software |
| TOTP shared secrets | Encrypted in PostgreSQL + operator's authenticator app | On reprovisioning | AES-256-GCM encrypted at rest |

### 6.2 Secret Handling Rules

1. **Never commit secrets to version control.** Use `.env.example` as the committed template with placeholder values.
2. **Never log secrets.** The broker logger and agent logger must never output credential values. Approval token IDs and nonces are truncated to 8 characters in logs (`docs/architecture/APPROVAL_TOKEN_SPEC.md`).
3. **Never transmit secrets in URL parameters.** Approval tokens are included in request bodies only.
4. **Secrets in environment variables** are loaded once at startup and validated via Zod schema (`broker/src/config.ts`, `local-agent/src/config.ts`). They are not re-read or cached beyond the initial load.
5. **TOTP secrets are decrypted in memory only at the moment of validation** and immediately discarded after use (`broker/src/auth/totp.ts`).
6. **Backup encryption keys must be stored separately from backups.** The audit backup key (`/root/.audit-backup-key` on VPS) should ideally be moved to a separate secure location not on the VPS itself.

### 6.3 Secret Redaction at the Agent

The agent's `SecretRedactionService` (`local-agent/src/services/secret-redaction.ts`) scans all content before it leaves the workstation. This is the last line of defense against accidental secret exposure.

**What is redacted**:
- Generic key=value secrets (API_KEY, SECRET, PASSWORD, TOKEN, etc.)
- Bearer tokens in HTTP headers
- AWS access keys and secret keys
- Private key PEM blocks
- Connection strings with embedded passwords
- GitHub, GitLab, Slack, Stripe, npm tokens
- .env file values with secret-looking keys
- High-entropy strings (Shannon entropy >= 4.5, length >= 32 characters)

**False positive handling**: The redactor includes heuristics to skip hex strings (git hashes), camelCase identifiers, UUIDs, and low-variety strings. Over-redaction is preferred over under-redaction.

---

## 7. Logging and Monitoring Recommendations

### 7.1 What to Log

The audit log captures all security-relevant events (see `docs/architecture/AUDIT_LOG_INTEGRITY.md` for the full event type list). Key events to monitor:

| Event Pattern | Significance | Recommended Action |
|---|---|---|
| `AUTH_PASSKEY_FAILURE` repeated from same IP | Potential credential stuffing | Block IP after 5 failures |
| `AUTH_TOTP_LOCKOUT` | Repeated TOTP failures | Verify operator is not under attack |
| `PASSKEY_USED_FROM_UNKNOWN_DEVICE` | Passkey used from non-enrolled device | Investigate immediately; possible iCloud sync exploitation |
| `AGENT_CONNECTED` from unexpected IP | Agent connecting from a new location | Verify this is the operator's workstation |
| `AGENT_DISCONNECTED` / `AGENT_RECONNECTED` flapping | 3+ disconnections in 2 minutes | Check network stability; possible interception attempt |
| `INTEGRITY_CHECK_FAILED` | Audit log hash chain broken | Critical: investigate database access immediately |
| `BREAK_GLASS_PAGE_ACCESSED` | Someone accessed the recovery URL | May be legitimate; review IP and timing |
| `CERT_REVOKED` without operator-initiated action | Certificate revoked unexpectedly | Investigate; possible unauthorized access |
| `DEVICE_ENROLLED` when both slots are full | Enrollment attempt beyond 2-device limit | Should be rejected; verify no bypass exists |

### 7.2 Log Retention

| Log Type | Retention | Storage |
|---|---|---|
| Audit log (PostgreSQL) | Indefinite | Database |
| Audit log backups (local) | 7 days | VPS `/var/backups/audit/` |
| Audit log backups (remote) | 1 year minimum | S3-compatible storage |
| NGINX access/error logs | 90 days | VPS `/var/log/nginx/` |
| Broker application logs | 30 days | Docker logs or mounted volume |
| Agent application logs | 30 days | WinSW log directory with rotation |

### 7.3 Monitoring Setup

**Minimum viable monitoring**:

1. **Audit chain verification**: The hourly job already exists (`broker/src/audit/index.ts` `verifyChain()`). Ensure it sends alerts on failure.
2. **NGINX error rate**: Monitor for spikes in 4xx/5xx responses (potential scanning or attack).
3. **Agent connectivity**: The Console UI shows connection status. Set up an external uptime check for `https://ops.lancewfisher.com` (e.g., UptimeRobot, Healthchecks.io).
4. **Certificate expiry**: Monitor Let's Encrypt certificate and mTLS client certificate expiry dates. Alert at 14 days before expiry.
5. **Disk space**: Audit logs and backups grow over time. Monitor VPS disk usage.
6. **Docker container health**: Use Docker healthchecks and `docker ps` monitoring.

**Recommended additions**:

- Log aggregation to a separate service (e.g., Loki, CloudWatch) so logs survive VPS compromise.
- Anomaly detection on authentication patterns (unusual times, unusual IPs).
- Automated `npm audit` checks with alerts on critical vulnerabilities.

### 7.4 Incident Response Indicators

| Indicator | Severity | Immediate Action |
|---|---|---|
| Audit chain integrity failure | Critical | Stop all operations; investigate database access; compare against backups |
| Multiple unknown-device passkey events | High | Suspend affected device; check iCloud Keychain sync status |
| Agent connection from unexpected IP | High | Revoke agent certificate; investigate workstation |
| Recovery endpoint brute force (multiple lockouts) | Medium | Verify recovery codes are physically secure; consider temporarily disabling endpoint |
| Simultaneous sessions from different IPs for same device | High | Revoke all sessions; re-authenticate; investigate session theft |

---

## 8. Deployment Security Checklist

Before the first deployment, verify all of the following:

### Pre-Deployment

- [ ] All secrets generated with cryptographically secure random generators (not predictable values)
- [ ] `.env` files are in `.gitignore` and not committed
- [ ] `.env.example` committed with placeholder values
- [ ] `npm audit` shows no critical or high vulnerabilities
- [ ] All dependencies pinned in `package-lock.json`
- [ ] Docker images built from pinned base images
- [ ] Firewall rules configured and verified
- [ ] SSH key-based authentication configured; password auth disabled
- [ ] PostgreSQL roles created with least-privilege access
- [ ] Redis `requirepass` configured
- [ ] mTLS CA certificate and broker certificate generated
- [ ] NGINX configuration reviewed against hardening checklist
- [ ] Let's Encrypt certificate obtained and auto-renewal configured
- [ ] CAA DNS record set to restrict certificate issuance

### First Enrollment

- [ ] First device enrolled via SSH-generated invite link (not via any web endpoint)
- [ ] WebAuthn passkey registered with TPM attestation verified
- [ ] TOTP provisioned and confirmed with a valid code
- [ ] Recovery codes generated, displayed once, saved to physical secure location
- [ ] Second device enrolled via authenticated session on first device
- [ ] Break-glass recovery tested end-to-end (consumes one code, triggers rotation)
- [ ] New recovery codes saved after test rotation

### Post-Deployment

- [ ] Audit log genesis entry created and chain verified
- [ ] Hourly chain verification job scheduled and tested
- [ ] Daily backup job scheduled and tested (export, encrypt, verify, upload)
- [ ] Agent connected via mTLS and verified in Console UI
- [ ] Full task execution flow tested (read-only and write with approval)
- [ ] Rate limiting tested (verify 429 responses at threshold)
- [ ] Session expiry tested (verify re-auth required after 30 minutes)
- [ ] TOTP lockout tested (verify 15-minute lockout after 5 failures)
