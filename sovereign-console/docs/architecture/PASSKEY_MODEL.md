# Passkey / WebAuthn Design

## Architecture

The Sovereign Operator Console uses **WebAuthn / FIDO2** as its primary authentication mechanism. Passkeys replace passwords entirely — there is no password-based authentication path in the system.

### Key Principles

1. **Platform authenticators preferred**: Keys are generated in hardware security modules (TPM, Secure Enclave), not in software or roaming authenticators.
2. **Device-bound by design**: Credentials are tied to enrolled physical devices.
3. **No silent fallback**: There is no password fallback. If passkey auth fails, the operator must troubleshoot or use break-glass recovery.
4. **Registration is controlled**: Passkeys can only be registered during a time-limited enrollment window.

## WebAuthn Registration Options

### Common Options (Both Devices)

```typescript
const registrationOptions: PublicKeyCredentialCreationOptions = {
  rp: {
    id: 'ops.lancewfisher.com',
    name: 'Sovereign Operator Console',
  },
  user: {
    id: userIdBuffer,           // Random 64-byte identifier
    name: 'operator',           // Single operator
    displayName: 'Sovereign Operator',
  },
  challenge: serverChallenge,   // 32 bytes, cryptographically random, single-use
  pubKeyCredParams: [
    { alg: -7, type: 'public-key' },   // ES256 (preferred)
    { alg: -257, type: 'public-key' }, // RS256 (fallback)
  ],
  timeout: 120000,              // 2 minutes
  attestation: 'direct',       // Request attestation for device verification
  authenticatorSelection: {
    authenticatorAttachment: 'platform',  // No roaming authenticators
    residentKey: 'required',              // Discoverable credential
    userVerification: 'required',         // Biometric or PIN mandatory
  },
  excludeCredentials: existingCredentials, // Prevent duplicate registration
};
```

### Windows: TPM-Backed, Non-Syncable

**Goal**: Ensure the passkey is generated in the TPM and cannot be synced to other devices or cloud services.

**Registration enforcement**:

1. `authenticatorAttachment: "platform"` — Restricts to the Windows platform authenticator (Windows Hello).
2. `residentKey: "required"` — Forces a discoverable credential stored on the device.
3. `attestation: "direct"` — Requests attestation so the broker can verify TPM provenance.

**Attestation verification**:

After registration, the broker examines the attestation statement:

```typescript
async function verifyWindowsAttestation(attestation: AttestationObject): Promise<void> {
  // Verify attestation format is 'tpm'
  if (attestation.fmt !== 'tpm') {
    throw new Error('Windows credential must use TPM attestation');
  }

  // Verify TPM attestation certificate chain
  // The certInfo structure in TPM attestation contains:
  // - TPMS_ATTEST structure with magic 0xFF544347 ("TCG")
  // - type: TPM_ST_ATTEST_CERTIFY
  // Broker validates the AIK certificate chain against known TPM manufacturer roots

  // Store attestation metadata for audit
}
```

**Chrome sync mitigation**:

Chrome on Windows may offer to sync passkeys via Google Password Manager. This undermines device binding.

Mitigations:
1. **`excludeCredentials`**: Include any previously registered credentials to prevent duplicate registrations that might route through a different authenticator.
2. **Attestation verification**: After registration, verify that the attestation statement indicates TPM origin (`fmt: 'tpm'`). If the attestation format is `none` or `packed` without TPM provenance, reject the credential.
3. **Operator documentation**: During enrollment, the operator is instructed:
   > **IMPORTANT**: When Chrome displays the registration dialog, select **"Windows Hello"** or **"This device"**. Do NOT select:
   > - "Use a phone or security key"
   > - "Use Google Password Manager"
   > - "Save to your Google Account"
   >
   > The credential MUST be stored in the device's TPM. Cloud-synced credentials will be rejected.

4. **Post-registration check**: If the attestation format is not `tpm`, the broker rejects the credential and instructs the operator to retry.

### iPhone: Secure Enclave

**Goal**: Credential is generated in the Secure Enclave and authenticated via biometric.

**Registration**:

On iOS, `authenticatorAttachment: "platform"` routes to the system passkey provider, which uses the Secure Enclave for key generation and iCloud Keychain for storage.

**iCloud Keychain sync behavior**:

Apple's implementation **will sync passkeys** to all Apple devices signed into the same Apple ID via iCloud Keychain. This is by design and cannot be prevented at the WebAuthn API level.

