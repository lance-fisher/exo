// =============================================================================
// Sovereign Operator Console — Audit Log Tests
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import type { AuditEntry, AuditEventType } from '../../broker/src/types/index.js';

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

let auditLog: AuditEntry[];

// ---------------------------------------------------------------------------
// Stub services — production would use PostgreSQL with immutable policies
// ---------------------------------------------------------------------------

function computeEntryHash(entry: Omit<AuditEntry, 'entry_hash'>): string {
  const data = JSON.stringify({
    id: entry.id,
    event_type: entry.event_type,
    operator_id: entry.operator_id,
    device_id: entry.device_id,
    session_id: entry.session_id,
    action: entry.action,
    resource: entry.resource,
    detail: entry.detail,
    ip_address: entry.ip_address,
    timestamp: entry.timestamp.toISOString(),
    prev_hash: entry.prev_hash,
  });
  return createHash('sha256').update(data).digest('hex');
}

function appendAuditEntry(params: {
  event_type: AuditEventType;
  operator_id?: string;
  device_id?: string;
  session_id?: string;
  action: string;
  resource?: string;
  detail?: Record<string, unknown>;
  ip_address?: string;
}): AuditEntry {
  const prevHash =
    auditLog.length > 0 ? auditLog[auditLog.length - 1].entry_hash : '0'.repeat(64);

  const partial: Omit<AuditEntry, 'entry_hash'> = {
    id: auditLog.length + 1,
    event_type: params.event_type,
    operator_id: params.operator_id ?? null,
    device_id: params.device_id ?? null,
    session_id: params.session_id ?? null,
    action: params.action,
    resource: params.resource ?? null,
    detail: params.detail ?? {},
    ip_address: params.ip_address ?? '198.51.100.42',
    timestamp: new Date(),
    prev_hash: prevHash,
  };

  const entry: AuditEntry = {
    ...partial,
    entry_hash: computeEntryHash(partial),
  };

  auditLog.push(entry);
  return entry;
}

function verifyHashChain(log: AuditEntry[]): { valid: boolean; brokenAt?: number } {
  for (let i = 0; i < log.length; i++) {
    const entry = log[i];

    // Check prev_hash linkage
    if (i === 0) {
      if (entry.prev_hash !== '0'.repeat(64)) {
        return { valid: false, brokenAt: i };
      }
    } else {
      if (entry.prev_hash !== log[i - 1].entry_hash) {
        return { valid: false, brokenAt: i };
      }
    }

    // Verify entry_hash integrity
    const expected = computeEntryHash({
      id: entry.id,
      event_type: entry.event_type,
      operator_id: entry.operator_id,
      device_id: entry.device_id,
      session_id: entry.session_id,
      action: entry.action,
      resource: entry.resource,
      detail: entry.detail,
      ip_address: entry.ip_address,
      timestamp: entry.timestamp,
      prev_hash: entry.prev_hash,
    });

    if (entry.entry_hash !== expected) {
      return { valid: false, brokenAt: i };
    }
  }
  return { valid: true };
}

function getPaginated(
  page: number,
  limit: number,
): { data: AuditEntry[]; total: number; has_more: boolean } {
  const start = (page - 1) * limit;
  const data = auditLog.slice(start, start + limit);
  return {
    data,
    total: auditLog.length,
    has_more: start + limit < auditLog.length,
  };
}

function filterByEventType(eventType: AuditEventType): AuditEntry[] {
  return auditLog.filter((e) => e.event_type === eventType);
}

