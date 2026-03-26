# Sovereign Operator Console -- Credential Rotation Procedures

> **Governance note**: This document defers to root governance (CLAUDE.md Sections 0.6, 6, 13)
> for overarching security rules. Security rules defined here may only tighten root
> protections, never loosen them. Credentials must never be committed to version control
> (Section 13, Rule 2), and no credential may be output in logs or responses (Section 13,
> Rule 12, and Section 0.6).

## Document Purpose

This document provides step-by-step procedures for rotating every credential in the Sovereign
Operator Console. Each procedure includes when to rotate, how to rotate with zero downtime
(where possible), and verification steps. Follow these procedures during scheduled rotation,
after suspected compromise, or when onboarding replacement infrastructure.

---

## 1. mTLS Certificates

### 1.1 Internal CA Certificate

**When to rotate**: When the CA certificate approaches expiry (typically 5-10 years), or immediately if the CA private key is suspected compromised.

**Impact**: Rotating the CA invalidates all existing agent client certificates signed by it.

**Procedure**:

1. **Generate new CA key and certificate** on the VPS:
   ```bash
   # Generate new CA private key (keep this offline if possible)
   openssl genrsa -aes256 -out ca-new.key 4096

   # Generate new CA certificate (10-year validity)
   openssl req -new -x509 -days 3650 -key ca-new.key \
     -out ca-new.pem -subj "/CN=Sovereign Console CA v2"
   ```

2. **Transition period** (run both CAs temporarily):
   - Configure NGINX to accept client certificates from both the old and new CA:
     ```nginx
     ssl_client_certificate /etc/nginx/certs/ca-combined.pem;
     ```
   - Create the combined file: `cat ca-old.pem ca-new.pem > ca-combined.pem`
   - Restart NGINX.

3. **Issue a new agent client certificate** signed by the new CA:
   - Follow the "Agent Client Certificate" rotation procedure (Section 1.3).

4. **Verify the new certificate works**:
   - Confirm the agent reconnects successfully with the new client cert.
   - Check broker logs for successful mTLS validation.

5. **Remove the old CA**:
   - Update NGINX to trust only the new CA: `ssl_client_certificate /etc/nginx/certs/ca-new.pem;`
   - Restart NGINX.
   - Move the old CA key and cert to a dated archive directory.

6. **Update broker configuration**:
   - Update `AGENT_MTLS_CA_CERT` in the broker's `.env` to point to the new CA cert.
   - Restart the broker container.

7. **Audit log entry**: `CERT_ROTATED` with detail `{"scope": "ca", "reason": "scheduled|compromise"}`.

**Zero-downtime**: Yes, via the combined CA transition period. The agent continues operating with its old cert during the transition, then is re-enrolled with a new cert signed by the new CA.

### 1.2 Broker Server Certificate (Let's Encrypt)

**When to rotate**: Automatically every 90 days via Let's Encrypt auto-renewal. Manual rotation only needed if the private key is compromised or the domain changes.

**Automatic renewal verification**:

1. Check certbot timer:
   ```bash
   systemctl status certbot.timer
   ```

2. Test renewal:
   ```bash
   certbot renew --dry-run
   ```

3. Verify current certificate expiry:
   ```bash
   echo | openssl s_client -connect ops.lancewfisher.com:443 -servername ops.lancewfisher.com 2>/dev/null | openssl x509 -noout -dates
   ```

4. Set up monitoring to alert when the certificate is within 14 days of expiry.

**Emergency manual renewal** (if auto-renewal fails):

```bash
certbot certonly --nginx -d ops.lancewfisher.com --force-renewal
systemctl reload nginx
```

**If the server private key is compromised**:

1. Revoke the current certificate:
   ```bash
   certbot revoke --cert-name ops.lancewfisher.com --reason keycompromise
   ```
2. Delete the old key and certificate:
   ```bash
   certbot delete --cert-name ops.lancewfisher.com
   ```
3. Obtain a new certificate (generates a new private key):
   ```bash
   certbot certonly --nginx -d ops.lancewfisher.com
   systemctl reload nginx
   ```

### 1.3 Agent Client Certificate

**When to rotate**: Every 90 days (automatic renewal initiated by agent 14 days before expiry), or immediately on suspected compromise.

**Scheduled renewal** (automatic flow, documented in `docs/architecture/DEVICE_TRUST_MODEL.md`):

