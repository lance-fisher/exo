import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { authenticator } from 'otplib';
import { getConfig } from '../config.js';
import { query } from '../db/connection.js';
import { getRedis } from '../redis.js';
import { logger } from '../logger.js';

// Rate limiting constants
const TOTP_ATTEMPT_WINDOW_SECONDS = 90;
const TOTP_MAX_ATTEMPTS_PER_WINDOW = 3;
const TOTP_LOCKOUT_THRESHOLD = 5; // failures in lockout window
const TOTP_LOCKOUT_WINDOW_SECONDS = 300; // 5 minutes
const TOTP_LOCKOUT_DURATION_SECONDS = 900; // 15 minute lockout

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/** Derive the AES-256 key from the hex-encoded config value */
function getEncryptionKey(): Buffer {
  const config = getConfig();
  return Buffer.from(config.TOTP_ENCRYPTION_KEY, 'hex');
}

/** Generate a new TOTP secret */
export function generateSecret(): string {
  return authenticator.generateSecret();
}

/** Encrypt a TOTP secret for storage */
export function encryptSecret(secret: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(secret, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/** Decrypt a TOTP secret from storage */
export function decryptSecret(encrypted: string): string {
  const key = getEncryptionKey();
  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted secret format');
  }
  const [ivHex, authTagHex, ciphertext] = parts as [string, string, string];

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/** Check if operator is currently locked out */
async function isLockedOut(operatorId: string): Promise<boolean> {
  const redis = getRedis();
  const lockoutKey = `totp:lockout:${operatorId}`;
  const locked = await redis.get(lockoutKey);
  return locked !== null;
}

/** Record a failed TOTP attempt and check for lockout */
async function recordFailedAttempt(operatorId: string): Promise<void> {
  const redis = getRedis();
  const pipeline = redis.pipeline();

  // Per-window rate limit
  const windowKey = `totp:attempts:${operatorId}`;
  pipeline.incr(windowKey);
  pipeline.expire(windowKey, TOTP_ATTEMPT_WINDOW_SECONDS);

  // Lockout tracking
  const lockoutTrackKey = `totp:failures:${operatorId}`;
  pipeline.incr(lockoutTrackKey);
  pipeline.expire(lockoutTrackKey, TOTP_LOCKOUT_WINDOW_SECONDS);

  const results = await pipeline.exec();
  if (!results) return;

  // Check lockout threshold
  const failureCount = results[2]?.[1] as number | undefined;
  if (failureCount && failureCount >= TOTP_LOCKOUT_THRESHOLD) {
    const lockoutKey = `totp:lockout:${operatorId}`;
    await redis.setex(lockoutKey, TOTP_LOCKOUT_DURATION_SECONDS, '1');
    logger.warn('TOTP lockout triggered', { operator_id: operatorId, failures: failureCount });
  }
}

/** Clear rate limit state on success */
async function clearAttempts(operatorId: string): Promise<void> {
  const redis = getRedis();
  const pipeline = redis.pipeline();
  pipeline.del(`totp:attempts:${operatorId}`);
  pipeline.del(`totp:failures:${operatorId}`);
  await pipeline.exec();
}

/** Verify a TOTP code with rate limiting */
export async function verifyCode(operatorId: string, code: string): Promise<boolean> {
  // Check lockout
  if (await isLockedOut(operatorId)) {
    logger.warn('TOTP verification denied — operator locked out', { operator_id: operatorId });
    throw new Error('Too many failed attempts. Account temporarily locked.');
  }

  // Check per-window rate limit
  const redis = getRedis();
  const windowKey = `totp:attempts:${operatorId}`;
  const attempts = await redis.get(windowKey);
  if (attempts && parseInt(attempts, 10) >= TOTP_MAX_ATTEMPTS_PER_WINDOW) {
    throw new Error('Too many TOTP attempts. Please wait before trying again.');
  }

  // Fetch active TOTP secret
  const result = await query<{ encrypted_secret: string }>(
    'SELECT encrypted_secret FROM totp_secrets WHERE operator_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1',
    [operatorId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('No TOTP secret configured for this operator');
  }

  const secret = decryptSecret(row.encrypted_secret);

  // Verify with a 1-step window (allows 30s clock skew)
  const isValid = authenticator.check(code, secret);

  if (!isValid) {
    await recordFailedAttempt(operatorId);
    logger.info('TOTP verification failed', { operator_id: operatorId });
    return false;
  }

  // Check for replay — ensure code hasn't been used in this period
  const replayKey = `totp:used:${operatorId}:${code}`;
  const alreadyUsed = await redis.get(replayKey);
  if (alreadyUsed) {
    logger.warn('TOTP replay detected', { operator_id: operatorId });
    return false;
  }
  // Mark code as used for 90 seconds (covers the TOTP window)
  await redis.setex(replayKey, 90, '1');

  await clearAttempts(operatorId);
  logger.info('TOTP verification succeeded', { operator_id: operatorId });
  return true;
}

/** Provision a new TOTP secret for an operator */
export async function provisionTotp(
  operatorId: string,
): Promise<{ secret: string; otpauthUri: string }> {
  const config = getConfig();
  const secret = generateSecret();
  const encrypted = encryptSecret(secret);

  // Revoke any existing secrets
  await query(
    'UPDATE totp_secrets SET revoked_at = NOW() WHERE operator_id = $1 AND revoked_at IS NULL',
    [operatorId],
  );

  // Store new secret
  await query(
    'INSERT INTO totp_secrets (operator_id, encrypted_secret) VALUES ($1, $2)',
    [operatorId, encrypted],
  );

  // Look up username for URI
  const opResult = await query<{ username: string }>(
    'SELECT username FROM operators WHERE id = $1',
    [operatorId],
  );
  const username = opResult.rows[0]?.username ?? 'operator';

  const otpauthUri = authenticator.keyuri(username, config.WEBAUTHN_RP_NAME, secret);

  logger.info('TOTP provisioned', { operator_id: operatorId });

  return { secret, otpauthUri };
}

/** Revoke all TOTP secrets for an operator */
export async function revokeTotp(operatorId: string): Promise<void> {
  await query(
    'UPDATE totp_secrets SET revoked_at = NOW() WHERE operator_id = $1 AND revoked_at IS NULL',
    [operatorId],
  );
  logger.info('TOTP secrets revoked', { operator_id: operatorId });
}
