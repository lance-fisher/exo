// =============================================================================
// Sovereign Operator Console — Device Trust Tests
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Device, DeviceEnrollment, AuditEntry } from '../../broker/src/types/index.js';

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

let deviceRegistry: Map<string, Device>;
let auditLog: AuditEntry[];
const MAX_ENROLLED_DEVICES = 2;

// ---------------------------------------------------------------------------
// Stub services
// ---------------------------------------------------------------------------

function enrollDevice(enrollment: DeviceEnrollment): { device: Device | null; error?: string } {
  const enrolledCount = Array.from(deviceRegistry.values()).filter(
    (d) => d.operator_id === enrollment.operator_id && d.status === 'enrolled',
  ).length;

  if (enrolledCount >= MAX_ENROLLED_DEVICES) {
    return { device: null, error: 'max_devices_reached' };
  }

  const device: Device = {
    id: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    operator_id: enrollment.operator_id,
    name: enrollment.name,
    type: enrollment.type,
    status: 'enrolled',
    enrolled_at: new Date(),
    revoked_at: null,
    fingerprint: enrollment.fingerprint,
    platform_info: enrollment.platform_info,
    passkey_credential_id: null,
    mtls_cert_fingerprint: null,
    last_seen: null,
    risk_flags: [],
  };

  deviceRegistry.set(device.id, device);

  auditLog.push({
    id: auditLog.length + 1,
    event_type: 'device.enroll',
    operator_id: enrollment.operator_id,
    device_id: device.id,
    session_id: null,
    action: 'enroll',
    resource: device.name,
    detail: { fingerprint: enrollment.fingerprint, type: enrollment.type },
    ip_address: '198.51.100.42',
    timestamp: new Date(),
    prev_hash: auditLog.length > 0 ? auditLog[auditLog.length - 1].entry_hash : '0'.repeat(64),
    entry_hash: `sha256:${Math.random().toString(36).slice(2)}`,
  });

  return { device };
}

function verifyDevice(deviceId: string): { trusted: boolean; reason?: string } {
  const device = deviceRegistry.get(deviceId);
  if (!device) return { trusted: false, reason: 'not_found' };
  if (device.status === 'revoked') return { trusted: false, reason: 'revoked' };
  if (device.status !== 'enrolled') return { trusted: false, reason: 'not_enrolled' };
  return { trusted: true };
}

function revokeDevice(deviceId: string): boolean {
  const device = deviceRegistry.get(deviceId);
  if (!device) return false;
  device.status = 'revoked';
  device.revoked_at = new Date();
  deviceRegistry.set(deviceId, device);

  auditLog.push({
    id: auditLog.length + 1,
    event_type: 'device.revoke',
    operator_id: device.operator_id,
    device_id: deviceId,
    session_id: null,
    action: 'revoke',
    resource: device.name,
    detail: { reason: 'operator_initiated' },
    ip_address: '198.51.100.42',
    timestamp: new Date(),
    prev_hash: auditLog.length > 0 ? auditLog[auditLog.length - 1].entry_hash : '0'.repeat(64),
    entry_hash: `sha256:${Math.random().toString(36).slice(2)}`,
  });

  return true;
}

