// =============================================================================
// Sovereign Operator Console — Approval Token Tests
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  ApprovalToken,
  ApprovalTokenStatus,
  CreateApprovalTokenParams,
  AuditEntry,
} from '../../broker/src/types/index.js';

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

let tokenStore: Map<string, ApprovalToken>;
let auditLog: AuditEntry[];

// ---------------------------------------------------------------------------
// Stub services
// ---------------------------------------------------------------------------

function createApprovalToken(params: CreateApprovalTokenParams): ApprovalToken {
  const token: ApprovalToken = {
    id: `tok-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    action_type: params.action_type,
    resource_path: params.resource_path,
    operation: params.operation,
    device_id: params.device_id,
    session_id: params.session_id,
    issued_at: new Date(),
    expires_at: new Date(Date.now() + params.ttl_seconds * 1000),
    nonce: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
    payload_hash: params.payload_hash,
    status: 'approved',
    approved_by_device_id: params.device_id,
    approved_at: new Date(),
    used_at: null,
    revoked_at: null,
  };

  tokenStore.set(token.id, token);
  appendAudit('approval.approve', token);
  return token;
}

function validateToken(
  tokenId: string,
  deviceId: string,
  sessionId: string,
  payloadHash: string,
): { valid: boolean; reason?: string } {
  const token = tokenStore.get(tokenId);
  if (!token) return { valid: false, reason: 'not_found' };
  if (token.status === 'used') return { valid: false, reason: 'already_used' };
  if (token.status === 'expired') return { valid: false, reason: 'expired' };
  if (token.status === 'revoked') return { valid: false, reason: 'revoked' };
  if (token.expires_at < new Date()) {
    token.status = 'expired';
    return { valid: false, reason: 'expired' };
  }
  if (token.device_id !== deviceId) return { valid: false, reason: 'wrong_device' };
  if (token.session_id !== sessionId) return { valid: false, reason: 'wrong_session' };
  if (token.payload_hash !== payloadHash) return { valid: false, reason: 'payload_hash_mismatch' };
  return { valid: true };
}

function consumeToken(tokenId: string): boolean {
  const token = tokenStore.get(tokenId);
  if (!token || token.status !== 'approved') return false;
  token.status = 'used';
  token.used_at = new Date();
  appendAudit('approval.use', token);
  return true;
}

function revokeToken(tokenId: string): boolean {
  const token = tokenStore.get(tokenId);
  if (!token || token.status === 'used' || token.status === 'expired') return false;
  token.status = 'revoked';
  token.revoked_at = new Date();
  appendAudit('approval.expire', token);
  return true;
}

function expireStaleTokens(): number {
  let count = 0;
  for (const [, token] of tokenStore) {
    if (token.status === 'approved' && token.expires_at < new Date()) {
      token.status = 'expired';
      appendAudit('approval.expire', token);
      count++;
    }
  }
  return count;
}

function appendAudit(eventType: string, token: ApprovalToken): void {
  auditLog.push({
    id: auditLog.length + 1,
    event_type: eventType as any,
    operator_id: null,
    device_id: token.device_id,
    session_id: token.session_id,
    action: eventType.split('.')[1],
    resource: token.resource_path,
    detail: { token_id: token.id, action_type: token.action_type },
    ip_address: '198.51.100.42',
    timestamp: new Date(),
    prev_hash: auditLog.length > 0 ? auditLog[auditLog.length - 1].entry_hash : '0'.repeat(64),
    entry_hash: `sha256:${Math.random().toString(36).slice(2)}`,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Approval Token — Creation', () => {
  beforeEach(() => {
    tokenStore = new Map();
    auditLog = [];
  });

  it('creates token with all required fields', () => {
    const token = createApprovalToken({
      action_type: 'file_write',
      resource_path: '/projects/myapp/src/index.ts',
      operation: 'write',
      device_id: 'dev-001',
      session_id: 'sess-001',
      payload_hash: 'sha256:abc123',
      ttl_seconds: 120,
    });

    expect(token.id).toBeDefined();
    expect(token.action_type).toBe('file_write');
    expect(token.resource_path).toBe('/projects/myapp/src/index.ts');
    expect(token.device_id).toBe('dev-001');
    expect(token.session_id).toBe('sess-001');
    expect(token.nonce).toBeDefined();
    expect(token.nonce.length).toBeGreaterThanOrEqual(16);
    expect(token.payload_hash).toBe('sha256:abc123');
    expect(token.status).toBe('approved');
    expect(token.expires_at.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('Approval Token — Validation', () => {
  beforeEach(() => {
    tokenStore = new Map();
    auditLog = [];
  });

  it('validates a valid token', () => {
    const token = createApprovalToken({
      action_type: 'file_write',
      resource_path: '/projects/myapp/src/index.ts',
      operation: 'write',
      device_id: 'dev-001',
      session_id: 'sess-001',
      payload_hash: 'sha256:abc123',
      ttl_seconds: 120,
    });

    const result = validateToken(token.id, 'dev-001', 'sess-001', 'sha256:abc123');
    expect(result.valid).toBe(true);
  });

  it('rejects token with expired TTL', () => {
    const token = createApprovalToken({
      action_type: 'file_write',
      resource_path: '/projects/myapp/src/index.ts',
      operation: 'write',
      device_id: 'dev-001',
      session_id: 'sess-001',
      payload_hash: 'sha256:abc123',
      ttl_seconds: 0, // immediately expired
    });

    // Force expiration
    token.expires_at = new Date(Date.now() - 1000);
    tokenStore.set(token.id, token);

    const result = validateToken(token.id, 'dev-001', 'sess-001', 'sha256:abc123');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('enforces single-use — second use rejected', () => {
    const token = createApprovalToken({
      action_type: 'file_write',
      resource_path: '/projects/myapp/src/index.ts',
      operation: 'write',
      device_id: 'dev-001',
      session_id: 'sess-001',
      payload_hash: 'sha256:abc123',
      ttl_seconds: 120,
    });

    // First use
    const consumed = consumeToken(token.id);
    expect(consumed).toBe(true);

    // Second validation attempt
    const result = validateToken(token.id, 'dev-001', 'sess-001', 'sha256:abc123');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('already_used');
  });

  it('rejects token for wrong device_id', () => {
    const token = createApprovalToken({
      action_type: 'file_write',
      resource_path: '/projects/myapp/src/index.ts',
      operation: 'write',
      device_id: 'dev-001',
      session_id: 'sess-001',
      payload_hash: 'sha256:abc123',
      ttl_seconds: 120,
    });

    const result = validateToken(token.id, 'dev-ATTACKER', 'sess-001', 'sha256:abc123');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('wrong_device');
  });

  it('rejects token for wrong session_id', () => {
    const token = createApprovalToken({
      action_type: 'file_write',
      resource_path: '/projects/myapp/src/index.ts',
      operation: 'write',
      device_id: 'dev-001',
      session_id: 'sess-001',
      payload_hash: 'sha256:abc123',
      ttl_seconds: 120,
    });

    const result = validateToken(token.id, 'dev-001', 'sess-HIJACKED', 'sha256:abc123');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('wrong_session');
  });

  it('rejects token for wrong payload_hash', () => {
    const token = createApprovalToken({
      action_type: 'file_write',
      resource_path: '/projects/myapp/src/index.ts',
      operation: 'write',
      device_id: 'dev-001',
      session_id: 'sess-001',
      payload_hash: 'sha256:abc123',
      ttl_seconds: 120,
    });

    const result = validateToken(token.id, 'dev-001', 'sess-001', 'sha256:TAMPERED');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('payload_hash_mismatch');
  });
});

describe('Approval Token — Lifecycle', () => {
  beforeEach(() => {
    tokenStore = new Map();
    auditLog = [];
  });

  it('background job expires stale tokens', () => {
    const token = createApprovalToken({
      action_type: 'file_write',
      resource_path: '/projects/myapp/src/index.ts',
      operation: 'write',
      device_id: 'dev-001',
      session_id: 'sess-001',
      payload_hash: 'sha256:abc123',
      ttl_seconds: 120,
    });

    // Force the token to be past its TTL
    token.expires_at = new Date(Date.now() - 5000);
    tokenStore.set(token.id, token);

    const expired = expireStaleTokens();
    expect(expired).toBe(1);
    expect(tokenStore.get(token.id)!.status).toBe('expired');
  });

  it('revokes a pending token', () => {
    const token = createApprovalToken({
      action_type: 'dangerous',
      resource_path: '/projects/myapp/deploy.sh',
      operation: 'shell_exec',
      device_id: 'dev-001',
      session_id: 'sess-001',
      payload_hash: 'sha256:deploy-hash',
      ttl_seconds: 60,
    });

    const revoked = revokeToken(token.id);
    expect(revoked).toBe(true);
    expect(tokenStore.get(token.id)!.status).toBe('revoked');

    // Revoked token cannot be validated
    const result = validateToken(token.id, 'dev-001', 'sess-001', 'sha256:deploy-hash');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('revoked');
  });

  it('logs all lifecycle events to audit log', () => {
    const token = createApprovalToken({
      action_type: 'file_write',
      resource_path: '/projects/myapp/src/index.ts',
      operation: 'write',
      device_id: 'dev-001',
      session_id: 'sess-001',
      payload_hash: 'sha256:abc123',
      ttl_seconds: 120,
    });

    consumeToken(token.id);

    const tokenEvents = auditLog.filter(
      (e) => e.detail && (e.detail as any).token_id === token.id,
    );

    // Should have: approve + use
    expect(tokenEvents.length).toBe(2);
    expect(tokenEvents[0].event_type).toBe('approval.approve');
    expect(tokenEvents[1].event_type).toBe('approval.use');
  });
});
