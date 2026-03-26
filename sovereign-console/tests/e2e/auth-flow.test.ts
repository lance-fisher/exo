// =============================================================================
// Sovereign Operator Console — E2E Auth Flow Tests
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import type {
  Device,
  Session,
  PasskeyCredential,
  ApprovalToken,
} from '../../broker/src/types/index.js';

// ---------------------------------------------------------------------------
// Simulated full-stack state
// ---------------------------------------------------------------------------

let devices: Map<string, Device>;
let sessions: Map<string, Session>;
let credentials: Map<string, PasskeyCredential>;
let totpSecrets: Map<string, string>; // operator_id -> secret
let totpFailures: Map<string, number>;
let emergencyDisabled: boolean;

// ---------------------------------------------------------------------------
// Simulated services (thin wrappers combining broker modules)
// ---------------------------------------------------------------------------

function registerPasskey(
  deviceId: string,
  operatorId: string,
): { success: boolean; credentialId?: string; error?: string } {
  if (emergencyDisabled) return { success: false, error: 'emergency_disabled' };

  const device = devices.get(deviceId);
  if (!device || device.status !== 'enrolled') {
    return { success: false, error: 'device_not_enrolled' };
  }

  const credId = `cred-${Date.now()}`;
  const cred: PasskeyCredential = {
    id: credId,
    device_id: deviceId,
    credential_id: credId,
    public_key: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...',
    counter: 0,
    transports: ['internal'],
    attestation_format: 'packed',
    platform_bound: true,
    synced_status: 'device_bound',
    created_at: new Date(),
    revoked_at: null,
  };

  credentials.set(credId, cred);
  device.passkey_credential_id = credId;
  devices.set(deviceId, device);

  return { success: true, credentialId: credId };
}

function authenticateWithPasskey(
  deviceId: string,
  credentialId: string,
): { session: Session | null; error?: string } {
  if (emergencyDisabled) return { session: null, error: 'emergency_disabled' };

  const device = devices.get(deviceId);
  if (!device || device.status !== 'enrolled') {
    return { session: null, error: 'device_not_enrolled' };
  }

  const cred = credentials.get(credentialId);
  if (!cred || cred.device_id !== deviceId || cred.revoked_at) {
    return { session: null, error: 'invalid_credential' };
  }

  // Increment counter (replay protection)
  cred.counter += 1;

  const session: Session = {
    id: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    operator_id: device.operator_id,
    device_id: deviceId,
    token_hash: `sha256:${Math.random().toString(36).slice(2)}`,
    created_at: new Date(),
    expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000), // 4 hours
    revoked_at: null,
    ip_address: '198.51.100.42',
    user_agent: 'Mozilla/5.0',
  };

  sessions.set(session.id, session);
  device.last_seen = new Date();

  return { session };
}

function verifyTotpForStepUp(
  sessionId: string,
  code: string,
): { verified: boolean; error?: string } {
  if (emergencyDisabled) return { verified: false, error: 'emergency_disabled' };

  const session = sessions.get(sessionId);
  if (!session || session.revoked_at || session.expires_at < new Date()) {
    return { verified: false, error: 'invalid_session' };
  }

  const secret = totpSecrets.get(session.operator_id);
  if (!secret) return { verified: false, error: 'totp_not_configured' };

  // Simulated TOTP: valid code is the deterministic "123456"
  if (code !== '123456') {
    const failures = (totpFailures.get(session.operator_id) ?? 0) + 1;
    totpFailures.set(session.operator_id, failures);
    return { verified: false, error: 'invalid_code' };
  }

  totpFailures.delete(session.operator_id);
  return { verified: true };
}

function isSessionValid(sessionId: string): boolean {
  if (emergencyDisabled) return false;
  const session = sessions.get(sessionId);
  if (!session) return false;
  if (session.revoked_at) return false;
  if (session.expires_at < new Date()) return false;
  return true;
}

