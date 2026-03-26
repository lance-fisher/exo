# TOTP (Time-Based One-Time Password) Model

## Overview

TOTP provides a second authentication factor for step-up scenarios. It is based on RFC 6238 with a 30-second time window, generating 6-digit codes.

TOTP is **not** the primary authentication mechanism — WebAuthn passkeys are. TOTP serves as an additional factor for high-risk operations and as a recovery path component.

## Specification

| Parameter | Value |
|---|---|
| Algorithm | HMAC-SHA1 (RFC 6238 default, widest authenticator compatibility) |
| Digits | 6 |
| Period | 30 seconds |
| Window tolerance | 1 step (accepts codes from t-1, t, t+1 for clock skew) |
| Secret length | 160 bits (20 bytes), base32 encoded |
| Issuer | `SovereignConsole` |
| Account label | `operator@ops.lancewfisher.com` |

## Provisioning

TOTP is provisioned during device enrollment, immediately after WebAuthn credential registration:

```
1. Broker generates a cryptographically random 20-byte secret
2. Broker encrypts the secret with AES-256-GCM (key from broker's master secret)
3. Broker stores the encrypted secret in enrolled_devices.totp_secret_encrypted
4. Broker generates a provisioning URI:
   otpauth://totp/SovereignConsole:operator@ops.lancewfisher.com?secret=BASE32SECRET&issuer=SovereignConsole&algorithm=SHA1&digits=6&period=30
5. Broker renders the URI as a QR code in the enrollment UI
6. Operator scans QR code with authenticator app (e.g., Authy, Google Authenticator, 1Password)
7. Operator enters the current TOTP code to confirm provisioning
8. Broker validates the code
9. If valid: totp_provisioned_at is set, enrollment continues
10. If invalid: operator can retry (3 attempts) or restart enrollment
11. QR code is displayed ONCE and never retrievable again
```

### Provisioning Security

- The TOTP secret is displayed only during the enrollment ceremony.
- The QR code is rendered client-side (no server-side image caching).
- The provisioning page is protected by the enrollment session (time-limited invite).
- The raw secret (base32 string) is also displayed as text below the QR code for manual entry, then hidden after confirmation.

## Usage Scenarios

TOTP is required for:

| Scenario | Description |
|---|---|
| **Step-up on write ops** | Any file write, configuration change, or destructive action requires TOTP in addition to the passkey-authenticated session |
| **Recovery initiation** | Starting the break-glass recovery process requires a TOTP code (if the operator has access to their authenticator app on a separate device) |
| **Re-enrollment** | Enrolling a replacement device requires TOTP from the remaining device's authenticator |
| **Revocation confirmation** | Revoking a device requires TOTP to prevent accidental revocation |
| **Suspicious session challenge** | If the broker detects anomalous behavior (unusual IP, rapid API calls), it challenges the session with TOTP |
| **Break-glass entry** | TOTP from a backup authenticator is an optional second factor during break-glass recovery |

## Rate Limiting

### Per-Attempt Rate Limit

- **Maximum**: 3 validation attempts per 90-second window
- **Enforcement**: Broker tracks attempts per device_id using a Redis counter with 90-second TTL
- **Behavior**: After 3 attempts in 90 seconds, further attempts are rejected with HTTP 429 until the window expires

### Lockout

- **Trigger**: 5 failed attempts within 5 minutes
- **Duration**: 15-minute lockout
- **Scope**: Per device_id (not global)
- **Behavior**: All TOTP validation requests for the locked device are rejected
- **Notification**: Operator is notified on all enrolled devices about the lockout
- **Unlock**: Automatic after 15 minutes, or manual unlock via the other enrolled device with passkey auth

### Brute-Force Resistance

With 6-digit codes and the rate limiting above:
- An attacker gets at most 3 attempts per 90 seconds before throttling
- After 5 failures, 15-minute lockout
- Expected attempts to guess a code: 500,000 (6 digits = 1,000,000 possibilities, 50% chance at 500K)
- At 3 attempts per 90 seconds with lockouts: ~104 days to reach 500K attempts
- Combined with code rotation every 30 seconds, brute force is computationally infeasible

## Secret Storage

### Encryption

```typescript
interface TOTPSecretStorage {
  // The raw TOTP secret is NEVER stored in plaintext
  encrypted_secret: Buffer;   // AES-256-GCM ciphertext
  iv: Buffer;                 // 12-byte initialization vector (unique per encryption)
  auth_tag: Buffer;           // GCM authentication tag
  key_version: number;        // Identifies which encryption key was used (for rotation)
}
```

### Encryption Key

- Derived from the broker's master secret using HKDF
- Master secret loaded from environment variable, never stored in database
- Key rotation: when master secret rotates, re-encrypt all TOTP secrets with new key

### Access Controls

- TOTP secrets are only decrypted at the moment of validation, in memory, and immediately discarded.
- No API endpoint exposes the TOTP secret or QR code after provisioning.
- Database backups contain only encrypted secrets.
- Application logs never contain TOTP secrets, codes, or encrypted blobs.
- The `detail` field in audit logs for TOTP events contains only: `{ "result": "valid" | "invalid", "device_id": "..." }` — never the code itself.

## Reprovisioning

If the operator loses access to their authenticator app (e.g., phone reset without backup):

### With Other Device Available

```
1. Authenticate on the other enrolled device (passkey)
2. Navigate to: Settings → Security → Reprovision TOTP for [device]
3. Confirm with current passkey + existing TOTP from the other device's authenticator
4. Broker generates a new TOTP secret
5. Display QR code for the target device
6. Operator scans and confirms with new code
7. Old TOTP secret is overwritten
8. Audit log entry: TOTP_REPROVISIONED
```

### Without Other Device (Break-Glass)

```
1. Access break-glass recovery URL
2. Enter recovery code
3. Follow device re-enrollment flow (which includes TOTP provisioning)
4. See BREAK_GLASS_RECOVERY.md
```

## Authenticator App Recommendations

The operator should use an authenticator app that supports:

- Cloud backup of TOTP secrets (for survivability across device replacement)
- Biometric lock on the authenticator app itself
- Cross-platform availability (so TOTP can be accessed even if the enrolled device is lost)

Recommended: **Authy** (cross-device sync, encrypted backups) or **1Password** (integrated with password manager, encrypted vault).

**Important**: The authenticator app is intentionally decoupled from the enrolled device hardware. This is by design — TOTP should survive the loss of one enrolled device because it's stored in the authenticator app's cloud backup, not solely on the lost device.
