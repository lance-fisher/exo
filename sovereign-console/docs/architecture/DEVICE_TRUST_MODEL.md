# Device Trust Model

## Overview

The Sovereign Operator Console operates on a **two-device trust model**. Exactly two physical devices are enrolled and trusted by the system. No other devices can authenticate, approve actions, or connect as agents.

| Device | Role | Auth Mechanism | Trust Anchor |
|---|---|---|---|
| Windows Laptop | Operator workstation, local agent host, Console UI access | WebAuthn passkey (TPM), client certificate (mTLS) | TPM 2.0 |
| iPhone | Approval authority, step-up auth, mobile Console UI access | WebAuthn passkey (Secure Enclave), device attestation | Secure Enclave |

## Enrolled Device Registry

### Schema

```sql
CREATE TABLE enrolled_devices (
  device_id         TEXT PRIMARY KEY,         -- UUIDv4, assigned at enrollment
  device_name       TEXT NOT NULL,            -- Human label: "Windows Laptop", "iPhone 15 Pro"
  device_type       TEXT NOT NULL             -- 'windows_workstation' | 'iphone'
                    CHECK (device_type IN ('windows_workstation', 'iphone')),
  enrolled_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enrolled_by       TEXT NOT NULL,            -- 'initial_setup' or operator session_id
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'revoked', 'pending_replacement')),

  -- WebAuthn credential
  credential_id     BYTEA NOT NULL UNIQUE,    -- WebAuthn credential ID
  public_key        BYTEA NOT NULL,           -- COSE public key
  sign_count        BIGINT NOT NULL DEFAULT 0,-- Signature counter for clone detection
  attestation_fmt   TEXT,                     -- 'tpm' | 'apple' | 'packed' | 'none'
  attestation_data  JSONB,                    -- Full attestation object for audit

  -- mTLS (agent device only)
  client_cert_fingerprint TEXT,               -- SHA-256 fingerprint of client certificate
  client_cert_expires_at  TIMESTAMPTZ,        -- Certificate expiry
  client_cert_serial      TEXT,               -- Certificate serial number

  -- Device metadata
  platform          TEXT,                     -- 'Windows 11' | 'iOS 17'
  user_agent        TEXT,                     -- Captured at enrollment
  last_seen_at      TIMESTAMPTZ,             -- Last successful authentication
  last_seen_ip      TEXT,                     -- Last known IP (for anomaly detection, not auth)

  -- TOTP
  totp_secret_encrypted BYTEA,               -- AES-256-GCM encrypted TOTP secret
  totp_provisioned_at   TIMESTAMPTZ
);

-- Hard constraint: maximum 2 active devices
CREATE UNIQUE INDEX idx_max_active_devices
  ON enrolled_devices ((1))
  WHERE status = 'active'
  -- Note: This index approach is illustrative. Actual enforcement via application-level check
  -- and a CHECK constraint trigger that counts active devices.
```

### Application-Level Enforcement

```typescript
async function enrollDevice(device: DeviceEnrollment): Promise<void> {
  const activeCount = await db.query(
    'SELECT COUNT(*) FROM enrolled_devices WHERE status = $1',
    ['active']
  );
  if (activeCount >= 2) {
    throw new Error('Maximum enrolled devices reached. Revoke an existing device first.');
  }
  // ... proceed with enrollment
}
```

## Device-Bound Crypto Identity

### Windows (TPM 2.0)

- **Key generation**: WebAuthn credential created with `authenticatorAttachment: "platform"` and `residentKey: "required"`. The private key is generated inside the TPM and never leaves it.
- **Key storage**: TPM-bound. Not extractable, not syncable. Survives OS reinstall if TPM is not cleared.
- **Attestation**: TPM attestation statement proves the key was generated in a genuine TPM. Broker verifies the attestation certificate chain.
- **Client certificate**: A separate RSA-4096 or ECDSA P-256 client certificate is issued during enrollment for mTLS. The private key is stored in the Windows certificate store (preferably TPM-backed via Key Storage Provider).

### iPhone (Secure Enclave)

- **Key generation**: WebAuthn credential created via platform authenticator. The private key is generated in the Secure Enclave.
- **Key storage**: Secure Enclave-protected. Accessible only via biometric (Face ID / Touch ID) or device passcode.
- **iCloud sync caveat**: Apple's platform authenticator syncs passkeys via iCloud Keychain. See [PASSKEY_MODEL.md](PASSKEY_MODEL.md) for mitigation details.
- **Device attestation**: Apple's attestation format provides device-level provenance. Broker stores and validates this during enrollment and approval flows.

## WebAuthn Passkeys

Primary authentication mechanism for both devices. See [PASSKEY_MODEL.md](PASSKEY_MODEL.md) for full specification.

Key requirements:
- Platform authenticators only (`authenticatorAttachment: "platform"`)
- Resident keys required (`residentKey: "required"`)
- User verification required (`userVerification: "required"`)
- Registration only during controlled enrollment windows

## Client Certificates (mTLS)

Used exclusively for the agent-to-broker WebSocket channel.

### Issuance

1. During Windows laptop enrollment, after passkey registration succeeds:
2. Agent generates a CSR (Certificate Signing Request) with the device_id as the Common Name.
3. CSR is sent to the broker.
4. Broker signs the CSR with its internal CA (self-signed CA dedicated to this purpose).
5. Broker returns the signed client certificate.
6. Agent stores the certificate and private key in the Windows certificate store.
7. Broker stores the certificate fingerprint in the enrolled device registry.

### Validation