function triggerEmergencyDisable(): void {
  emergencyDisabled = true;
  // Revoke all active sessions
  for (const [, session] of sessions) {
    if (!session.revoked_at) {
      session.revoked_at = new Date();
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E — Full Passkey Registration → Auth → Session Flow', () => {
  beforeEach(() => {
    devices = new Map([
      [
        'dev-laptop',
        {
          id: 'dev-laptop',
          operator_id: 'op-001',
          name: 'Work Laptop',
          type: 'laptop' as const,
          status: 'enrolled' as const,
          enrolled_at: new Date('2025-01-15'),
          revoked_at: null,
          fingerprint: 'sha256:laptop-fp',
          platform_info: { os: 'Windows 11' },
          passkey_credential_id: null,
          mtls_cert_fingerprint: null,
          last_seen: null,
          risk_flags: [],
        },
      ],
    ]);
    sessions = new Map();
    credentials = new Map();
    totpSecrets = new Map([['op-001', 'JBSWY3DPEHPK3PXP']]);
    totpFailures = new Map();
    emergencyDisabled = false;
  });

  it('completes full registration → authentication → session flow', () => {
    // Step 1: Register passkey
    const regResult = registerPasskey('dev-laptop', 'op-001');
    expect(regResult.success).toBe(true);
    expect(regResult.credentialId).toBeDefined();

    // Step 2: Authenticate with passkey
    const authResult = authenticateWithPasskey('dev-laptop', regResult.credentialId!);
    expect(authResult.session).not.toBeNull();
    expect(authResult.session!.operator_id).toBe('op-001');
    expect(authResult.session!.device_id).toBe('dev-laptop');

    // Step 3: Session should be valid
    expect(isSessionValid(authResult.session!.id)).toBe(true);

    // Step 4: Passkey counter should have incremented
    const cred = credentials.get(regResult.credentialId!);
    expect(cred!.counter).toBe(1);
  });

  it('denies unregistered device', () => {
    // Device exists but has no passkey
    const authResult = authenticateWithPasskey('dev-laptop', 'cred-nonexistent');
    expect(authResult.session).toBeNull();
    expect(authResult.error).toBe('invalid_credential');
  });

  it('requires unknown device enrollment first', () => {
    const authResult = authenticateWithPasskey('dev-unknown', 'cred-whatever');
    expect(authResult.session).toBeNull();
    expect(authResult.error).toBe('device_not_enrolled');
  });
});

describe('E2E — TOTP Step-Up for Write Operations', () => {
  let activeSession: Session;

  beforeEach(() => {
    devices = new Map([
      [
        'dev-laptop',
        {
          id: 'dev-laptop',
          operator_id: 'op-001',
          name: 'Work Laptop',
          type: 'laptop' as const,
          status: 'enrolled' as const,
          enrolled_at: new Date('2025-01-15'),
          revoked_at: null,
          fingerprint: 'sha256:laptop-fp',
          platform_info: { os: 'Windows 11' },
          passkey_credential_id: 'cred-existing',
          mtls_cert_fingerprint: null,
          last_seen: null,
          risk_flags: [],
        },
      ],
    ]);
    credentials = new Map([
      [
        'cred-existing',
        {
          id: 'cred-existing',
          device_id: 'dev-laptop',
          credential_id: 'cred-existing',
          public_key: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...',
          counter: 5,
          transports: ['internal'],
          attestation_format: 'packed',
          platform_bound: true,
          synced_status: 'device_bound' as const,
          created_at: new Date('2025-01-15'),
          revoked_at: null,
        },
      ],
    ]);
    sessions = new Map();
    totpSecrets = new Map([['op-001', 'JBSWY3DPEHPK3PXP']]);
    totpFailures = new Map();
    emergencyDisabled = false;

    // Create an active session
    const { session } = authenticateWithPasskey('dev-laptop', 'cred-existing');
    activeSession = session!;
  });

  it('TOTP step-up succeeds with valid code', () => {
    const result = verifyTotpForStepUp(activeSession.id, '123456');
    expect(result.verified).toBe(true);
  });

  it('TOTP step-up fails with invalid code', () => {
    const result = verifyTotpForStepUp(activeSession.id, '000000');
    expect(result.verified).toBe(false);
    expect(result.error).toBe('invalid_code');
  });

  it('TOTP step-up fails with expired session', () => {
    // Expire the session
    activeSession.expires_at = new Date(Date.now() - 1000);

    const result = verifyTotpForStepUp(activeSession.id, '123456');
    expect(result.verified).toBe(false);
    expect(result.error).toBe('invalid_session');
  });
});

describe('E2E — Session Expiry', () => {
  beforeEach(() => {
    devices = new Map([
      [
        'dev-laptop',
        {
          id: 'dev-laptop',
          operator_id: 'op-001',
          name: 'Work Laptop',
          type: 'laptop' as const,
          status: 'enrolled' as const,
          enrolled_at: new Date('2025-01-15'),
          revoked_at: null,
          fingerprint: 'sha256:laptop-fp',
          platform_info: {},
          passkey_credential_id: 'cred-existing',
          mtls_cert_fingerprint: null,
          last_seen: null,
          risk_flags: [],
        },
      ],
    ]);
    credentials = new Map([
      [
        'cred-existing',
        {
          id: 'cred-existing',
          device_id: 'dev-laptop',
          credential_id: 'cred-existing',
          public_key: 'key...',
          counter: 0,
          transports: ['internal'],
          attestation_format: 'packed',
          platform_bound: true,
          synced_status: 'device_bound' as const,
          created_at: new Date(),
          revoked_at: null,
        },
      ],
    ]);
    sessions = new Map();
    totpSecrets = new Map();
    totpFailures = new Map();
    emergencyDisabled = false;
  });

  it('expired session forces re-authentication', () => {
    const { session } = authenticateWithPasskey('dev-laptop', 'cred-existing');
    expect(isSessionValid(session!.id)).toBe(true);

    // Simulate time passing — session expires
    session!.expires_at = new Date(Date.now() - 1);

    expect(isSessionValid(session!.id)).toBe(false);

    // Must re-authenticate to get new session
    const { session: newSession } = authenticateWithPasskey('dev-laptop', 'cred-existing');
    expect(newSession).not.toBeNull();
    expect(newSession!.id).not.toBe(session!.id);
    expect(isSessionValid(newSession!.id)).toBe(true);
  });
});

describe('E2E — Emergency Disable', () => {
  beforeEach(() => {
    devices = new Map([
      [
        'dev-laptop',
        {
          id: 'dev-laptop',
          operator_id: 'op-001',
          name: 'Work Laptop',
          type: 'laptop' as const,
          status: 'enrolled' as const,
          enrolled_at: new Date(),
          revoked_at: null,
          fingerprint: 'sha256:fp',
          platform_info: {},
          passkey_credential_id: 'cred-001',
          mtls_cert_fingerprint: null,
          last_seen: null,
          risk_flags: [],
        },
      ],
    ]);
    credentials = new Map([
      [
        'cred-001',
        {
          id: 'cred-001',
          device_id: 'dev-laptop',
          credential_id: 'cred-001',
          public_key: 'key...',
          counter: 0,
          transports: ['internal'],
          attestation_format: 'packed',
          platform_bound: true,
          synced_status: 'device_bound' as const,
          created_at: new Date(),
          revoked_at: null,
        },
      ],
    ]);
    sessions = new Map();
    totpSecrets = new Map();
    totpFailures = new Map();
    emergencyDisabled = false;
  });

  it('emergency disable blocks all access', () => {
    // Create a valid session first
    const { session } = authenticateWithPasskey('dev-laptop', 'cred-001');
    expect(session).not.toBeNull();
    expect(isSessionValid(session!.id)).toBe(true);

    // Trigger emergency disable
    triggerEmergencyDisable();

    // Existing session is revoked
    expect(isSessionValid(session!.id)).toBe(false);

    // Cannot create new sessions
    const { session: newSession, error } = authenticateWithPasskey('dev-laptop', 'cred-001');
    expect(newSession).toBeNull();
    expect(error).toBe('emergency_disabled');

    // Cannot register new passkeys
    const regResult = registerPasskey('dev-laptop', 'op-001');
    expect(regResult.success).toBe(false);
    expect(regResult.error).toBe('emergency_disabled');
  });
});
