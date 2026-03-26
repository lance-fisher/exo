# Sovereign Operator Console -- Threat Model

> **Governance note**: This document defers to root governance (CLAUDE.md Sections 0.6, 6, 13)
> for overarching security rules. Security rules defined here may only tighten root
> protections, never loosen them. All credential handling, commit safety, and secret
> management practices described here are additive to the root-level Non-Negotiables.

## Document Purpose

This threat model identifies attack surfaces, threat actors, and mitigations for each
component of the Sovereign Operator Console. It is intended to be reviewed before deployment,
after any architectural change, and periodically (at minimum annually) to ensure residual
risks remain acceptable.

---

## 1. Threat Actors

### 1.1 Nation-State / Advanced Persistent Threat (APT)

- **Capability**: Zero-day exploits, supply chain attacks, persistent surveillance, hardware implants, compromised certificate authorities.
- **Motivation**: Access to development infrastructure, intellectual property theft, implanting backdoors in downstream projects.
- **Relevant attack paths**: Compromise of the VPS hosting provider (Hostinger), compromise of the Let's Encrypt CA chain, supply chain poisoning of npm dependencies, interception of mTLS traffic via compromised CAs.
- **Likelihood for this system**: Low. Single-operator personal infrastructure is not a high-value APT target.
- **Impact if successful**: Complete system compromise, persistent access to the operator's development environment.

### 1.2 Opportunistic Attacker

- **Capability**: Automated scanning, credential stuffing, known CVE exploitation, phishing.
- **Motivation**: Cryptocurrency wallet theft, compute hijacking, ransomware deployment.
- **Relevant attack paths**: Scanning `ops.lancewfisher.com` for exposed endpoints, brute-forcing the recovery endpoint, exploiting unpatched Node.js or NGINX vulnerabilities, phishing the operator for TOTP codes.
- **Likelihood for this system**: Medium. Internet-facing services are routinely scanned.
- **Impact if successful**: Varies from reconnaissance (low) to full agent control (critical).

### 1.3 Insider / Self-Compromise

- **Capability**: Full physical access to enrolled devices, knowledge of system architecture, access to recovery codes.
- **Motivation**: Accidental misconfiguration, testing shortcuts that weaken security, leaving debug endpoints enabled.
- **Relevant attack paths**: Committing secrets to version control, disabling mTLS for debugging, leaving the recovery code in a digital location, running the agent outside the WinSW service wrapper without governance enforcement.
- **Likelihood**: Medium-high. Single-operator systems are most vulnerable to the operator's own shortcuts.
- **Impact**: Potentially equivalent to full compromise if secrets are exposed.

### 1.4 Compromised Device

- **Capability**: Malware on the Windows workstation or iPhone with access to the device's keychain, certificate store, or clipboard.
- **Motivation**: Keylogging TOTP codes, extracting client certificates, intercepting WebSocket traffic, impersonating the agent.
- **Relevant attack paths**: Extracting the mTLS client certificate private key from the Windows certificate store, clipboard monitoring during TOTP entry, browser extension compromise intercepting WebAuthn ceremonies, stealing session cookies from browser storage.
- **Likelihood**: Low-medium. Windows workstations are a common malware target.
- **Impact**: Single device compromise is contained by the two-device trust model. Both-device compromise is equivalent to full system compromise.

---

## 2. Attack Surfaces

### 2.1 Broker (VPS -- Internet-Facing)

The broker at `ops.lancewfisher.com` is the primary internet-facing component. It is the highest-risk attack surface.

#### 2.1.1 NGINX Reverse Proxy