function issueDeviceChallenge(deviceId: string): { challenge: string; expiresAt: Date } | null {
  const device = deviceRegistry.get(deviceId);
  if (!device || device.status !== 'enrolled') return null;
  return {
    challenge: `challenge-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    expiresAt: new Date(Date.now() + 60_000),
  };
}

function respondToChallenge(
  deviceId: string,
  challenge: string,
  signature: string,
): boolean {
  const device = deviceRegistry.get(deviceId);
  if (!device || device.status !== 'enrolled') return false;
  // In production this would verify the cryptographic signature
  return signature.startsWith('valid-sig-');
}

function replaceDevice(
  operatorId: string,
  oldDeviceId: string,
  newEnrollment: DeviceEnrollment,
): { device: Device | null; error?: string } {
  const oldDevice = deviceRegistry.get(oldDeviceId);
  if (!oldDevice || oldDevice.operator_id !== operatorId) {
    return { device: null, error: 'device_not_found' };
  }

  revokeDevice(oldDeviceId);
  return enrollDevice(newEnrollment);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Device Trust — Enrollment', () => {
  beforeEach(() => {
    deviceRegistry = new Map();
    auditLog = [];
  });

  it('creates registry entry on enrollment', () => {
    const { device } = enrollDevice({
      operator_id: 'op-001',
      name: 'Work Laptop',
      type: 'laptop',
      fingerprint: 'sha256:aabbccdd',
      platform_info: { os: 'Windows 11' },
    });

    expect(device).not.toBeNull();
    expect(device!.status).toBe('enrolled');
    expect(device!.fingerprint).toBe('sha256:aabbccdd');
    expect(deviceRegistry.size).toBe(1);
  });

  it('enrolled device passes verification', () => {
    const { device } = enrollDevice({
      operator_id: 'op-001',
      name: 'Work Laptop',
      type: 'laptop',
      fingerprint: 'sha256:aabbccdd',
      platform_info: {},
    });

    const result = verifyDevice(device!.id);
    expect(result.trusted).toBe(true);
  });

  it('non-enrolled device is rejected', () => {
    const result = verifyDevice('dev-nonexistent');
    expect(result.trusted).toBe(false);
    expect(result.reason).toBe('not_found');
  });

  it('revoked device is rejected', () => {
    const { device } = enrollDevice({
      operator_id: 'op-001',
      name: 'Old Phone',
      type: 'iphone',
      fingerprint: 'sha256:112233',
      platform_info: {},
    });

    revokeDevice(device!.id);
    const result = verifyDevice(device!.id);

    expect(result.trusted).toBe(false);
    expect(result.reason).toBe('revoked');
  });

  it('enforces max 2 enrolled devices by default', () => {
    enrollDevice({
      operator_id: 'op-001',
      name: 'Device 1',
      type: 'laptop',
      fingerprint: 'fp-1',
      platform_info: {},
    });
    enrollDevice({
      operator_id: 'op-001',
      name: 'Device 2',
      type: 'iphone',
      fingerprint: 'fp-2',
      platform_info: {},
    });

    const { device, error } = enrollDevice({
      operator_id: 'op-001',
      name: 'Device 3',
      type: 'laptop',
      fingerprint: 'fp-3',
      platform_info: {},
    });

    expect(device).toBeNull();
    expect(error).toBe('max_devices_reached');
  });
});

describe('Device Trust — Challenge-Response', () => {
  beforeEach(() => {
    deviceRegistry = new Map();
    auditLog = [];
  });

  it('issues challenge for enrolled device', () => {
    const { device } = enrollDevice({
      operator_id: 'op-001',
      name: 'Laptop',
      type: 'laptop',
      fingerprint: 'fp-1',
      platform_info: {},
    });

    const challenge = issueDeviceChallenge(device!.id);
    expect(challenge).not.toBeNull();
    expect(challenge!.challenge).toBeDefined();
    expect(challenge!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects challenge for non-enrolled device', () => {
    const challenge = issueDeviceChallenge('dev-nonexistent');
    expect(challenge).toBeNull();
  });

  it('verifies valid challenge response', () => {
    const { device } = enrollDevice({
      operator_id: 'op-001',
      name: 'Laptop',
      type: 'laptop',
      fingerprint: 'fp-1',
      platform_info: {},
    });

    const result = respondToChallenge(device!.id, 'challenge-123', 'valid-sig-abc');
    expect(result).toBe(true);
  });

  it('rejects invalid challenge response', () => {
    const { device } = enrollDevice({
      operator_id: 'op-001',
      name: 'Laptop',
      type: 'laptop',
      fingerprint: 'fp-1',
      platform_info: {},
    });

    const result = respondToChallenge(device!.id, 'challenge-123', 'bad-signature');
    expect(result).toBe(false);
  });
});

describe('Device Trust — Replacement Workflow', () => {
  beforeEach(() => {
    deviceRegistry = new Map();
    auditLog = [];
  });

  it('replaces old device and enrolls new one', () => {
    const { device: oldDevice } = enrollDevice({
      operator_id: 'op-001',
      name: 'Old Laptop',
      type: 'laptop',
      fingerprint: 'fp-old',
      platform_info: {},
    });
    enrollDevice({
      operator_id: 'op-001',
      name: 'Phone',
      type: 'iphone',
      fingerprint: 'fp-phone',
      platform_info: {},
    });

    // At max capacity — replacement should still work
    const { device: newDevice, error } = replaceDevice('op-001', oldDevice!.id, {
      operator_id: 'op-001',
      name: 'New Laptop',
      type: 'laptop',
      fingerprint: 'fp-new',
      platform_info: {},
    });

    expect(error).toBeUndefined();
    expect(newDevice).not.toBeNull();
    expect(newDevice!.name).toBe('New Laptop');

    // Old device should be revoked
    const oldResult = verifyDevice(oldDevice!.id);
    expect(oldResult.trusted).toBe(false);
    expect(oldResult.reason).toBe('revoked');
  });
});

describe('Device Trust — Audit Logging', () => {
  beforeEach(() => {
    deviceRegistry = new Map();
    auditLog = [];
  });

  it('revocation logs audit entry', () => {
    const { device } = enrollDevice({
      operator_id: 'op-001',
      name: 'Laptop',
      type: 'laptop',
      fingerprint: 'fp-1',
      platform_info: {},
    });

    const beforeCount = auditLog.length;
    revokeDevice(device!.id);

    expect(auditLog.length).toBe(beforeCount + 1);

    const lastEntry = auditLog[auditLog.length - 1];
    expect(lastEntry.event_type).toBe('device.revoke');
    expect(lastEntry.device_id).toBe(device!.id);
    expect(lastEntry.action).toBe('revoke');
  });
});
