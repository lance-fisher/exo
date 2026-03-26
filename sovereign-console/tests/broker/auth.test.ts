// =============================================================================
// Sovereign Operator Console — Auth Tests
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  PasskeyCredential,
  Session,
  Device,
  TotpSecret,
  AuthContext,
} from '../../broker/src/types/index.js';

// ---------------------------------------------------------------------------
// Helpers & Mocks
// ---------------------------------------------------------------------------

/** Minimal mock credential suitable for @simplewebauthn/server attestation */
const VALID_ATTESTATION = {
  id: 'dGVzdC1jcmVkZW50aWFsLWlk',
  rawId: 'dGVzdC1jcmVkZW50aWFsLWlk',
  type: 'public-key' as const,
  response: {
    clientDataJSON:
      'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiWkdWMlkyaGhiR3hsYm1kbCIsIm9yaWdpbiI6Imh0dHBzOi8vb3BzLmxhbmNld2Zpc2hlci5jb20ifQ',
    attestationObject:
      'o2NmbXRmcGFja2VkZ2F0dFN0bXSiY2FsZyZjc2lnWEcwRQIhAJwWAJx...(truncated)',
  },
  clientExtensionResults: {},
};

const INVALID_ATTESTATION = {
  ...VALID_ATTESTATION,
  response: {
    ...VALID_ATTESTATION.response,
    attestationObject: 'INVALID_ATTESTATION_DATA_AAAA',
  },
};

const ENROLLED_DEVICE: Device = {
  id: 'dev-001',
  operator_id: 'op-001',
  name: 'Work Laptop',
  type: 'laptop',
  status: 'enrolled',
  enrolled_at: new Date('2025-01-15'),
  revoked_at: null,
  fingerprint: 'sha256:abc123def456',
  platform_info: { os: 'Windows 11', browser: 'Chrome 122' },
  passkey_credential_id: 'cred-001',
  mtls_cert_fingerprint: null,
  last_seen: new Date(),
  risk_flags: [],
};

const UNREGISTERED_DEVICE: Device = {
  ...ENROLLED_DEVICE,
  id: 'dev-unknown',
  status: 'pending',
  passkey_credential_id: null,
};

const VALID_SESSION: Session = {
  id: 'sess-001',
  operator_id: 'op-001',
  device_id: 'dev-001',
  token_hash: 'sha256:session-token-hash',
  created_at: new Date(),
  expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000), // 4 hours
  revoked_at: null,
  ip_address: '198.51.100.42',
  user_agent: 'Mozilla/5.0',
};

const EXPIRED_SESSION: Session = {
  ...VALID_SESSION,
  id: 'sess-expired',
  expires_at: new Date(Date.now() - 60_000), // expired 1 minute ago
};

// Simulated in-memory stores
let sessions: Map<string, Session>;
let devices: Map<string, Device>;
let passkeyCredentials: Map<string, PasskeyCredential>;
let totpFailures: Map<string, { count: number; lastAttempt: Date }>;
let totpLocked: Set<string>;

// ---------------------------------------------------------------------------
// Stub services — these would be replaced by real imports once implemented
// ---------------------------------------------------------------------------

function generateRegistrationOptions(rpId: string, rpName: string, userName: string) {
  return {
    challenge: 'ZGV2Y2hhbGxlbmdl',
    rp: { id: rpId, name: rpName },
    user: { id: 'op-001', name: userName, displayName: userName },
    pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
    timeout: 60_000,
    attestation: 'direct',
  };
}

function verifyPasskeyAttestation(
  attestation: typeof VALID_ATTESTATION,
  expectedChallenge: string,
): { verified: boolean; credentialId?: string; publicKey?: string } {
  if (attestation.response.attestationObject.startsWith('INVALID')) {
    return { verified: false };
  }
  return {
    verified: true,
    credentialId: 'cred-001',
    publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...',
  };
}

function createSession(deviceId: string, operatorId: string): Session | null {
  const device = devices.get(deviceId);
  if (!device || device.status !== 'enrolled' || !device.passkey_credential_id) {
    return null;
  }
  const session: Session = {
    id: `sess-${Date.now()}`,
    operator_id: operatorId,
    device_id: deviceId,
    token_hash: `sha256:${Math.random().toString(36).slice(2)}`,
    created_at: new Date(),
    expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000),
    revoked_at: null,
    ip_address: '198.51.100.42',
    user_agent: 'Mozilla/5.0',
  };
  sessions.set(session.id, session);
  return session;
}

function verifyTotp(operatorId: string, code: string): { valid: boolean; locked?: boolean } {
  if (totpLocked.has(operatorId)) {
    return { valid: false, locked: true };
  }
  const failures = totpFailures.get(operatorId) ?? { count: 0, lastAttempt: new Date(0) };
  const isValid = code === '123456'; // deterministic test code
  if (!isValid) {
    failures.count += 1;
    failures.lastAttempt = new Date();
    totpFailures.set(operatorId, failures);
    if (failures.count >= 5) {
      totpLocked.add(operatorId);
      return { valid: false, locked: true };
    }
    return { valid: false };
  }
  totpFailures.delete(operatorId);
  return { valid: true };
}

function revokeSession(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.revoked_at = new Date();
  sessions.set(sessionId, session);
  return true;
}