| Threat | Description | Existing Mitigations | Residual Risk |
|---|---|---|---|
| TLS downgrade | Attacker forces a weaker cipher suite or protocol version | NGINX configured for TLS 1.3 only; HSTS with `max-age=31536000; includeSubDomains; preload` (`broker/src/middleware/security.ts` line 30) | Minimal. TLS 1.3 has no known downgrade attacks. |
| Certificate impersonation | Attacker obtains a fraudulent TLS certificate for `ops.lancewfisher.com` | Let's Encrypt with ACME HTTP-01 challenge; CAA DNS records should be configured to restrict issuance to Let's Encrypt | Residual: a compromised registrar or DNS provider could allow certificate misissuance. Mitigate with CAA records and Certificate Transparency monitoring. |
| HTTP request smuggling | Malformed requests exploit NGINX/Fastify parsing differences | NGINX and Fastify use well-tested HTTP parsers; keep both updated | Low residual risk. Monitor CVEs for both. |
| DDoS | Volumetric or application-layer denial of service | NGINX rate limiting (10 req/s per IP, documented in CLAUDE.md Security Notes); Hostinger's upstream network filtering | Residual: application-layer slowloris or targeted attacks may bypass IP rate limiting. Consider Cloudflare or fail2ban for additional protection. |
| Exposed management ports | SSH, database, or Redis ports accessible from the internet | Docker containers bind to localhost only; NGINX reverse proxy is the sole public listener | Residual: firewall misconfiguration. Verify with `ufw` or `iptables` rules. |

#### 2.1.2 Fastify API

| Threat | Description | Existing Mitigations | Residual Risk |
|---|---|---|---|
| Authentication bypass | Attacker accesses protected endpoints without a valid session | `requireAuth` middleware validates session token from HttpOnly cookie against Redis/PostgreSQL; checks device enrollment status (`broker/src/middleware/auth.ts` lines 28-64) | Low. Session tokens are 48 random bytes, SHA-256 hashed before storage (`broker/src/auth/session.ts` line 11). |
| Session hijacking | Attacker steals or forges a session cookie | Cookies are `HttpOnly`, `Secure`, `SameSite=Strict`; session bound to `device_id`; 30-minute expiry with 8-hour max lifetime | Residual: XSS in the console-ui could exfiltrate cookies despite HttpOnly if a vulnerability allows reading document.cookie indirectly. CSP mitigates this. |
| CSRF | Cross-site request forces authenticated action | `SameSite=Strict` cookie policy; anti-replay nonce on mutating requests (`broker/src/middleware/security.ts` lines 94-128); CORS restricted to `https://ops.lancewfisher.com` (`broker/src/config.ts` line 44) | Minimal with SameSite=Strict. |
| Request replay | Attacker captures and replays a valid request | Anti-replay nonce system using Redis GETDEL for atomic single-use validation (`broker/src/middleware/security.ts` lines 58-72); nonces expire after 5 minutes | Low. Nonce is optional on some endpoints (logged as debug warning, line 107). Consider making nonce mandatory for all mutating endpoints. |
| Rate limit bypass | Attacker circumvents rate limits using distributed IPs | Per-IP rate limiting at NGINX layer; per-session rate limiting at application layer (60 ops/min) | Residual: distributed attacks from botnets. Acceptable for a single-operator system. |
| Input validation bypass | Malicious payloads in API request bodies | Zod schema validation on config (`broker/src/config.ts`); Fastify schema validation on routes | Low, provided all route schemas are comprehensive. |

#### 2.1.3 WebSocket (Agent Relay)

| Threat | Description | Existing Mitigations | Residual Risk |
|---|---|---|---|
| Unauthorized agent connection | Attacker connects a rogue agent to the broker | mTLS required; broker validates client certificate fingerprint against `agent_registrations` table (`broker/src/agent-relay/index.ts` lines 28-44); unknown certs are rejected with code 4001 | Low. Requires possession of the CA-signed client certificate. |
| Agent impersonation after cert theft | Attacker obtains the agent's client certificate and private key | Certificate fingerprint validated against enrolled device registry; 90-day cert expiry; revocation list checked on every connection | Residual: window of exposure between compromise and detection. Mitigate with certificate pinning and anomaly detection (dual-connection alerts). |
| WebSocket message injection | Attacker injects commands into the agent WebSocket stream | mTLS prevents MITM; messages are JSON-parsed with error handling (`broker/src/agent-relay/index.ts` line 63); broker-side command validation before forwarding | Low under mTLS. |
| Agent message spoofing | Compromised agent sends fabricated results | Agent responses are matched to pending command IDs (`broker/src/agent-relay/index.ts` lines 104-148); results are logged to audit trail | Residual: a compromised agent can lie about execution results. This is inherent to any agent architecture. Audit log provides forensic evidence. |