**Risk**: A non-enrolled iPad, Mac, or other Apple device signed into the same Apple ID could potentially use the synced passkey to authenticate to the broker.

**Mitigation — Defense in Depth**:

The passkey alone is **insufficient** for access. The device trust layer provides additional binding:

1. **Enrolled device registry**: The broker maintains a registry of exactly 2 enrolled devices. Even if a synced passkey is used from an iPad, the iPad's device_id will not match any enrolled device.

2. **Device fingerprint challenge**: During authentication, the broker issues a device fingerprint challenge that includes:
   - User-Agent validation (expected iOS version / device model)
   - Client-side device_id stored in the app's local storage (not synced by iCloud)
   - Optionally: a device-specific client certificate installed only on the enrolled iPhone

3. **Approval flow binding**: Approval responses include the device_id and a signature. The broker validates that the device_id matches the enrolled iPhone.

4. **Alert on unknown device**: If a valid passkey assertion arrives from an unrecognized device context, the broker:
   - Rejects the authentication
   - Logs an alert: `PASSKEY_USED_FROM_UNKNOWN_DEVICE`
   - Sends a notification to the enrolled devices

**Residual risk**: An attacker who gains access to the operator's Apple ID, the iCloud Keychain passkey, AND can spoof the device fingerprint challenge could potentially authenticate. This residual risk is documented and accepted because:
- It requires compromise of the Apple ID (protected by Apple's own 2FA)
- The device fingerprint challenge adds a layer the passkey sync does not cover
- Step-up auth (TOTP) provides an additional factor not tied to Apple's ecosystem
- The threat model entry for "iCloud sync exposure" documents this explicitly

## WebAuthn Authentication Options

```typescript
const authenticationOptions: PublicKeyCredentialRequestOptions = {
  rpId: 'ops.lancewfisher.com',
  challenge: serverChallenge,     // 32 bytes, cryptographically random, single-use
  timeout: 120000,                // 2 minutes
  userVerification: 'required',   // Always require biometric/PIN
  allowCredentials: [],           // Empty for discoverable credentials (resident keys)
};
```

Using an empty `allowCredentials` array with discoverable credentials means the authenticator selects the credential, and the broker matches it against the enrolled device registry.

## Registration Constraints

- **Enrollment window only**: WebAuthn registration is only possible during an active enrollment session (invite link).
- **No self-registration**: There is no public registration endpoint.
- **Single credential per device**: Each enrolled device has exactly one WebAuthn credential.
- **Re-registration**: If a credential must be replaced (e.g., TPM cleared), the device must be revoked and re-enrolled.

## Authentication Ceremony Validation

The broker performs the following checks on every authentication assertion:

```
1. Challenge matches the server-issued challenge (replay prevention)
2. Origin matches https://ops.lancewfisher.com
3. RP ID matches ops.lancewfisher.com
4. User verification flag (UV) is set in authenticator data
5. Signature validates against the stored public key
6. Signature counter > stored counter (clone detection)
7. Credential ID matches an enrolled device in 'active' status
8. If counter anomaly detected: REJECT and SUSPEND device
```

## Event Logging

All passkey events are logged with platform-binding status:

| Event | Logged Fields |
|---|---|
| Registration started | device_type, invite_id, timestamp |
| Registration completed | device_id, credential_id (truncated), attestation_fmt, platform |
| Registration rejected | reason (e.g., "non-TPM attestation"), device_type |
| Authentication started | timestamp, request_origin |
| Authentication succeeded | device_id, credential_id (truncated), sign_count, user_agent |
| Authentication failed | reason, credential_id (truncated, if available), request_origin |
| Counter anomaly | device_id, expected_count, received_count |
| Unknown device passkey use | credential_id (truncated), user_agent, IP |

## No Password Fallback

The system has **no password authentication**. There is no password field, no password hash stored, no password reset flow. Authentication paths are:

1. **Primary**: WebAuthn passkey
2. **Step-up**: WebAuthn passkey + TOTP
3. **Recovery**: Break-glass codes (see [BREAK_GLASS_RECOVERY.md](BREAK_GLASS_RECOVERY.md))

If the operator's passkey does not work (e.g., biometric failure), the options are:
- Retry biometric
- Use device PIN (Windows Hello PIN, iPhone passcode) as the user verification method
- Use the other enrolled device
- Use break-glass recovery if both devices are unavailable