On every WebSocket connection:
1. NGINX (or Node.js TLS) requires a client certificate.
2. Broker extracts the certificate fingerprint.
3. Broker looks up the fingerprint in the enrolled device registry.
4. If not found or device status is not `active`: reject connection.
5. If certificate is expired: reject connection, notify operator.

### Renewal

- Client certificates expire after 90 days.
- 14 days before expiry, the agent initiates renewal:
  1. Agent generates a new CSR.
  2. Agent authenticates to broker via the still-valid existing certificate.
  3. Broker validates the request and issues a new certificate.
  4. Agent installs the new certificate and confirms to broker.
  5. Broker updates the fingerprint in the registry.
  6. Old certificate is revoked.

## Enrollment Workflow

Enrollment is a deliberate, auditable, time-limited process.

### Prerequisites

- Broker is running and accessible.
- Operator has SSH access to the VPS (for initial setup only).

### Initial Enrollment (First Device)

```
1. Operator SSHs into VPS
2. Operator runs: sovereign-console enroll --generate-invite
3. System generates a single-use invite URL with:
   - 15-minute expiry
   - Cryptographically random token (64 chars)
   - Bound to a specific device_type ('windows_workstation' or 'iphone')
4. Operator opens invite URL on the target device
5. Browser initiates WebAuthn registration ceremony
6. Operator completes biometric/PIN
7. Broker validates attestation, stores credential
8. TOTP secret generated, displayed as QR code
9. Operator scans QR code with authenticator app
10. Operator enters TOTP code to confirm provisioning
11. For Windows: mTLS client certificate issued
12. Invite link invalidated
13. Audit log entry: DEVICE_ENROLLED
```

### Second Device Enrollment

```
1. Operator authenticates on first enrolled device (passkey)
2. Operator navigates to: Settings → Devices → Enroll New Device
3. System generates invite URL (same constraints as above)
4. Operator opens invite on second device
5. Same enrollment flow as steps 5-13 above
6. Audit log entry: DEVICE_ENROLLED (includes enrolling device's session_id)
```

### Invite Constraints

- Single-use: consumed on first access, regardless of success/failure.
- Time-limited: 15 minutes from generation.
- Device-type bound: an invite for `iphone` cannot be used to enroll a `windows_workstation`.
- Maximum 1 active invite at a time.

## Session Issuance Requirements

A valid session requires:

1. **Successful WebAuthn authentication** against an enrolled device credential.
2. **Device status is `active`** in the enrolled device registry.
3. **Signature counter validation**: The authenticator's sign count must be greater than the stored count. If equal or less, possible credential cloning is flagged and the session is denied.
4. **Session binding**: Session is bound to `device_id` and cannot be transferred.

Session properties:
- `session_id`: UUIDv4
- `device_id`: The authenticated device
- `issued_at`: Timestamp
- `expires_at`: 30 minutes from issuance (configurable)
- `max_lifetime`: 8 hours (requires full re-auth after this)
- `last_activity`: Updated on each API call, used for idle timeout
- `idle_timeout`: 15 minutes of inactivity

## iPhone as Approval Authority

The iPhone serves as the primary approval device for destructive operations:

1. **Approval requests** are routed to the iPhone via push notification or WebSocket.
2. **Operator reviews** the action details on the iPhone.
3. **Operator approves** with passkey (biometric) authentication.
4. **Approval response** is cryptographically signed and sent to the broker.
5. **Broker validates** the device_id, signature, and approval token.

The iPhone can also initiate tasks via its browser, but approval of its own tasks requires the Windows device (mutual approval — neither device can self-approve destructive actions).

## Fail-Closed Rules

The system defaults to **deny** in all ambiguous or error conditions:

| Condition | Behavior |
|---|---|
| Unknown device_id in request | Reject, log alert |
| Device status is `suspended` or `revoked` | Reject, log alert |
| WebAuthn assertion fails | Reject, log failed attempt |
| Signature counter anomaly (clone detection) | Reject, suspend device, alert operator |
| Client certificate not presented on agent WebSocket | Reject connection |
| Client certificate fingerprint not in registry | Reject connection, log alert |
| Client certificate expired | Reject connection, notify operator |
| Session expired | Reject API call, require re-auth |
| Session device_id doesn't match request origin | Reject, log alert |
| Approval from non-enrolled device | Reject, log alert |
| Approval signature invalid | Reject, log alert |
| More than 2 active devices attempted | Reject enrollment |
| Invite expired or already used | Reject enrollment |
| TOTP validation fails | Reject step-up, increment failure counter |
| Broker cannot reach any enrolled device for approval | Queue task with TTL, do not auto-approve |
| Database unreachable | Reject all operations (no auth state = no access) |
| Audit log insert fails | Reject the operation that triggered the log (operations require successful audit) |

## Recovery and Replacement Procedures

### Single Device Replacement (Other Device Available)

```
1. Operator authenticates on the remaining enrolled device
2. Operator navigates to: Settings → Devices → [lost device] → Revoke
3. Operator confirms revocation with passkey + TOTP
4. Lost device's status set to 'revoked'
5. Lost device's client certificate (if any) added to revocation list
6. Operator generates new enrollment invite for replacement device
7. Standard enrollment flow on new device
8. Audit log entries: DEVICE_REVOKED, DEVICE_ENROLLED
```

### Both Devices Lost

See [BREAK_GLASS_RECOVERY.md](BREAK_GLASS_RECOVERY.md).

### Device Suspension (Temporary)

If a device is suspected compromised but not confirmed:

```
1. Operator authenticates on the other device
2. Operator suspends the suspect device
3. Suspended device cannot authenticate or approve
4. Investigation proceeds
5. Operator either reactivates or revokes
```

Suspension is reversible; revocation is permanent.