### 2.2 Console UI (Browser SPA)

| Threat | Description | Existing Mitigations | Residual Risk |
|---|---|---|---|
| XSS (stored or reflected) | Attacker injects JavaScript into the console UI | CSP: `script-src 'self'` (no inline scripts, no eval); `default-src 'none'` with explicit allowlist (`broker/src/middleware/security.ts` lines 14-26); `X-Content-Type-Options: nosniff` | Low. CSP blocks inline script execution. Residual: CSP bypass via a vulnerable first-party script. |
| Clickjacking | Attacker frames the console UI in a malicious page | `X-Frame-Options: DENY`; CSP `frame-ancestors 'none'` (`broker/src/middleware/security.ts` lines 36, 23) | Minimal. |
| Open redirect | Attacker crafts a URL that redirects to a phishing page after auth | Console UI is a SPA; no server-side redirects based on user input | Low. Verify that client-side routing does not follow untrusted redirect parameters. |
| Local storage theft | Malware or browser extension reads device_id from local storage | Device_id alone is insufficient for authentication (requires passkey ceremony); local storage values are not secrets | Low impact. Device_id is an identifier, not an authenticator. |
| WebAuthn ceremony interception | Browser extension intercepts the WebAuthn API | WebAuthn API operates at the OS/hardware level; browser extensions cannot intercept platform authenticator operations | Minimal. A compromised browser binary (not extension) could theoretically intercept, but this is APT-level. |
| Cache poisoning | Sensitive data cached and served to wrong context | `Cache-Control: no-store, no-cache, must-revalidate, private`; `Pragma: no-cache` (`broker/src/middleware/security.ts` lines 51-52) | Minimal. |

### 2.3 Local Agent (Windows Workstation)

| Threat | Description | Existing Mitigations | Residual Risk |
|---|---|---|---|
| Command injection via task payload | Attacker crafts a task description that escapes the Claude Code subprocess | Claude Code is invoked via `claude --print` as a subprocess; task content is passed as an argument, not interpolated into a shell command; the agent does not use `shell: true` in subprocess options | Low, provided the subprocess invocation never uses shell interpolation. Verify that no code path constructs a shell command string from task content. |
| Path traversal | Attacker requests files outside the project scope | `resolveAndValidatePath` rejects `..` segments before resolution; resolves symlinks with `realpathSync` and re-checks against project root (`local-agent/src/services/file-operations.ts` lines 301-348); null byte injection stripped (line 363) | Low. Defense is multi-layered: string check, resolution check, symlink resolution. |
| Protected file access | Agent reads or writes `.env`, `*.key`, `*.pem`, or credential files | Governance engine checks all paths against protected path patterns before any file operation (`local-agent/src/governance/index.ts` lines 245-258); default patterns include `.env*`, `*.key`, `*.pem`, `*.p12`, `credentials*`, `**/secrets/**` | Low. |
| Approval token forgery | Attacker forges an approval token to bypass write protection | Tokens are HMAC-SHA256 signed using `agentSecret` over canonical fields (`local-agent/src/governance/index.ts` lines 427-442); signature verified before any write; single-use enforcement via local consumed set | Low. Requires knowledge of the agent secret. |
| Agent secret extraction | Malware on the workstation reads the agent's `.env` or process environment | Agent runs as a WinSW Windows service under a dedicated service account (`serviceAccountName` in config); `.env` file permissions should restrict read access to the service account | Residual: local privilege escalation could access the service's environment. Mitigate with Windows Credential Guard and restricted service account permissions. |
| Claude Code output leakage | Claude Code subprocess outputs secrets that the agent relays to the broker | Secret redaction service scans all content before transmission; pattern-based detection for API keys, passwords, private keys, tokens, connection strings (`local-agent/src/services/secret-redaction.ts` lines 12-111); Shannon entropy detection for high-entropy strings (lines 119-138) | Low. Residual: novel secret formats not matching any pattern or entropy threshold could leak. The entropy detector (threshold 4.5, min length 32) provides a safety net. |
| Rate limit exhaustion | Automated requests exhaust the per-session rate limit, denying service to the operator | Rate limiter tracks requests per session with configurable window (`local-agent/src/governance/index.ts` lines 72-114); default 30 requests per minute | Low impact. Rate limiting is per-session, so a new session is unaffected. |