1. Agent detects certificate is within 14 days of expiry.
2. Agent generates a new CSR with the same `device_id` as Common Name.
3. Agent sends the CSR to the broker over the still-valid existing mTLS connection.
4. Broker validates the request (agent must be authenticated with the current cert).
5. Broker signs the new CSR with the internal CA.
6. Broker returns the new signed certificate.
7. Agent installs the new certificate in the Windows certificate store.
8. Agent confirms installation to the broker.
9. Broker updates the cert fingerprint in the `enrolled_devices` table.
10. Old certificate is added to the revocation list.

**Manual rotation** (if the automatic process fails or key is compromised):

1. **On the agent workstation**, generate a new key pair and CSR:
   ```bash
   openssl ecparam -genkey -name prime256v1 -out agent-new.key
   openssl req -new -key agent-new.key -out agent-new.csr \
     -subj "/CN=<device_id>"
   ```

2. **On the VPS**, sign the CSR with the internal CA:
   ```bash
   openssl x509 -req -in agent-new.csr -CA ca.pem -CAkey ca.key \
     -CAcreateserial -out agent-new.pem -days 90 \
     -extfile <(echo "extendedKeyUsage=clientAuth")
   ```

3. **Compute the new certificate fingerprint**:
   ```bash
   openssl x509 -in agent-new.pem -noout -fingerprint -sha256
   ```

4. **Update the enrolled device registry** (via authenticated Console UI or direct database update):
   ```sql
   UPDATE enrolled_devices
   SET client_cert_fingerprint = '<new-sha256-fingerprint>',
       client_cert_expires_at = '<new-expiry>',
       client_cert_serial = '<new-serial>'
   WHERE device_id = '<device_id>';
   ```

5. **Install the new certificate on the agent**:
   - Copy `agent-new.pem` and `agent-new.key` to the agent's `certs/` directory.
   - Update the agent's `.env`: `MTLS_CERT=certs/agent-new.pem` and `MTLS_KEY=certs/agent-new.key`.
   - Restart the agent service.

6. **Verify the new certificate works**:
   - Check broker logs for successful agent connection with the new cert fingerprint.
   - Verify in Console UI that the agent shows as connected.

7. **Revoke the old certificate**: Add the old cert's serial to the broker's revocation list.

8. **Securely delete the old key material**: Remove old `.key` and `.pem` files from the agent.

**Zero-downtime**: The automatic renewal process achieves zero downtime because the agent authenticates with the old cert to request a new one. Manual rotation requires a brief agent restart.

---

## 2. TOTP Secrets

### 2.1 Reprovisioning with Other Device Available

**When**: Operator loses access to the authenticator app on one device, or as part of scheduled rotation.

**Procedure** (documented in `docs/architecture/TOTP_MODEL.md`):

1. Authenticate on the remaining enrolled device (passkey).
2. Navigate to: Settings > Security > Reprovision TOTP.
3. Confirm identity with passkey + current TOTP code from the remaining device's authenticator.
4. Broker generates a new 20-byte cryptographically random TOTP secret.
5. Broker encrypts the new secret with AES-256-GCM using the current `TOTP_ENCRYPTION_KEY`.
6. Broker revokes the old encrypted secret (`UPDATE totp_secrets SET revoked_at = NOW()`).
7. Broker stores the new encrypted secret.
8. QR code displayed in the UI (rendered client-side, never cached server-side).
9. Operator scans QR code with authenticator app.
10. Operator enters a current TOTP code from the new secret to confirm.
11. If confirmed: provisioning complete.
12. If not confirmed within 3 attempts: provisioning cancelled, old secret remains.
13. QR code is not retrievable after this screen is closed.

**Audit log entry**: `TOTP_REPROVISIONED`.

### 2.2 Reprovisioning via Break-Glass (Both Devices Unavailable)

**When**: Operator has lost access to both enrolled devices and their authenticator app.

**Procedure**: Follow the break-glass recovery flow (`docs/architecture/BREAK_GLASS_RECOVERY.md`). TOTP is reprovisioned as part of device re-enrollment (Step 4 of the recovery flow).

---

## 3. WebAuthn Passkeys

### 3.1 Re-Enrollment (Single Device Replacement)

**When**: Device is lost, stolen, hardware failure, or TPM is cleared.

**Procedure**:

1. Authenticate on the remaining enrolled device (passkey).
2. Navigate to: Settings > Devices > [affected device] > Revoke.
3. Confirm revocation with passkey + TOTP.
4. The old device's status is set to `revoked`. Its client certificate (if any) is added to the revocation list. Its passkey credential is revoked (`UPDATE passkey_credentials SET revoked_at = NOW()`). All sessions for the device are revoked.
5. Generate a new enrollment invite: Settings > Devices > Enroll New Device.
6. Open the invite URL on the replacement device.
7. Complete the enrollment flow:
   - WebAuthn passkey registration (with TPM/Secure Enclave attestation).
   - TOTP provisioning (scan QR code, confirm code).
   - For Windows device: mTLS client certificate issuance.
