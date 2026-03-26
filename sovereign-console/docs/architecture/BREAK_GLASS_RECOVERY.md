# Break-Glass Recovery Procedure

## Scenario

Both enrolled devices (Windows laptop and iPhone) are simultaneously unavailable. This could occur due to:

- Theft of both devices
- Simultaneous hardware failure
- Natural disaster destroying both devices
- Forgotten device passcodes after extended non-use
- Corrupted TPM and iCloud Keychain simultaneously

Without break-glass recovery, the operator would be permanently locked out of the system.

## Recovery Mechanism

### Recovery Codes

A set of **10 single-use recovery codes** is generated during initial system setup. These codes are the last-resort authentication mechanism.

**Code format**: 32-character high-entropy random string, alphanumeric, displayed in groups of 4 for readability.

```
Example code: XKWJ-9N4F-M2RP-VTHQ-8AEB-C3YG-DJLW-7SKF
```

### Code Generation

```typescript
function generateRecoveryCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const bytes = crypto.randomBytes(24); // 192 bits of entropy
    const code = bytes.toString('base64url').substring(0, 32).toUpperCase();
    codes.push(code);
  }
  return codes;
}
```

### Code Storage

**Operator's responsibility**: Codes must be stored in a physically secure location:

- Printed on paper, stored in a safe or safety deposit box
- Written on paper (not photographed, not stored digitally on any connected device)
- NOT stored in: email, cloud storage, password manager on enrolled devices, digital notes

**Broker storage**: Each code is stored as a bcrypt hash (cost factor 12) in the database. The plaintext is never stored.

```sql
CREATE TABLE recovery_codes (
  id            SERIAL PRIMARY KEY,
  code_hash     TEXT NOT NULL,              -- bcrypt hash of the recovery code
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'used', 'rotated')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at       TIMESTAMPTZ,
  rotated_at    TIMESTAMPTZ
);
```

## Recovery Flow

### Step 1: Access Break-Glass URL

```
1. Operator accesses: https://ops.lancewfisher.com/recover
2. This endpoint is always available (no authentication required to load the page)
3. The page displays:
   - A recovery code input field
   - A warning: "This action is logged and all recovery codes will be rotated after use"
   - No other functionality (no links to login, no device enrollment)
```

### Step 2: Enter Recovery Code

```
1. Operator enters one of their 10 recovery codes
2. Broker hashes the input and compares against stored hashes
3. Rate limiting: maximum 3 attempts per 15 minutes (by IP)
4. After 5 failed attempts from any IP: recovery endpoint locked for 1 hour
5. If code matches an active code:
   a. Code status → 'used', used_at → NOW()
   b. Proceed to Step 3
6. If no match: "Invalid recovery code" (no information about which codes exist)
```

### Step 3: Optional TOTP Verification

If the operator has access to their TOTP authenticator app on a separate device (e.g., the authenticator app was synced to a tablet or backup device):

```
1. Broker prompts for TOTP code
2. Operator enters 6-digit code
3. Broker validates against stored TOTP secret
4. If valid: stronger assurance, logged as "recovery with TOTP"
5. If operator clicks "I don't have access to my authenticator": skip to Step 4
   - This path is logged as "recovery without TOTP" (lower assurance)
```

### Step 4: Device Re-Enrollment

Recovery does **not** restore a session. It only allows device re-enrollment.

```
1. Broker generates a time-limited enrollment invite (15 minutes)
2. The enrollment invite is displayed on the current page
3. Operator opens the invite URL on their new/replacement device
4. Standard enrollment flow:
   a. WebAuthn passkey registration
   b. TOTP provisioning
   c. Client certificate issuance (if Windows workstation)
5. After enrollment, the operator can authenticate normally on the new device
6. The old device(s) are automatically revoked
```

### Step 5: Recovery Code Rotation

After any single recovery code is used:

```
1. ALL remaining active recovery codes are invalidated (status → 'rotated')
2. A new set of 10 codes is generated
3. New codes are displayed ONCE to the operator
4. Operator must save them to their secure physical location
5. New code hashes are stored in the database
6. Audit log: RECOVERY_CODES_ROTATED
```

### Step 6: Second Device Enrollment

After the first replacement device is enrolled:

```
1. Operator authenticates on the newly enrolled device
2. Operator generates an enrollment invite for the second device
3. Standard enrollment flow on the second device
4. System returns to normal two-device operation
```

## Full Audit Trail

Every step of the break-glass process is logged:

| Event | Detail |
|---|---|
| `BREAK_GLASS_PAGE_ACCESSED` | IP address, user agent, timestamp |
| `BREAK_GLASS_CODE_ATTEMPT` | IP address, result (valid/invalid), code index (not the code itself) |
| `BREAK_GLASS_CODE_RATE_LIMIT` | IP address, attempt count |
| `BREAK_GLASS_INITIATED` | IP address, code index, with/without TOTP |
| `BREAK_GLASS_TOTP_VERIFIED` | Result |
| `BREAK_GLASS_ENROLLMENT_STARTED` | Invite ID, device type |
| `BREAK_GLASS_COMPLETED` | New device_id, old devices revoked |
| `RECOVERY_CODES_ROTATED` | Count of old codes invalidated, count of new codes generated |
| `DEVICE_REVOKED` | Each old device revoked as part of recovery |

## Security Properties

### What Recovery Does

- Allows enrollment of one new device
- Revokes all previously enrolled devices
- Rotates all recovery codes
- Creates a full audit trail

### What Recovery Does NOT Do

- Restore an existing session
- Provide access to any data without re-authentication on the new device
- Preserve old device credentials (all are revoked)
- Allow skipping device enrollment (operator must complete full enrollment)

### Rate Limiting and Abuse Prevention

| Control | Value |
|---|---|
| Code attempts per 15 min (per IP) | 3 |
| Lockout after failed attempts (any IP) | 5 failures → 1 hour lockout |
| Lockout escalation | 3 lockouts in 24 hours → 24 hour lockout |
| Brute force resistance | 32-char alphanumeric = ~190 bits entropy. At 3 attempts per 15 min, infeasible. |
| Code set rotation | After any single use, all 10 codes become invalid |

### Physical Security Dependency

The security of break-glass recovery depends entirely on the physical security of the recovery codes. If an attacker obtains a recovery code, they can:

1. Lock out the operator by revoking enrolled devices
2. Enroll their own device
3. Gain full access to the system

**Mitigations**:
- Recovery codes should be stored in a location that requires physical presence (safe, safety deposit box)
- The operator should verify their recovery codes periodically (e.g., annually)
- The audit trail of break-glass events is immutable, so any misuse is detectable after the fact

## Testing

The break-glass flow should be tested during initial system setup:

```
1. Complete system setup with both devices enrolled
2. Generate recovery codes and store securely
3. Use one recovery code to verify the flow works end-to-end
4. Re-enroll the device that was revoked during testing
5. Store the new (rotated) recovery codes
```

This test consumes one code and triggers rotation, which is intentional — it verifies the entire flow including rotation.