### 2.4 Network Layer

| Threat | Description | Existing Mitigations | Residual Risk |
|---|---|---|---|
| MITM on browser-to-broker | Attacker intercepts HTTPS traffic between the browser and broker | TLS 1.3 via Let's Encrypt; HSTS preload; CORS restricted to single origin | Minimal under TLS 1.3. |
| MITM on agent-to-broker | Attacker intercepts the WebSocket connection between agent and broker | Mutual TLS: both sides present certificates; broker validates agent cert fingerprint against enrolled device registry; agent validates broker's TLS certificate | Minimal. mTLS prevents MITM even if network is compromised. |
| DNS hijacking | Attacker redirects `ops.lancewfisher.com` to a malicious server | HSTS prevents downgrade; TOTP and passkey ceremonies would fail against a different origin (WebAuthn RP ID binding) | Low. WebAuthn's origin binding is the strongest defense here. Even with DNS hijacking, the passkey ceremony fails because the RP ID does not match. |
| Network surveillance | Passive observer monitors traffic patterns | All traffic is TLS-encrypted; metadata (connection timing, frequency) is visible but content is not | Low impact. Traffic analysis could reveal when the operator is active but not what they are doing. |

### 2.5 Credential Store (PostgreSQL + Redis)

| Threat | Description | Existing Mitigations | Residual Risk |
|---|---|---|---|
| Database credential theft | Attacker obtains PostgreSQL connection credentials | Credentials loaded from environment variables, never stored in code or committed to VCS; Docker network isolation (localhost-only binding) | Residual: if the VPS is compromised, environment variables are readable by root. |
| SQL injection | Attacker manipulates SQL queries via user input | All queries use parameterized statements (`$1`, `$2` pattern throughout broker code); no string concatenation in query construction | Minimal. Parameterized queries prevent SQL injection. |
| Audit log direct manipulation | Attacker with database access modifies or deletes audit entries | Application roles (`broker_audit`, `agent_audit`) have INSERT + SELECT only on `audit_log`; no UPDATE or DELETE grants; `trg_audit_no_update` trigger blocks UPDATE except during hash computation within transactions (`broker/src/audit/index.ts` lines 87-90) | Residual: PostgreSQL superuser can bypass all restrictions. Mitigate by not using superuser credentials for application connections and restricting superuser access. |
| Redis data tampering | Attacker modifies session data, rate limit counters, or TOTP state in Redis | Docker network isolation; Redis bound to localhost; Redis password (should be set) | Residual: if Redis is accessed, session tokens could be injected or rate limits cleared. Ensure `requirepass` is configured in Redis. |
| TOTP secret exfiltration | Attacker extracts encrypted TOTP secrets from the database | Secrets encrypted with AES-256-GCM; encryption key derived from `TOTP_ENCRYPTION_KEY` environment variable via HKDF; key never stored in database (`broker/src/auth/totp.ts` lines 15-62) | Residual: if both the database dump and the `TOTP_ENCRYPTION_KEY` are obtained, secrets can be decrypted. These should never be co-located in backups. |
| Recovery code extraction | Attacker obtains bcrypt hashes of recovery codes from database | Codes stored as bcrypt hashes with cost factor 12; 32-character alphanumeric codes (~190 bits entropy) make rainbow tables infeasible | Minimal. Bcrypt at cost 12 with 190-bit entropy is computationally infeasible to brute force. |