8. The old device cannot authenticate or connect after step 4.

**Audit log entries**: `DEVICE_REVOKED`, `DEVICE_ENROLLED`.

### 3.2 Re-Enrollment (Both Devices Lost)

Follow the break-glass recovery procedure (`docs/architecture/BREAK_GLASS_RECOVERY.md`). Recovery allows enrollment of one new device; the second device is enrolled from the first after recovery.

---

## 4. Database Credentials (PostgreSQL)

### 4.1 Application Role Passwords

**When**: Annually, or immediately on suspected compromise.

**Credentials to rotate**: `broker_app`, `broker_audit`, `agent_audit`, `audit_verifier` database role passwords.

**Procedure** (per role, zero-downtime):

1. **Generate a new password** (64+ character random string):
   ```bash
   openssl rand -base64 48
   ```

2. **Update the PostgreSQL role**:
   ```sql
   ALTER ROLE broker_app WITH PASSWORD 'new-password-here';
   ```

3. **Update the connection string** in the broker's `.env`:
   ```
   DATABASE_URL=postgresql://broker_app:new-password-here@localhost:5432/sovereign_console
   ```

4. **Restart the broker container**:
   ```bash
   docker compose restart broker
   ```

5. **Verify connectivity**:
   - Check broker logs for successful database connection.
   - Perform a health check: `curl -sf https://ops.lancewfisher.com/api/health`.

6. Repeat for each role that needs rotation.

**Zero-downtime**: Brief interruption during broker container restart (~2-5 seconds). The agent buffers results locally and retransmits on reconnect if the broker is briefly unavailable.

### 4.2 PostgreSQL Superuser Password

**When**: On suspected VPS compromise, or when the default password has not been changed.

**Procedure**:

1. SSH into the VPS.
2. Access PostgreSQL:
   ```bash
   docker exec -it postgres psql -U postgres
   ```
3. Change the password:
   ```sql
   ALTER ROLE postgres WITH PASSWORD 'new-strong-password';
   ```
4. Update any scripts or backup tools that use the superuser password.
5. Store the new password securely (not in any `.env` file used by the application).

---

## 5. Redis Password

**When**: Annually, or immediately on suspected compromise.

**Procedure**:

1. **Generate a new password**:
   ```bash
   openssl rand -base64 48
   ```

2. **Update Redis configuration** (`redis.conf` or Docker environment):
   ```
   requirepass new-redis-password-here
   ```

3. **Update the broker's `.env`**:
   ```
   REDIS_URL=redis://:new-redis-password-here@localhost:6379
   ```

4. **Restart Redis and the broker**:
   ```bash
   docker compose restart redis broker
   ```

5. **Verify**:
   - Check broker logs for successful Redis connection.
   - Verify sessions are being created (authenticate and check Redis).

**Impact**: All existing sessions in Redis are preserved if Redis itself is not restarted. If Redis is restarted, all sessions and rate limit state are cleared. Users will need to re-authenticate.

---

## 6. Application Secrets

### 6.1 JWT_SECRET

**When**: Annually, or immediately on suspected compromise.

**Impact**: Rotating invalidates all existing JWTs. Users must re-authenticate.

**Procedure**:

1. Generate a new secret (64+ characters):
   ```bash
   openssl rand -base64 48
   ```

2. Update broker `.env`:
   ```
   JWT_SECRET=new-secret-here
   ```

3. Restart the broker:
   ```bash
   docker compose restart broker
   ```

4. All existing sessions using JWT-based tokens will be invalidated.
5. Operator must re-authenticate on both devices.

**Zero-downtime**: Not possible. All sessions are invalidated. Schedule during a maintenance window.

### 6.2 SESSION_SECRET

**When**: Annually, or immediately on suspected compromise.

**Impact**: Rotating invalidates request signature verification for in-flight requests. Existing sessions remain valid (session tokens are independent of this secret).

**Procedure**:

1. Generate a new secret (32+ characters):
   ```bash
   openssl rand -base64 32
   ```

2. Update broker `.env`:
   ```
   SESSION_SECRET=new-secret-here
   ```

3. Restart the broker:
   ```bash
   docker compose restart broker
   ```

4. Any in-flight requests with signatures computed using the old secret will fail validation. This is a brief window (~seconds).

**Zero-downtime**: Effectively yes. The only impact is on in-flight signed requests during the restart window.

### 6.3 TOTP_ENCRYPTION_KEY

