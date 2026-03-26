import { randomBytes } from 'node:crypto';
import { query } from '../db/connection.js';
import { logger } from '../logger.js';
import type { ApprovalToken, CreateApprovalTokenParams } from '../types/index.js';

/** Create an approval token per the formal spec */
export async function createApprovalToken(params: CreateApprovalTokenParams): Promise<ApprovalToken> {
  const nonce = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + params.ttl_seconds * 1000);

  const result = await query<ApprovalToken>(
    `INSERT INTO approval_tokens (action_type, resource_path, operation, device_id, session_id, expires_at, nonce, payload_hash, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
     RETURNING *`,
    [
      params.action_type,
      params.resource_path,
      params.operation,
      params.device_id,
      params.session_id,
      expiresAt,
      nonce,
      params.payload_hash,
    ],
  );

  const token = result.rows[0];
  if (!token) {
    throw new Error('Failed to create approval token');
  }

  logger.info('Approval token created', {
    token_id: token.id,
    action_type: params.action_type,
    resource_path: params.resource_path,
    operation: params.operation,
  });

  return token;
}

/** Validate an approval token — checks status, TTL, device binding, single-use */
export async function validateApprovalToken(
  tokenId: string,
  deviceId: string,
): Promise<{ valid: boolean; token: ApprovalToken | null; reason?: string }> {
  const result = await query<ApprovalToken>(
    'SELECT * FROM approval_tokens WHERE id = $1',
    [tokenId],
  );

  const token = result.rows[0];
  if (!token) {
    return { valid: false, token: null, reason: 'Token not found' };
  }

  // Check if already used
  if (token.status === 'used') {
    return { valid: false, token, reason: 'Token already used' };
  }

  // Check if rejected
  if (token.status === 'rejected') {
    return { valid: false, token, reason: 'Token was rejected' };
  }

  // Check if revoked
  if (token.status === 'revoked') {
    return { valid: false, token, reason: 'Token was revoked' };
  }

  // Check if expired by status
  if (token.status === 'expired') {
    return { valid: false, token, reason: 'Token expired' };
  }

  // Check TTL
  if (new Date(token.expires_at) < new Date()) {
    // Mark as expired
    await query(
      `UPDATE approval_tokens SET status = 'expired' WHERE id = $1`,
      [tokenId],
    );
    return { valid: false, token, reason: 'Token expired' };
  }

  // Must be approved status to be valid for consumption
  if (token.status !== 'approved') {
    return { valid: false, token, reason: `Token status is '${token.status}', expected 'approved'` };
  }

  // Verify device binding — the consuming device must be the one that requested it
  if (token.device_id !== deviceId) {
    logger.warn('Approval token device mismatch', {
      token_id: tokenId,
      expected_device: token.device_id,
      actual_device: deviceId,
    });
    return { valid: false, token, reason: 'Device mismatch' };
  }

  return { valid: true, token };
}

/** Consume an approval token — mark as used (single-use).
 *  If payloadHash is provided, it is verified against the token's stored hash
 *  to prevent replay with a different payload. */
export async function consumeApprovalToken(tokenId: string, payloadHash?: string, deviceId?: string): Promise<void> {
  // Fetch the token to validate payload hash and device binding before consuming
  const tokenResult = await query<ApprovalToken>(
    'SELECT * FROM approval_tokens WHERE id = $1 AND status = \'approved\'',
    [tokenId],
  );

  const token = tokenResult.rows[0];
  if (!token) {
    throw new Error('Failed to consume approval token — not in approved state');
  }

  // Verify payload hash matches the original request to prevent token replay with different payloads
  if (payloadHash && token.payload_hash && token.payload_hash !== payloadHash) {
    logger.warn('Approval token payload hash mismatch', {
      token_id: tokenId,
      expected_hash: token.payload_hash,
      actual_hash: payloadHash,
    });
    throw new Error('Approval token payload hash does not match — possible replay attempt');
  }

  // Verify device binding at consume time
  if (deviceId && token.device_id !== deviceId) {
    logger.warn('Approval token device mismatch at consume time', {
      token_id: tokenId,
      expected_device: token.device_id,
      actual_device: deviceId,
    });
    throw new Error('Approval token device mismatch — token was not issued to this device');
  }

  const result = await query(
    `UPDATE approval_tokens SET status = 'used', used_at = NOW()
     WHERE id = $1 AND status = 'approved'`,
    [tokenId],
  );

  if (result.rowCount === 0) {
    throw new Error('Failed to consume approval token — concurrent consumption detected');
  }

  logger.info('Approval token consumed', { token_id: tokenId });
}