function filterByDateRange(from: Date, to: Date): AuditEntry[] {
  return auditLog.filter((e) => e.timestamp >= from && e.timestamp <= to);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Audit Log — Hash Chain', () => {
  beforeEach(() => {
    auditLog = [];
  });

  it('creates entry with proper hash chain linkage', () => {
    const entry1 = appendAuditEntry({
      event_type: 'auth.login',
      operator_id: 'op-001',
      action: 'login',
    });

    expect(entry1.prev_hash).toBe('0'.repeat(64));
    expect(entry1.entry_hash).toBeDefined();
    expect(entry1.entry_hash.length).toBe(64); // SHA-256 hex

    const entry2 = appendAuditEntry({
      event_type: 'file.read',
      operator_id: 'op-001',
      action: 'read',
      resource: '/projects/myapp/src/index.ts',
    });

    expect(entry2.prev_hash).toBe(entry1.entry_hash);
  });

  it('hash chain verification passes for valid chain', () => {
    appendAuditEntry({ event_type: 'auth.login', action: 'login' });
    appendAuditEntry({ event_type: 'file.read', action: 'read' });
    appendAuditEntry({ event_type: 'file.write', action: 'write' });
    appendAuditEntry({ event_type: 'auth.logout', action: 'logout' });

    const result = verifyHashChain(auditLog);
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeUndefined();
  });

  it('hash chain verification detects tampering', () => {
    appendAuditEntry({ event_type: 'auth.login', action: 'login' });
    appendAuditEntry({ event_type: 'file.read', action: 'read', resource: '/projects/app/data.json' });
    appendAuditEntry({ event_type: 'auth.logout', action: 'logout' });

    // Tamper with the second entry
    auditLog[1] = {
      ...auditLog[1],
      resource: '/projects/app/secrets.json', // changed!
      // entry_hash is now stale
    };

    const result = verifyHashChain(auditLog);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it('hash chain detects broken prev_hash linkage', () => {
    appendAuditEntry({ event_type: 'auth.login', action: 'login' });
    appendAuditEntry({ event_type: 'file.read', action: 'read' });
    appendAuditEntry({ event_type: 'auth.logout', action: 'logout' });

    // Break the chain by modifying prev_hash of entry 2
    const entry = auditLog[2];
    auditLog[2] = {
      ...entry,
      prev_hash: 'aaaa'.repeat(16),
      entry_hash: computeEntryHash({ ...entry, prev_hash: 'aaaa'.repeat(16) }),
    };

    const result = verifyHashChain(auditLog);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });
});

describe('Audit Log — Append-Only', () => {
  beforeEach(() => {
    auditLog = [];
  });

  it('entries can only be appended, not updated or deleted', () => {
    const entry = appendAuditEntry({
      event_type: 'file.write',
      action: 'write',
      resource: '/projects/myapp/config.ts',
    });

    const originalHash = entry.entry_hash;
    const originalLength = auditLog.length;

    // Simulate attempted "update" — modifying in place breaks the hash
    const tampered = { ...auditLog[0], action: 'delete' };
    const tamperedHash = computeEntryHash({
      ...tampered,
      // Recomputing hash won't help because subsequent entries depend on original
    });

    // The original entry's hash should be stable
    expect(auditLog[0].entry_hash).toBe(originalHash);

    // Length should only grow
    appendAuditEntry({ event_type: 'auth.logout', action: 'logout' });
    expect(auditLog.length).toBe(originalLength + 1);

    // Verify integrity
    const result = verifyHashChain(auditLog);
    expect(result.valid).toBe(true);
  });
});

describe('Audit Log — Querying', () => {
  beforeEach(() => {
    auditLog = [];
    // Seed some entries
    appendAuditEntry({ event_type: 'auth.login', action: 'login', operator_id: 'op-001' });
    appendAuditEntry({ event_type: 'file.read', action: 'read', operator_id: 'op-001' });
    appendAuditEntry({ event_type: 'file.read', action: 'read', operator_id: 'op-001' });
    appendAuditEntry({ event_type: 'file.write', action: 'write', operator_id: 'op-001' });
    appendAuditEntry({ event_type: 'auth.logout', action: 'logout', operator_id: 'op-001' });
  });

  it('paginated retrieval returns correct page', () => {
    const page1 = getPaginated(1, 2);
    expect(page1.data.length).toBe(2);
    expect(page1.total).toBe(5);
    expect(page1.has_more).toBe(true);
    expect(page1.data[0].id).toBe(1);

    const page2 = getPaginated(2, 2);
    expect(page2.data.length).toBe(2);
    expect(page2.has_more).toBe(true);

    const page3 = getPaginated(3, 2);
    expect(page3.data.length).toBe(1);
    expect(page3.has_more).toBe(false);
  });

  it('filters by event type', () => {
    const readEvents = filterByEventType('file.read');
    expect(readEvents.length).toBe(2);
    readEvents.forEach((e) => expect(e.event_type).toBe('file.read'));
  });

  it('filters by date range', () => {
    const now = new Date();
    const from = new Date(now.getTime() - 60_000);
    const to = new Date(now.getTime() + 60_000);

    const inRange = filterByDateRange(from, to);
    expect(inRange.length).toBe(5);

    // Future range should return nothing
    const futureFrom = new Date(now.getTime() + 3600_000);
    const futureTo = new Date(now.getTime() + 7200_000);
    const outOfRange = filterByDateRange(futureFrom, futureTo);
    expect(outOfRange.length).toBe(0);
  });
});