**When**: Annually, or immediately if the key is suspected compromised.

**Impact**: Critical. All TOTP secrets in the database are encrypted with this key. Rotation requires re-encrypting every stored TOTP secret.

**Procedure**:

1. Generate a new 32-byte (64 hex character) key:
   ```bash
   openssl rand -hex 32
   ```

2. **Before updating the `.env`**, run a migration to re-encrypt all TOTP secrets:
   ```typescript
   // Pseudocode for the migration
   import { decryptSecret, encryptSecret } from '../broker/src/auth/totp.js';

   // Load old key from current env
   const oldKey = process.env.TOTP_ENCRYPTION_KEY;
   // Set new key
   const newKey = '<new-key-hex>';

   // For each active TOTP secret:
   const secrets = await query('SELECT id, encrypted_secret FROM totp_secrets WHERE revoked_at IS NULL');
   for (const row of secrets.rows) {
     // Decrypt with old key
     process.env.TOTP_ENCRYPTION_KEY = oldKey;
     const plaintext = decryptSecret(row.encrypted_secret);

     // Re-encrypt with new key
     process.env.TOTP_ENCRYPTION_KEY = newKey;
     const newEncrypted = encryptSecret(plaintext);

     // Update in database
     await query('UPDATE totp_secrets SET encrypted_secret = $1 WHERE id = $2', [newEncrypted, row.id]);
   }
   ```

3. Update broker `.env`:
   ```
   TOTP_ENCRYPTION_KEY=<new-key-hex>
   ```

4. Restart the broker:
   ```bash
   docker compose restart broker
   ```

5. **Verify** by performing a TOTP validation (log in with step-up auth and confirm the code works).

6. **Securely delete** any temporary files or scripts that contained the old key.

**Zero-downtime**: The re-encryption migration can run while the broker is using the old key. Update the `.env` and restart only after migration completes. Brief restart window (~2-5 seconds).

### 6.4 AGENT_SECRET

**When**: Annually, or immediately on suspected compromise.

**Impact**: Rotating invalidates approval token signature verification. Any pending (not yet consumed) approval tokens will fail validation on the agent side.

**Procedure**:

1. Generate a new secret (16+ characters):
   ```bash
   openssl rand -base64 24
   ```

2. Wait for all pending approval tokens to be consumed or expired (check via Console UI or database).

3. Update agent `.env`:
   ```
   AGENT_SECRET=new-secret-here
   ```

4. Update the broker's copy of the agent secret (if the broker also uses it for token signing).

5. Restart the agent service:
   ```bash
   # Via WinSW
   sovereign-agent.exe restart
   ```

6. **Verify**: Submit a test task with a write operation and confirm the approval token validates correctly.

---

## 7. Recovery Codes

### 7.1 Scheduled Rotation

**When**: Recovery codes rotate automatically when any single code is used. Manual rotation is recommended annually or if the physical storage location is compromised.

**Manual rotation procedure**:

1. Authenticate on either enrolled device (passkey).
2. Navigate to: Settings > Security > Recovery Codes > Rotate.
3. Confirm with passkey + TOTP.
4. Broker invalidates all existing codes (`status = 'rotated'`).
5. Broker generates 10 new codes (192 bits entropy each, bcrypt-hashed for storage).
6. New codes displayed once on screen.
7. Operator saves codes to physical secure location (printed paper, safe or safety deposit box).
8. Confirm in the UI that codes have been saved.
9. Codes are not retrievable after this screen is closed.

**Audit log entry**: `RECOVERY_CODES_ROTATED`.

### 7.2 After Break-Glass Use

When any recovery code is used during break-glass recovery, ALL remaining codes are automatically invalidated and a new set of 10 is generated. This is built into the recovery flow (Step 5 of `docs/architecture/BREAK_GLASS_RECOVERY.md`).

---

## 8. Let's Encrypt Certificate Auto-Renewal Verification

**Frequency**: Monthly manual verification.

**Checklist**:

1. Check certbot timer is active:
   ```bash
   systemctl status certbot.timer
   # Expected: active (waiting)
   ```

2. Check last renewal attempt:
   ```bash
   cat /var/log/letsencrypt/letsencrypt.log | tail -20
   ```

3. Check current certificate expiry:
   ```bash
   echo | openssl s_client -connect ops.lancewfisher.com:443 \
     -servername ops.lancewfisher.com 2>/dev/null | \
     openssl x509 -noout -enddate
   # Should be at least 60 days in the future after a successful renewal
   ```

4. Test renewal:
   ```bash
   certbot renew --dry-run
   # Expected: "Congratulations, all simulated renewals succeeded"
   ```