---

## 3. Scenario Analysis

### 3.1 mTLS Certificate Compromise

**Scenario**: The agent's mTLS client certificate private key is extracted from the Windows certificate store by malware or a local privilege escalation attack.

**Impact**:
- Attacker can establish a WebSocket connection to the broker impersonating the agent.
- Attacker can receive task commands and send fabricated results.
- Attacker cannot independently initiate write operations (requires approval tokens from the iPhone).
- Attacker cannot access the Console UI (requires passkey authentication, not mTLS).

**Existing mitigations**:
- Broker validates cert fingerprint against enrolled device registry (`broker/src/agent-relay/index.ts` lines 33-37).
- Certificates expire after 90 days, limiting the window of exposure.
- Broker maintains a revocation list; revoked certs are rejected immediately.
- Agent connection events are logged to the audit trail.

**Detection**:
- Two simultaneous connections from the same agent_id would indicate compromise (the real agent and the attacker). The broker should alert on this condition.
- Anomalous agent behavior (unexpected command results, connection from unusual IPs).

**Response**:
1. Revoke the compromised client certificate immediately via the Console UI.
2. Revoke the Windows device in the enrolled device registry.
3. Rotate the agent secret.
4. Re-enroll the Windows device with a new certificate.
5. Review audit logs for any commands executed during the compromise window.

**Residual risk**: Between compromise and detection, the attacker can intercept commands and fabricate results. The approval token system prevents the attacker from independently initiating write operations, limiting damage to data integrity of task results.

### 3.2 WebAuthn Passkey Theft / Cloning

**Scenario**: An attacker obtains use of a passkey through device theft, iCloud Keychain sync to an unauthorized device, or a cloned authenticator.

**Impact**:
- Windows TPM-backed passkey: Cannot be extracted or synced. Device theft is the only path, and Windows Hello biometric/PIN is required.
- iPhone Secure Enclave passkey: Synced via iCloud Keychain to other Apple devices on the same Apple ID.

**Existing mitigations**:
- Device trust layer: Even with a valid passkey, the broker validates `device_id` against the enrolled device registry. An unauthorized device's ID will not match (`docs/architecture/PASSKEY_MODEL.md`).
- Device fingerprint challenge: Authentication includes User-Agent validation and client-side `device_id` not synced by iCloud.
- Signature counter validation: Counter anomalies (indicating cloning) trigger device suspension (`broker/src/auth/webauthn.ts` line 245-248; architecture doc: counter > stored counter check).
- Alert on unknown device: Valid passkey from unrecognized device context is rejected and logged as `PASSKEY_USED_FROM_UNKNOWN_DEVICE`.
- Step-up auth (TOTP) provides an independent factor not tied to the passkey ecosystem.

**Detection**:
- `AUTH_PASSKEY_FAILURE` audit events from unexpected origins.
- Signature counter anomaly triggers `DEVICE_SUSPENDED` and operator notification.
- Unknown device passkey use logged with IP and User-Agent.

**Response**:
1. Suspend the affected device immediately.
2. If iCloud sync is the vector: remove the passkey from iCloud Keychain, change Apple ID password, enable Apple Advanced Data Protection.
3. If physical theft: revoke the device, re-enroll a replacement.
4. Review audit logs for any successful authentications during the exposure window.

**Residual risk**: An attacker who compromises the Apple ID, obtains the synced passkey, AND spoofs the device fingerprint challenge could authenticate. This requires a multi-factor attack chain. TOTP step-up on write operations provides an independent barrier.