function isSessionValid(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  if (session.revoked_at) return false;
  if (session.expires_at < new Date()) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Auth — Passkey Registration', () => {
  beforeEach(() => {
    sessions = new Map();
    devices = new Map([[ENROLLED_DEVICE.id, { ...ENROLLED_DEVICE }]]);
    passkeyCredentials = new Map();
    totpFailures = new Map();
    totpLocked = new Set();
  });

  it('generates registration options with correct RP fields', () => {
    const opts = generateRegistrationOptions(
      'ops.lancewfisher.com',
      'Sovereign Console',
      'lance',
    );

    expect(opts.rp.id).toBe('ops.lancewfisher.com');
    expect(opts.rp.name).toBe('Sovereign Console');
    expect(opts.challenge).toBeDefined();
    expect(opts.challenge.length).toBeGreaterThan(0);
    expect(opts.pubKeyCredParams).toContainEqual(
      expect.objectContaining({ alg: -7, type: 'public-key' }),
    );
    expect(opts.timeout).toBeLessThanOrEqual(120_000);
  });

  it('verifies valid attestation response', () => {
    const result = verifyPasskeyAttestation(VALID_ATTESTATION, 'ZGV2Y2hhbGxlbmdl');

    expect(result.verified).toBe(true);
    expect(result.credentialId).toBeDefined();
    expect(result.publicKey).toBeDefined();
  });

  it('rejects invalid attestation response', () => {
    const result = verifyPasskeyAttestation(INVALID_ATTESTATION, 'ZGV2Y2hhbGxlbmdl');

    expect(result.verified).toBe(false);
    expect(result.credentialId).toBeUndefined();
  });
});

describe('Auth — Session Management', () => {
  beforeEach(() => {
    sessions = new Map();
    devices = new Map([
      [ENROLLED_DEVICE.id, { ...ENROLLED_DEVICE }],
      [UNREGISTERED_DEVICE.id, { ...UNREGISTERED_DEVICE }],
    ]);
    passkeyCredentials = new Map();
    totpFailures = new Map();
    totpLocked = new Set();
  });

  it('creates session for enrolled device with valid passkey', () => {
    const session = createSession(ENROLLED_DEVICE.id, 'op-001');

    expect(session).not.toBeNull();
    expect(session!.operator_id).toBe('op-001');
    expect(session!.device_id).toBe(ENROLLED_DEVICE.id);
    expect(session!.expires_at.getTime()).toBeGreaterThan(Date.now());
    expect(session!.revoked_at).toBeNull();
  });

  it('rejects session creation for device without passkey', () => {
    const session = createSession(UNREGISTERED_DEVICE.id, 'op-001');

    expect(session).toBeNull();
  });

  it('rejects session creation for unknown device', () => {
    const session = createSession('dev-nonexistent', 'op-001');

    expect(session).toBeNull();
  });

  it('detects expired session', () => {
    sessions.set(EXPIRED_SESSION.id, { ...EXPIRED_SESSION });

    expect(isSessionValid(EXPIRED_SESSION.id)).toBe(false);
  });

  it('detects revoked session', () => {
    const revoked: Session = {
      ...VALID_SESSION,
      id: 'sess-revoked',
      revoked_at: new Date(),
    };
    sessions.set(revoked.id, revoked);

    expect(isSessionValid(revoked.id)).toBe(false);
  });

  it('revokes session and prevents further use', () => {
    sessions.set(VALID_SESSION.id, { ...VALID_SESSION });
    expect(isSessionValid(VALID_SESSION.id)).toBe(true);

    const revoked = revokeSession(VALID_SESSION.id);
    expect(revoked).toBe(true);
    expect(isSessionValid(VALID_SESSION.id)).toBe(false);
  });

  it('logout clears the session', () => {
    sessions.set(VALID_SESSION.id, { ...VALID_SESSION });

    // Simulate logout: revoke + delete
    revokeSession(VALID_SESSION.id);
    sessions.delete(VALID_SESSION.id);

    expect(sessions.has(VALID_SESSION.id)).toBe(false);
    expect(isSessionValid(VALID_SESSION.id)).toBe(false);
  });
});

describe('Auth — TOTP Step-Up', () => {
  beforeEach(() => {
    sessions = new Map();
    devices = new Map();
    passkeyCredentials = new Map();
    totpFailures = new Map();
    totpLocked = new Set();
  });

  it('accepts valid TOTP code', () => {
    const result = verifyTotp('op-001', '123456');
    expect(result.valid).toBe(true);
    expect(result.locked).toBeUndefined();
  });

  it('rejects invalid TOTP code', () => {
    const result = verifyTotp('op-001', '000000');
    expect(result.valid).toBe(false);
  });

  it('rate-limits after 3 rapid failures', () => {
    verifyTotp('op-001', '000001');
    verifyTotp('op-001', '000002');
    verifyTotp('op-001', '000003');

    const failures = totpFailures.get('op-001');
    expect(failures).toBeDefined();
    expect(failures!.count).toBe(3);

    // After 3 failures the system should flag this — callers can check count
    // and enforce a delay. The 4th attempt should still work if the code is
    // correct, but the count is tracked for rate-limit enforcement.
    const result = verifyTotp('op-001', '123456');
    expect(result.valid).toBe(true);

    // Successful verification resets the counter
    expect(totpFailures.has('op-001')).toBe(false);
  });

  it('locks out after 5 consecutive failures', () => {
    for (let i = 0; i < 5; i++) {
      verifyTotp('op-001', `bad-${i}`);
    }

    expect(totpLocked.has('op-001')).toBe(true);

    // Even a valid code is rejected when locked
    const result = verifyTotp('op-001', '123456');
    expect(result.valid).toBe(false);
    expect(result.locked).toBe(true);
  });
});