5. Verify NGINX reloads after renewal (check the deploy hook):
   ```bash
   cat /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
   # Should contain: systemctl reload nginx
   ```

6. Verify the renewal hook is executable:
   ```bash
   ls -la /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
   # Should show -rwx------
   ```

---

## 9. Emergency Rotation (Suspected Compromise)

When a security breach is suspected, follow this procedure to rotate all credentials in priority order.

### Severity Assessment

| Indicator | Severity | Scope |
|---|---|---|
| Audit chain integrity failure | Critical | Assume full database compromise |
| Unknown agent connection | High | Assume agent cert and agent secret compromised |
| Unknown device passkey event | High | Assume passkey and possibly session compromised |
| VPS root access compromised | Critical | Assume all VPS-resident secrets compromised |
| Single device stolen (not both) | Medium | Rotate credentials associated with that device |
| Recovery codes exposed digitally | High | Rotate recovery codes immediately |

### Critical Severity Procedure (Full Rotation)

**Execute in this order**:

1. **Immediate containment** (first 5 minutes):
   - Revoke all active sessions: In the broker database or via Console UI if still accessible.
   - Suspend both enrolled devices (prevents new authentication).
   - If VPS is compromised: change SSH keys and VPS root password from the hosting provider's control panel.

2. **Agent isolation** (next 5 minutes):
   - Stop the agent service on the workstation.
   - Revoke the agent's mTLS client certificate in the broker's revocation list.

3. **Rotate VPS-resident secrets** (next 30 minutes):
   - `JWT_SECRET` -- generates new, invalidates all JWTs.
   - `SESSION_SECRET` -- generates new.
   - `TOTP_ENCRYPTION_KEY` -- generates new, re-encrypts TOTP secrets (run migration script).
   - `DATABASE_URL` -- change all PostgreSQL role passwords.
   - `REDIS_URL` -- change Redis password.
   - `AGENT_MTLS_CA_CERT` / `AGENT_MTLS_CERT` / `AGENT_MTLS_KEY` -- regenerate CA and broker cert if CA key was on the VPS.

4. **Restart all services** with new credentials:
   ```bash
   docker compose down
   docker compose up -d
   ```

5. **Rotate agent-side secrets**:
   - Generate new `AGENT_SECRET`.
   - Generate new agent mTLS client certificate (signed by new CA if CA was rotated).
   - Update agent `.env` with all new values.
   - Restart agent service.

6. **Device re-enrollment**:
   - Reactivate one enrolled device (the one known to be secure).
   - Re-enroll via Console UI.
   - Enroll the second device.

7. **Recovery code rotation**:
   - Generate new recovery codes via Console UI.
   - Save to physical secure location.

8. **Audit and verify**:
   - Verify audit log chain integrity from the most recent known-good backup.
   - Review all audit log entries during the suspected compromise window.
   - Verify all services are operational with new credentials.
   - Test a full task execution flow (read + write with approval).

9. **Post-incident**:
   - Document the incident, timeline, and actions taken.
   - Identify how the compromise occurred and address the root cause.
   - Update threat model if new attack vectors were discovered.

### Medium Severity Procedure (Single Device Compromise)

1. Revoke the compromised device: Settings > Devices > [device] > Revoke (from the other device).
2. Revoke the device's mTLS client certificate (if Windows workstation).
3. Rotate the `AGENT_SECRET` if the compromised device is the Windows workstation.
4. Enroll a replacement device.
5. Reprovision TOTP for the replacement device.
6. Review audit logs for any unauthorized actions from the compromised device.

---

## 10. Rotation Schedule Summary

| Credential | Scheduled Rotation | Trigger Rotation |
|---|---|---|
| mTLS CA certificate | 5-10 years | CA key compromise |
| Let's Encrypt broker cert | 90 days (automatic) | Key compromise |
| mTLS agent client cert | 90 days (automatic) | Key compromise, device replacement |
| TOTP secrets | As needed (reprovision) | Authenticator app loss, device replacement |
| WebAuthn passkeys | Non-extractable (no rotation) | Device replacement triggers re-enrollment |
| PostgreSQL passwords | Annually | Suspected database breach |
| Redis password | Annually | Suspected VPS breach |
| JWT_SECRET | Annually | Suspected VPS breach |
| SESSION_SECRET | Annually | Suspected VPS breach |
| TOTP_ENCRYPTION_KEY | Annually | Suspected VPS breach |
| AGENT_SECRET | Annually | Suspected agent compromise |
| Recovery codes | On any use (automatic) | Physical storage compromise |