### 3.3 TOTP Brute Force

**Scenario**: Attacker attempts to guess the 6-digit TOTP code through repeated attempts.

**Impact**: If successful, attacker could complete step-up authentication for write operations (assuming they also have a valid session, which requires a passkey).

**Existing mitigations** (all in `broker/src/auth/totp.ts`):
- Per-window rate limit: 3 attempts per 90 seconds (lines 9-10).
- Lockout: 5 failures within 5 minutes triggers 15-minute lockout (lines 11-13).
- Redis-backed tracking per operator ID (lines 73-97).
- TOTP codes rotate every 30 seconds (1,000,000 possible values per period).
- Replay prevention: Each code can only be used once per period via Redis key with 90-second TTL (lines 147-154).
- Window tolerance is 1 step only (t-1, t, t+1), limiting the valid code space to 3 codes per moment.

**Analysis**:
- At 3 attempts per 90 seconds with lockouts: approximately 104 days to reach 500,000 attempts (50% probability of guessing).
- Combined with 30-second code rotation, each attempt has at most a 3/1,000,000 chance of success.
- Effective brute force rate: ~2 attempts per minute after accounting for lockouts.
- Expected time to success: computationally infeasible within any practical timeframe.

**Residual risk**: Minimal. TOTP brute force is not viable against these rate limits. The greater risk is TOTP code interception (shoulder surfing, clipboard monitoring, phishing).

### 3.4 Approval Token Replay / Forgery

**Scenario**: Attacker captures an approval token and attempts to replay it, or forges a token to authorize an unauthorized write operation.

**Impact**: If successful, a write operation could be executed without legitimate operator approval.

**Existing mitigations**:
- **Single-use enforcement**: Broker atomically transitions token status from `approved` to `used` via `UPDATE ... WHERE status = 'approved' RETURNING id` (`broker/src/approval/index.ts` lines 106-118). If the RETURNING yields no rows, the token was already consumed.
- **Agent-side single-use tracking**: Local `ApprovalTokenStore` tracks consumed token IDs with a 24-hour retention (`local-agent/src/governance/index.ts` lines 118-144).
- **TTL enforcement**: Write tokens expire in 5 minutes, execute tokens in 2 minutes (`docs/architecture/APPROVAL_TOKEN_SPEC.md`).
- **Scope binding**: Each token is bound to a specific `(action_type, resource_path, operation, payload_hash)`. A token for `file.write` on `/src/main.ts` cannot be used for any other path or operation.
- **Device binding**: Token must be approved by a different device than the one that requested it (`broker/src/approval/index.ts` lines 125-138).
- **Nonce uniqueness**: Each token has a cryptographically random 32-byte nonce (`broker/src/approval/index.ts` line 8).
- **Payload hash binding**: SHA-256 of the action payload is embedded in the token. If the payload changes after approval, the hash mismatch invalidates the token.
- **HMAC signature**: Agent-side token validation uses HMAC-SHA256 over canonical fields (`local-agent/src/governance/index.ts` lines 427-442).

**Detection**:
- All token lifecycle events logged to audit trail (creation, approval, use, expiry, revocation).
- Validation failures are logged with reason (`broker/src/approval/index.ts` lines 93-99).

**Residual risk**: Minimal. The combination of single-use atomic enforcement, short TTL, scope binding, device binding, and cryptographic signature makes replay and forgery infeasible without compromising the agent secret.

### 3.5 Audit Log Tampering

**Scenario**: Attacker who has gained database access attempts to modify or delete audit log entries to cover their tracks.

**Impact**: Loss of forensic evidence, inability to detect the scope of a compromise.

