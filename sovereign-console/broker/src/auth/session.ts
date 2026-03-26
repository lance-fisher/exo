import { randomBytes, createHash } from 'node:crypto';
import { query } from '../db/connection.js';
import { getRedis } from '../redis.js';
import { logger } from '../logger.js';
import type { Session } from '../types/index.js';

const SESSION_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_EXTEND_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_GRACE_PERIOD_MS = 5 * 60 * 1000; // can extend if within 5 min of expiry

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Create a short-lived session bound to an operator and device */
export async function createSession(
  operatorId: string,
  deviceId: string,
  ip: string,
  userAgent: string,
): Promise<{ session: Session; token: string }> {
  const token = randomBytes(48).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  const result = await query<Session>(
    `INSERT INTO sessions (operator_id, device_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5::inet, $6)
     RETURNING *`,
    [operatorId, deviceId, tokenHash, expiresAt, ip, userAgent],
  );

  const session = result.rows[0];
  if (!session) {
    throw new Error('Failed to create session');
  }

  // Cache session in Redis for fast lookup
  const redis = getRedis();
  await redis.setex(
    `session:${tokenHash}`,
    Math.ceil(SESSION_DURATION_MS / 1000),
    JSON.stringify(session),
  );

  logger.info('Session created', { session_id: session.id, operator_id: operatorId, device_id: deviceId });

  return { session, token };
}

/** Validate a session token — checks expiry, revocation, and device enrollment */
export async function validateSession(token: string): Promise<Session | null> {
  const tokenHash = hashToken(token);

  // Try Redis cache first
  const redis = getRedis();
  const cached = await redis.get(`session:${tokenHash}`);
  if (cached) {
    const session: Session = JSON.parse(cached);
    if (new Date(session.expires_at) < new Date()) {
      await redis.del(`session:${tokenHash}`);
      return null;
    }
    if (session.revoked_at) {
      await redis.del(`session:${tokenHash}`);
      return null;
    }
    return session;
  }

  // Fall back to database
  const result = await query<Session>(
    `SELECT s.* FROM sessions s
     JOIN devices d ON s.device_id = d.id
     WHERE s.token_hash = $1
       AND s.expires_at > NOW()
       AND s.revoked_at IS NULL
       AND d.status = 'enrolled'`,
    [tokenHash],
  );

  const session = result.rows[0] ?? null;

  if (session) {
    // Re-cache
    const ttl = Math.max(1, Math.ceil((new Date(session.expires_at).getTime() - Date.now()) / 1000));
    await redis.setex(`session:${tokenHash}`, ttl, JSON.stringify(session));
  }

  return session;
}

/** Revoke a specific session */
export async function revokeSession(sessionId: string): Promise<void> {
  const result = await query<Session>(
    `UPDATE sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL RETURNING token_hash`,
    [sessionId],
  );

  const row = result.rows[0];
  if (row) {
    const redis = getRedis();
    await redis.del(`session:${row.token_hash}`);
    logger.info('Session revoked', { session_id: sessionId });
  }
}

/** Revoke all sessions for an operator */
export async function revokeAllSessions(operatorId: string): Promise<number> {
  const result = await query<Session>(
    `UPDATE sessions SET revoked_at = NOW()
     WHERE operator_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
     RETURNING token_hash`,
    [operatorId],
  );

  const redis = getRedis();
  const pipeline = redis.pipeline();
  for (const row of result.rows) {
    pipeline.del(`session:${row.token_hash}`);
  }
  await pipeline.exec();

  const count = result.rowCount ?? 0;
  logger.info('All sessions revoked', { operator_id: operatorId, count });
  return count;
}

/** Extend a session by 15 minutes if within the grace period */
export async function extendSession(sessionId: string): Promise<Session | null> {
  const result = await query<Session>(
    `SELECT * FROM sessions WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId],
  );

  const session = result.rows[0];
  if (!session) return null;

  const now = Date.now();
  const expiresAt = new Date(session.expires_at).getTime();
  const timeRemaining = expiresAt - now;

  // Only allow extension if within grace period (last 5 minutes of session)
  if (timeRemaining > SESSION_GRACE_PERIOD_MS) {
    logger.debug('Session extension denied — not within grace period', { session_id: sessionId });
    return session;
  }

  if (timeRemaining <= 0) {
    logger.debug('Session extension denied — already expired', { session_id: sessionId });
    return null;
  }

  const newExpiry = new Date(now + SESSION_EXTEND_MS);

  const updateResult = await query<Session>(
    `UPDATE sessions SET expires_at = $1 WHERE id = $2 AND revoked_at IS NULL RETURNING *`,
    [newExpiry, sessionId],
  );

  const updated = updateResult.rows[0];
  if (updated) {
    // Update Redis cache
    const redis = getRedis();
    const ttl = Math.ceil(SESSION_EXTEND_MS / 1000);
    await redis.setex(`session:${updated.token_hash}`, ttl, JSON.stringify(updated));
    logger.info('Session extended', { session_id: sessionId, new_expiry: newExpiry.toISOString() });
  }

  return updated ?? null;
}

/** Get session by ID */
export async function getSession(sessionId: string): Promise<Session | null> {
  const result = await query<Session>(
    `SELECT * FROM sessions WHERE id = $1`,
    [sessionId],
  );
  return result.rows[0] ?? null;
}
