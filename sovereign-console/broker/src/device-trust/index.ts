import { randomBytes } from 'node:crypto';
import { query } from '../db/connection.js';
import { getRedis } from '../redis.js';
import { logger } from '../logger.js';
import type { Device, DeviceEnrollment } from '../types/index.js';

const CHALLENGE_TTL_SECONDS = 300; // 5 minutes

/** Initiate device enrollment — creates a pending device entry and returns a challenge */
export async function enrollDevice(
  operatorId: string,
  deviceInfo: DeviceEnrollment,
): Promise<{ device: Device; challenge: string }> {
  // Check for duplicate fingerprint
  const existing = await query<Device>(
    'SELECT * FROM devices WHERE fingerprint = $1',
    [deviceInfo.fingerprint],
  );
  if (existing.rows[0]) {
    throw new Error('A device with this fingerprint is already registered');
  }

  const result = await query<Device>(
    `INSERT INTO devices (operator_id, name, type, status, fingerprint, platform_info)
     VALUES ($1, $2, $3, 'pending', $4, $5)
     RETURNING *`,
    [
      operatorId,
      deviceInfo.name,
      deviceInfo.type,
      deviceInfo.fingerprint,
      JSON.stringify(deviceInfo.platform_info),
    ],
  );

  const device = result.rows[0];
  if (!device) {
    throw new Error('Failed to create device entry');
  }

  // Generate enrollment challenge
  const challenge = randomBytes(32).toString('base64url');
  const redis = getRedis();
  await redis.setex(`device:enroll:${device.id}`, CHALLENGE_TTL_SECONDS, challenge);

  logger.info('Device enrollment initiated', {
    device_id: device.id,
    operator_id: operatorId,
    type: deviceInfo.type,
  });

  return { device, challenge };
}

/** Complete device enrollment by verifying the challenge response */
export async function verifyDevice(
  deviceId: string,
  challengeResponse: string,
): Promise<Device> {
  const redis = getRedis();
  const expectedChallenge = await redis.get(`device:enroll:${deviceId}`);

  if (!expectedChallenge) {
    throw new Error('Enrollment challenge expired or not found');
  }

  if (challengeResponse !== expectedChallenge) {
    throw new Error('Invalid enrollment challenge response');
  }

  await redis.del(`device:enroll:${deviceId}`);

  const result = await query<Device>(
    `UPDATE devices SET status = 'enrolled', enrolled_at = NOW(), last_seen = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [deviceId],
  );

  const device = result.rows[0];
  if (!device) {
    throw new Error('Device not found or not in pending state');
  }

  logger.info('Device enrollment completed', { device_id: deviceId });

  return device;
}

/** Get device status by ID */
export async function getDeviceStatus(deviceId: string): Promise<Device | null> {
  const result = await query<Device>(
    'SELECT * FROM devices WHERE id = $1',
    [deviceId],
  );
  return result.rows[0] ?? null;
}

/** Revoke a device — marks it as revoked and invalidates sessions */
export async function revokeDevice(deviceId: string): Promise<void> {
  const result = await query<Device>(
    `UPDATE devices SET status = 'revoked', revoked_at = NOW()
     WHERE id = $1 AND status != 'revoked'
     RETURNING *`,
    [deviceId],
  );

  if (!result.rows[0]) {
    throw new Error('Device not found or already revoked');
  }

  // Revoke all active sessions for this device
  await query(
    `UPDATE sessions SET revoked_at = NOW()
     WHERE device_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
    [deviceId],
  );

  // Revoke passkey credentials
  await query(
    'UPDATE passkey_credentials SET revoked_at = NOW() WHERE device_id = $1 AND revoked_at IS NULL',
    [deviceId],
  );

  logger.info('Device revoked', { device_id: deviceId });
}

/** List all devices for an operator */
export async function listDevices(operatorId: string): Promise<Device[]> {
  const result = await query<Device>(
    'SELECT * FROM devices WHERE operator_id = $1 ORDER BY enrolled_at DESC',
    [operatorId],
  );
  return result.rows;
}

/** Check if a device is enrolled and not revoked */
export async function isDeviceEnrolled(deviceId: string): Promise<boolean> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM devices WHERE id = $1 AND status = 'enrolled'`,
    [deviceId],
  );
  return parseInt(result.rows[0]?.count ?? '0', 10) > 0;
}

/** Generate a nonce challenge for an already-enrolled device (re-verification) */
export async function challengeDevice(
  deviceId: string,
): Promise<{ challenge: string; expires_in: number }> {
  // Verify device is enrolled
  const enrolled = await isDeviceEnrolled(deviceId);
  if (!enrolled) {
    throw new Error('Device is not enrolled');
  }

  const challenge = randomBytes(32).toString('base64url');
  const redis = getRedis();
  await redis.setex(`device:challenge:${deviceId}`, CHALLENGE_TTL_SECONDS, challenge);

  logger.info('Device challenge issued', { device_id: deviceId });

  return { challenge, expires_in: CHALLENGE_TTL_SECONDS };
}

/** Verify a device challenge response */
export async function verifyChallengeResponse(
  deviceId: string,
  challengeResponse: string,
): Promise<boolean> {
  const redis = getRedis();
  const expected = await redis.get(`device:challenge:${deviceId}`);

  if (!expected) {
    return false;
  }

  if (challengeResponse !== expected) {
    return false;
  }

  await redis.del(`device:challenge:${deviceId}`);

  // Update last_seen
  await query('UPDATE devices SET last_seen = NOW() WHERE id = $1', [deviceId]);

  return true;
}