**Existing mitigations**:
- **Hash chain**: Each entry's `prev_hash` is derived from the previous entry, creating a chain where modifying any entry invalidates all subsequent entries (`broker/src/audit/index.ts` lines 21-38).
- **Entry self-hash**: Each entry has an `entry_hash` computed from its own fields plus `prev_hash` (lines 30-38). Modification of any field is detectable.
- **Database role restrictions**: Application roles have INSERT + SELECT only on `audit_log`. No UPDATE or DELETE grants. A `trg_audit_no_update` trigger blocks UPDATE operations except during the initial hash computation within the same transaction (lines 87-90).
- **Advisory lock serialization**: `pg_advisory_xact_lock(1)` ensures chain ordering under concurrent inserts (line 47, `FOR UPDATE` clause).
- **Hourly verification job**: Walks the entire chain and alerts on any discontinuity (`broker/src/audit/index.ts` lines 118-162).
- **Encrypted daily backups**: Exported with `gpg --symmetric --cipher-algo AES256`; backup integrity verified by loading into a separate database and re-running chain verification.

**Detection**:
- Hourly chain verification detects any modification within one hour.
- `INTEGRITY_CHECK_FAILED` events trigger operator alerts.

**Residual risk**: The PostgreSQL superuser can bypass trigger and role restrictions. If an attacker gains superuser access, they could theoretically modify entries and recompute the chain. Mitigation: restrict superuser access, use a separate backup verification instance, and consider exporting chain hashes to an independent append-only store (e.g., a separate server or cloud storage) for cross-verification.

### 3.6 Agent Command Injection

**Scenario**: A maliciously crafted task description or file path contains shell metacharacters or escape sequences that are interpreted by the agent's subprocess invocation.

**Impact**: Arbitrary command execution on the operator's workstation with the agent's service account permissions.

**Existing mitigations**:
- Claude Code is invoked as `claude --print` via Node.js `child_process.spawn` (not `exec`), passing arguments as array elements rather than shell-interpolated strings.
- Task descriptions are passed as arguments, not piped through a shell.
- Path validation strips null bytes and rejects `..` traversal before any filesystem operation (`local-agent/src/services/file-operations.ts` lines 306, 363).
- Governance engine validates command types against an allowlist (`local-agent/src/governance/index.ts` lines 176-179).

**Residual risk**: If any code path constructs a shell command string from user-controlled input (task content, file paths, project names) and passes it to `exec` or `execSync`, command injection is possible. Audit all subprocess invocations to confirm `spawn` (not `exec`) is used throughout. Verify that `shell: true` is never set in spawn options.

### 3.7 Cross-Site Attacks on Console UI

**Scenario**: Attacker exploits XSS, CSRF, or other web vulnerabilities in the Console UI to execute actions on behalf of the authenticated operator.

**XSS mitigations**:
- CSP: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` (`broker/src/middleware/security.ts` lines 14-26).
- No inline scripts or eval permitted.
- `X-Content-Type-Options: nosniff` prevents MIME confusion.

**CSRF mitigations**:
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Strict`.
- Anti-replay nonce on mutating requests.
- CORS origin restricted to `https://ops.lancewfisher.com`.
- Write operations require approval tokens from a separate device.

**Clickjacking mitigations**:
- `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'`.

**Residual risk**: If a CSP bypass is discovered (e.g., via a vulnerable first-party JavaScript dependency), XSS could lead to session theft. However, the multi-layered defense (CSP + SameSite cookies + approval tokens on a separate device) means XSS alone cannot authorize write operations. The attacker would still need iPhone approval.

---

## 4. Cross-Cutting Concerns

### 4.1 Supply Chain

- **npm dependencies**: Both broker and agent depend on npm packages (`@simplewebauthn/server`, `otplib`, `fastify`, `ws`, `zod`, `ioredis`, `pg`, `diff`). A compromised dependency could execute arbitrary code.
- **Mitigation**: Use `npm audit` regularly. Pin dependency versions in `package-lock.json`. Consider using a lockfile integrity check in CI.
- **Residual risk**: Zero-day supply chain attacks are difficult to defend against. The single-operator nature of this system limits the blast radius.

