import {
  generateRegistrationOptions as _generateRegOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions as _generateAuthOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { getConfig } from '../config.js';
import { query } from '../db/connection.js';
import { getRedis } from '../redis.js';
import { logger } from '../logger.js';
import type { PasskeyCredential } from '../types/index.js';

const CHALLENGE_TTL_SECONDS = 300; // 5 minutes

function rpConfig() {
  const config = getConfig();
  return {
    rpID: config.WEBAUTHN_RP_ID,
    rpName: config.WEBAUTHN_RP_NAME,
    origin: config.WEBAUTHN_ORIGIN,
  };
}

/** Generate registration options for a new passkey on a device */
export async function generateRegistrationOptions(
  operatorId: string,
  deviceId: string,
): Promise<{ options: Awaited<ReturnType<typeof _generateRegOptions>>; challenge: string }> {
  const rp = rpConfig();

  // Get existing credentials to exclude
  const existing = await query<{ credential_id: string; transports: string[] }>(
    `SELECT pc.credential_id, pc.transports
     FROM passkey_credentials pc
     JOIN devices d ON pc.device_id = d.id
     WHERE d.operator_id = $1 AND pc.revoked_at IS NULL`,
    [operatorId],
  );

  const excludeCredentials = existing.rows.map((row) => ({
    id: row.credential_id,
    transports: row.transports as AuthenticatorTransportFuture[],
  }));

  // Look up operator username
  const opResult = await query<{ username: string }>(
    'SELECT username FROM operators WHERE id = $1',
    [operatorId],
  );
  const username = opResult.rows[0]?.username ?? 'operator';

  const options = await _generateRegOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: username,
    userDisplayName: username,
    attestationType: 'direct',
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'required',
      userVerification: 'required',
    },
    excludeCredentials,
  });

  // Store challenge in Redis
  const redis = getRedis();
  const challengeKey = `webauthn:reg:${operatorId}:${deviceId}`;
  await redis.setex(challengeKey, CHALLENGE_TTL_SECONDS, options.challenge);

  logger.info('WebAuthn registration options generated', { operator_id: operatorId, device_id: deviceId });

  return { options, challenge: options.challenge };
}

/** Verify registration response, store credential, return credential record */
export async function verifyRegistration(
  operatorId: string,
  deviceId: string,
  response: RegistrationResponseJSON,
): Promise<PasskeyCredential> {
  const rp = rpConfig();
  const redis = getRedis();

  // Retrieve expected challenge
  const challengeKey = `webauthn:reg:${operatorId}:${deviceId}`;
  const expectedChallenge = await redis.get(challengeKey);
  if (!expectedChallenge) {
    throw new Error('Registration challenge expired or not found');
  }
  await redis.del(challengeKey);

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: true,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('WebAuthn registration verification failed');
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  // Determine platform binding and sync status
  const platformBound = credentialDeviceType === 'singleDevice';
  const syncedStatus: 'synced' | 'device_bound' | 'unknown' =
    credentialBackedUp ? 'synced' : platformBound ? 'device_bound' : 'unknown';

  const attestationFormat = verification.registrationInfo.fmt ?? 'none';

  // Store credential
  const result = await query<PasskeyCredential>(
    `INSERT INTO passkey_credentials (device_id, credential_id, public_key, counter, transports, attestation_format, platform_bound, synced_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      deviceId,
      credential.id,
      Buffer.from(credential.publicKey).toString('base64url'),
      credential.counter,
      credential.transports ?? [],
      attestationFormat,
      platformBound,
      syncedStatus,
    ],
  );

  const cred = result.rows[0];
  if (!cred) {
    throw new Error('Failed to store passkey credential');
  }

  // Link credential to device
  await query(
    'UPDATE devices SET passkey_credential_id = $1 WHERE id = $2',
    [cred.credential_id, deviceId],
  );

  logger.info('WebAuthn credential registered', {
    operator_id: operatorId,
    device_id: deviceId,
    credential_id: cred.credential_id,
    platform_bound: platformBound,
    synced_status: syncedStatus,
  });

  return cred;
}

/** Generate authentication options for an operator */
export async function generateAuthenticationOptions(
  operatorId: string,
): Promise<{ options: Awaited<ReturnType<typeof _generateAuthOptions>>; challenge: string }> {
  const rp = rpConfig();

  // Get allowed credentials for this operator
  const creds = await query<{ credential_id: string; transports: string[] }>(
    `SELECT pc.credential_id, pc.transports
     FROM passkey_credentials pc
     JOIN devices d ON pc.device_id = d.id
     WHERE d.operator_id = $1 AND pc.revoked_at IS NULL AND d.status = 'enrolled'`,
    [operatorId],
  );

  const allowCredentials = creds.rows.map((row) => ({
    id: row.credential_id,
    transports: row.transports as AuthenticatorTransportFuture[],
  }));

  const options = await _generateAuthOptions({
    rpID: rp.rpID,
    userVerification: 'required',
    allowCredentials,
  });

  // Store challenge
  const redis = getRedis();
  const challengeKey = `webauthn:auth:${operatorId}`;
  await redis.setex(challengeKey, CHALLENGE_TTL_SECONDS, options.challenge);

  return { options, challenge: options.challenge };
}

/** Verify authentication response */
export async function verifyAuthentication(
  operatorId: string,
  response: AuthenticationResponseJSON,
): Promise<{ verified: boolean; deviceId: string; credentialId: string }> {
  const rp = rpConfig();
  const redis = getRedis();

  // Retrieve expected challenge
  const challengeKey = `webauthn:auth:${operatorId}`;
  const expectedChallenge = await redis.get(challengeKey);
  if (!expectedChallenge) {
    throw new Error('Authentication challenge expired or not found');
  }
  await redis.del(challengeKey);

  // Look up credential
  const credResult = await query<PasskeyCredential & { device_operator_id: string }>(
    `SELECT pc.*, d.operator_id AS device_operator_id
     FROM passkey_credentials pc
     JOIN devices d ON pc.device_id = d.id
     WHERE pc.credential_id = $1 AND pc.revoked_at IS NULL AND d.status = 'enrolled'`,
    [response.id],
  );

  const credential = credResult.rows[0];
  if (!credential) {
    throw new Error('Credential not found or revoked');
  }

  if (credential.device_operator_id !== operatorId) {
    throw new Error('Credential does not belong to this operator');
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: true,
    credential: {
      id: credential.credential_id,
      publicKey: Buffer.from(credential.public_key, 'base64url'),
      counter: credential.counter,
      transports: credential.transports as AuthenticatorTransportFuture[],
    },
  });

  if (!verification.verified) {
    throw new Error('WebAuthn authentication verification failed');
  }

  // Update counter
  await query(
    'UPDATE passkey_credentials SET counter = $1 WHERE id = $2',
    [verification.authenticationInfo.newCounter, credential.id],
  );

  // Update device last_seen
  await query(
    'UPDATE devices SET last_seen = NOW() WHERE id = $1',
    [credential.device_id],
  );

  logger.info('WebAuthn authentication verified', {
    operator_id: operatorId,
    device_id: credential.device_id,
    credential_id: credential.credential_id,
  });

  return {
    verified: true,
    deviceId: credential.device_id,
    credentialId: credential.credential_id,
  };
}

/** Revoke a passkey credential */
export async function revokeCredential(credentialId: string): Promise<void> {
  await query(
    'UPDATE passkey_credentials SET revoked_at = NOW() WHERE credential_id = $1 AND revoked_at IS NULL',
    [credentialId],
  );
  logger.info('Passkey credential revoked', { credential_id: credentialId });
}