/** Approve a pending token from a different device (e.g., iPhone) */
export async function approveToken(
  tokenId: string,
  approvingDeviceId: string,
): Promise<ApprovalToken> {
  // Ensure the approving device is different from the requesting device
  const check = await query<ApprovalToken>(
    'SELECT * FROM approval_tokens WHERE id = $1 AND status = \'pending\'',
    [tokenId],
  );

  const pending = check.rows[0];
  if (!pending) {
    throw new Error('Token not found or not in pending state');
  }

  if (pending.device_id === approvingDeviceId) {
    throw new Error('Cannot approve from the same device that requested the action');
  }

  // Check TTL
  if (new Date(pending.expires_at) < new Date()) {
    await query(`UPDATE approval_tokens SET status = 'expired' WHERE id = $1`, [tokenId]);
    throw new Error('Token has expired');
  }

  const result = await query<ApprovalToken>(
    `UPDATE approval_tokens SET status = 'approved', approved_by_device_id = $2, approved_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [tokenId, approvingDeviceId],
  );

  const token = result.rows[0];
  if (!token) {
    throw new Error('Failed to approve token');
  }

  logger.info('Approval token approved', {
    token_id: tokenId,
    approved_by_device: approvingDeviceId,
  });

  return token;
}

/** Reject a pending token */
export async function rejectToken(
  tokenId: string,
  rejectingDeviceId: string,
): Promise<void> {
  const result = await query(
    `UPDATE approval_tokens SET status = 'rejected', approved_by_device_id = $2, approved_at = NOW()
     WHERE id = $1 AND status = 'pending'`,
    [tokenId, rejectingDeviceId],
  );

  if (result.rowCount === 0) {
    throw new Error('Token not found or not in pending state');
  }

  logger.info('Approval token rejected', { token_id: tokenId, rejected_by_device: rejectingDeviceId });
}

/** Background job: expire stale tokens past their TTL */
export async function expireStaleTokens(): Promise<number> {
  const result = await query(
    `UPDATE approval_tokens SET status = 'expired'
     WHERE status = 'pending' AND expires_at < NOW()`,
  );

  const count = result.rowCount ?? 0;
  if (count > 0) {
    logger.info('Expired stale approval tokens', { count });
  }

  return count;
}

/** Revoke an approval token */
export async function revokeApprovalToken(tokenId: string): Promise<void> {
  const result = await query(
    `UPDATE approval_tokens SET status = 'revoked', revoked_at = NOW()
     WHERE id = $1 AND status IN ('pending', 'approved')`,
    [tokenId],
  );

  if (result.rowCount === 0) {
    throw new Error('Token not found or not in a revocable state');
  }

  logger.info('Approval token revoked', { token_id: tokenId });
}

/** List pending approval tokens for a session */
export async function listPendingTokens(sessionId: string): Promise<ApprovalToken[]> {
  const result = await query<ApprovalToken>(
    `SELECT * FROM approval_tokens
     WHERE session_id = $1 AND status = 'pending' AND expires_at > NOW()
     ORDER BY issued_at DESC`,
    [sessionId],
  );
  return result.rows;
}

/** Get a specific approval token */
export async function getApprovalToken(tokenId: string): Promise<ApprovalToken | null> {
  const result = await query<ApprovalToken>(
    'SELECT * FROM approval_tokens WHERE id = $1',
    [tokenId],
  );
  return result.rows[0] ?? null;
}