### 4.2 Backup Security

- **Audit log backups**: Encrypted with AES-256 via GPG symmetric encryption. The passphrase is stored in `/root/.audit-backup-key` on the VPS.
- **Risk**: If the VPS is compromised, the backup encryption key is co-located with the data.
- **Mitigation**: Store backup encryption keys separately from the VPS. Use an offline key or a key management service.

### 4.3 Temporal Attacks

- **Timing side channels**: Request signature verification uses `timingSafeEqual` (`broker/src/middleware/security.ts` line 84), preventing timing-based secret extraction.
- **TOTP timing**: The 1-step window tolerance is appropriate. Wider windows increase attack surface.

### 4.4 Denial of Service

- **Broker**: NGINX rate limiting (10 req/s per IP) and application-level rate limiting (60 ops/min per session) provide layered DoS protection.
- **Agent**: Rate limiter at 30 requests per minute per session (`local-agent/src/governance/index.ts`).
- **Recovery endpoint**: 3 attempts per 15 minutes per IP; 5 failures trigger 1-hour lockout; escalation to 24-hour lockout after 3 lockouts in 24 hours.
- **Residual risk**: A determined attacker with many IPs could exhaust broker resources. Acceptable for a single-operator system. Consider Cloudflare if this becomes a concern.

---

## 5. Risk Summary Matrix

| Attack Surface | Threat | Likelihood | Impact | Risk Level | Primary Mitigation |
|---|---|---|---|---|---|
| Broker API | Authentication bypass | Low | Critical | Medium | Passkey + session + device binding |
| Broker API | Session hijacking | Low | High | Medium | HttpOnly/Secure/SameSite cookies |
| Broker WebSocket | Rogue agent connection | Low | Critical | Medium | mTLS + cert fingerprint validation |
| Console UI | XSS | Low | High | Low-Medium | Strict CSP, no inline scripts |
| Console UI | CSRF | Very Low | High | Low | SameSite=Strict + nonce + CORS |
| Local Agent | Command injection | Low | Critical | Medium | spawn (not exec), no shell interpolation |
| Local Agent | Path traversal | Low | High | Low | Multi-layer path validation + symlink resolution |
| Local Agent | Secret leakage | Low-Medium | High | Medium | Pattern + entropy redaction |
| Credentials | mTLS cert theft | Low | High | Medium | 90-day expiry, revocation list |
| Credentials | Passkey cloning | Very Low | Critical | Low | TPM binding, counter checks, device trust |
| Credentials | TOTP brute force | Very Low | Medium | Very Low | 3/90s rate limit + lockout |
| Credentials | Recovery code theft | Very Low | Critical | Low | Physical security dependency, bcrypt |
| Audit Log | Tampering | Very Low | High | Low | Hash chain + hourly verification |
| Network | MITM | Very Low | Critical | Very Low | TLS 1.3 + mTLS + WebAuthn origin binding |

---

## 6. Recommended Enhancements

These are not currently implemented but would further reduce residual risk:

1. **Dual-connection detection**: Alert immediately when a second agent connection attempt occurs while one is already active.
2. **Certificate Transparency monitoring**: Subscribe to CT logs for `ops.lancewfisher.com` to detect unauthorized certificate issuance.
3. **CAA DNS records**: Restrict TLS certificate issuance to Let's Encrypt only.
4. **External audit log witness**: Export chain hashes to an independent append-only store for cross-verification.
5. **Mandatory anti-replay nonce**: Make the `x-request-nonce` header required (not optional) for all mutating endpoints.
6. **Redis authentication**: Ensure `requirepass` is configured; current code does not show explicit Redis password configuration.
7. **Agent subprocess audit**: Add static analysis or runtime checks to verify no `exec`/`execSync` calls with `shell: true` exist in the agent codebase.
8. **Backup key separation**: Move the audit backup encryption key off the VPS to a separate secure location.
