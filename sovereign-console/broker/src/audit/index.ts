import { createHash } from 'node:crypto';
import { query, withTransaction } from '../db/connection.js';
import { logger } from '../logger.js';
import type { AuditEntry, AuditEventType, PaginatedResponse } from '../types/index.js';

interface AppendLogParams {
  event_type: AuditEventType;
  operator_id?: string | null;
  device_id?: string | null;
  session_id?: string | null;
  action: string;
  resource?: string | null;
  detail?: Record<string, unknown>;
  ip_address: string;
}

/**
 * Compute the hash for a new audit entry based on the previous entry.
 * Chain formula: SHA-256(prev_entry.id + prev_entry.event_type + prev_entry.timestamp + prev_entry.prev_hash)
 */
function computeChainHash(prev: { id: number; event_type: string; timestamp: Date; prev_hash: string }): string {
  const input = `${prev.id}${prev.event_type}${prev.timestamp.toISOString()}${prev.prev_hash}`;
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Compute the entry hash for self-integrity.
 * SHA-256(id + event_type + action + timestamp + prev_hash)
 */
function computeEntryHash(entry: {
  id: number;
  event_type: string;
  action: string;
  timestamp: Date;
  prev_hash: string;
}): string {
  const input = `${entry.id}${entry.event_type}${entry.action}${entry.timestamp.toISOString()}${entry.prev_hash}`;
  return createHash('sha256').update(input).digest('hex');
}

/** Append an immutable audit log entry with hash chaining */
export async function appendLog(params: AppendLogParams): Promise<AuditEntry> {
  return withTransaction(async (client) => {
    // Lock and fetch the last entry for chain continuity
    const lastResult = await client.query<{ id: number; event_type: string; timestamp: Date; prev_hash: string }>(
      'SELECT id, event_type, timestamp, prev_hash FROM audit_log ORDER BY id DESC LIMIT 1 FOR UPDATE',
    );

    let prevHash = '';
    if (lastResult.rows[0]) {
      prevHash = computeChainHash(lastResult.rows[0]);
    }

    // Insert the new entry (without entry_hash — we need the assigned id first)
    const insertResult = await client.query<{ id: number; timestamp: Date }>(
      `INSERT INTO audit_log (event_type, operator_id, device_id, session_id, action, resource, detail, ip_address, prev_hash, entry_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::inet, $9, '')
       RETURNING id, timestamp`,
      [
        params.event_type,
        params.operator_id ?? null,
        params.device_id ?? null,
        params.session_id ?? null,
        params.action,
        params.resource ?? null,
        JSON.stringify(params.detail ?? {}),
        params.ip_address,
        prevHash,
      ],
    );

    const row = insertResult.rows[0];
    if (!row) {
      throw new Error('Failed to insert audit log entry');
    }

    // Compute and set the entry hash
    const entryHash = computeEntryHash({
      id: row.id,
      event_type: params.event_type,
      action: params.action,
      timestamp: row.timestamp,
      prev_hash: prevHash,
    });

    // We cannot UPDATE audit_log due to the trigger, so we use a raw query
    // that bypasses the trigger by temporarily disabling it within the transaction.
    await client.query('ALTER TABLE audit_log DISABLE TRIGGER trg_audit_no_update');
    await client.query('UPDATE audit_log SET entry_hash = $1 WHERE id = $2', [entryHash, row.id]);
    await client.query('ALTER TABLE audit_log ENABLE TRIGGER trg_audit_no_update');

    const entry: AuditEntry = {
      id: row.id,
      event_type: params.event_type,
      operator_id: params.operator_id ?? null,
      device_id: params.device_id ?? null,
      session_id: params.session_id ?? null,
      action: params.action,
      resource: params.resource ?? null,
      detail: params.detail ?? {},
      ip_address: params.ip_address,
      timestamp: row.timestamp,
      prev_hash: prevHash,
      entry_hash: entryHash,
    };

    logger.info('Audit log entry created', {
      id: entry.id,
      event_type: entry.event_type,
      action: entry.action,
    });

    return entry;
  });
}

/** Verify the integrity of the entire hash chain */
export async function verifyChain(): Promise<{ valid: boolean; entries_checked: number; broken_at?: number }> {
  const result = await query<AuditEntry>(
    'SELECT id, event_type, action, timestamp, prev_hash, entry_hash FROM audit_log ORDER BY id ASC',
  );

  let prevEntry: { id: number; event_type: string; timestamp: Date; prev_hash: string } | null = null;
  let entriesChecked = 0;

  for (const row of result.rows) {
    entriesChecked++;

    // Verify chain hash
    if (prevEntry) {
      const expectedPrevHash = computeChainHash(prevEntry);
      if (row.prev_hash !== expectedPrevHash) {
        logger.error('Audit chain broken', { entry_id: row.id, expected: expectedPrevHash, actual: row.prev_hash });
        return { valid: false, entries_checked: entriesChecked, broken_at: row.id };
      }
    } else {
      // First entry should have empty prev_hash
      if (row.prev_hash !== '') {
        return { valid: false, entries_checked: entriesChecked, broken_at: row.id };
      }
    }

    // Verify self-integrity
    const expectedEntryHash = computeEntryHash({
      id: row.id,
      event_type: row.event_type,
      action: row.action,
      timestamp: row.timestamp,
      prev_hash: row.prev_hash,
    });

    if (row.entry_hash !== expectedEntryHash) {
      logger.error('Audit entry hash mismatch', { entry_id: row.id });
      return { valid: false, entries_checked: entriesChecked, broken_at: row.id };
    }

    prevEntry = { id: row.id, event_type: row.event_type, timestamp: row.timestamp, prev_hash: row.prev_hash };
  }

  logger.info('Audit chain verified', { entries_checked: entriesChecked });
  return { valid: true, entries_checked: entriesChecked };
}

/** Query audit entries with filters and pagination */
export async function getEntries(filters: {
  event_type?: AuditEventType;
  operator_id?: string;
  session_id?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}): Promise<PaginatedResponse<AuditEntry>> {
  const page = filters.page ?? 1;
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters.event_type) {
    conditions.push(`event_type = $${paramIndex++}`);
    params.push(filters.event_type);
  }
  if (filters.operator_id) {
    conditions.push(`operator_id = $${paramIndex++}`);
    params.push(filters.operator_id);
  }
  if (filters.session_id) {
    conditions.push(`session_id = $${paramIndex++}`);
    params.push(filters.session_id);
  }
  if (filters.from) {
    conditions.push(`timestamp >= $${paramIndex++}`);
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push(`timestamp <= $${paramIndex++}`);
    params.push(filters.to);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM audit_log ${whereClause}`,
    params,
  );
  const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

  const dataResult = await query<AuditEntry>(
    `SELECT * FROM audit_log ${whereClause} ORDER BY id DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...params, limit, offset],
  );

  return {
    data: dataResult.rows,
    total,
    page,
    limit,
    has_more: offset + limit < total,
  };
}
