import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  generateRegistrationOptions,
  verifyRegistration,
  generateAuthenticationOptions,
  verifyAuthentication,
} from '../auth/webauthn.js';
import { verifyCode as verifyTotpCode } from '../auth/totp.js';
import { createSession, revokeSession, getSession, extendSession } from '../auth/session.js';
import { requireAuth } from '../middleware/auth.js';
import { appendLog } from '../audit/index.js';
import { getRedis } from '../redis.js';
import { logger } from '../logger.js';

const SESSION_COOKIE_NAME = 'sovereign_session';
const SESSION_COOKIE_MAX_AGE = 30 * 60; // 30 minutes in seconds

const registerOptionsSchema = z.object({
  operator_id: z.string().uuid(),
  device_id: z.string().uuid(),
});

const registerVerifySchema = z.object({
  operator_id: z.string().uuid(),
  device_id: z.string().uuid(),
  response: z.record(z.unknown()),
});

const loginOptionsSchema = z.object({
  operator_id: z.string().uuid(),
});

const loginVerifySchema = z.object({
  operator_id: z.string().uuid(),
  response: z.record(z.unknown()),
});

const totpVerifySchema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // --- Passkey Registration ---

  app.post('/api/auth/passkey/register/options', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const body = registerOptionsSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() });
    }

    const { operator_id, device_id } = body.data;
    const auth = request.authContext!;

    // Only the authenticated operator can register their own passkeys
    if (auth.operator_id !== operator_id) {
      return reply.code(403).send({ error: 'Cannot register passkey for another operator' });
    }

    try {
      const { options } = await generateRegistrationOptions(operator_id, device_id);
      return reply.send({ options });
    } catch (err) {
      logger.error('Failed to generate registration options', { error: (err as Error).message });
      return reply.code(500).send({ error: 'Failed to generate registration options' });
    }
  });

  app.post('/api/auth/passkey/register/verify', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const body = registerVerifySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() });
    }

    const { operator_id, device_id, response } = body.data;
    const auth = request.authContext!;

    if (auth.operator_id !== operator_id) {
      return reply.code(403).send({ error: 'Cannot register passkey for another operator' });
    }

    try {
      const credential = await verifyRegistration(operator_id, device_id, response as never);

      await appendLog({
        event_type: 'auth.passkey_register',
        operator_id,
        device_id,
        session_id: auth.session_id,
        action: 'Passkey registered',
        resource: credential.credential_id,
        detail: {
          platform_bound: credential.platform_bound,
          synced_status: credential.synced_status,
          attestation_format: credential.attestation_format,
        },
        ip_address: request.ip,
      });

      return reply.send({ credential_id: credential.credential_id, success: true });
    } catch (err) {
      logger.error('Passkey registration failed', { error: (err as Error).message });
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // --- Passkey Authentication ---

  app.post('/api/auth/passkey/login/options', async (request, reply) => {
    const body = loginOptionsSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() });
    }

    try {
      const { options } = await generateAuthenticationOptions(body.data.operator_id);
      return reply.send({ options });
    } catch (err) {
      logger.error('Failed to generate auth options', { error: (err as Error).message });
      return reply.code(500).send({ error: 'Failed to generate authentication options' });
    }
  });

  app.post('/api/auth/passkey/login/verify', async (request, reply) => {
    const body = loginVerifySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() });
    }

    const { operator_id, response } = body.data;

    try {
      const result = await verifyAuthentication(operator_id, response as never);

      if (!result.verified) {
        return reply.code(401).send({ error: 'Authentication failed' });
      }

      // Create session
      const { session, token } = await createSession(
        operator_id,
        result.deviceId,
        request.ip,
        request.headers['user-agent'] ?? '',
      );

      // Mark passkey as verified in Redis
      const redis = getRedis();
      await redis.setex(`session:passkey:${session.id}`, SESSION_COOKIE_MAX_AGE, '1');

      // Set secure session cookie
      reply.setCookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: SESSION_COOKIE_MAX_AGE,
      });

      await appendLog({
        event_type: 'auth.login',
        operator_id,
        device_id: result.deviceId,
        session_id: session.id,
        action: 'Passkey login',
        detail: { credential_id: result.credentialId },
        ip_address: request.ip,
      });

      return reply.send({
        session_id: session.id,
        expires_at: session.expires_at,
        device_id: result.deviceId,
        passkey_verified: true,
        totp_verified: false,
      });
    } catch (err) {
      logger.error('Passkey authentication failed', { error: (err as Error).message });
      return reply.code(401).send({ error: (err as Error).message });
    }
  });

  // --- TOTP Step-Up ---

  app.post('/api/auth/totp/verify', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const body = totpVerifySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid TOTP code format' });
    }

    const auth = request.authContext!;

    try {
      const valid = await verifyTotpCode(auth.operator_id, body.data.code);

      if (!valid) {
        return reply.code(401).send({ error: 'Invalid TOTP code' });
      }

      // Mark TOTP as verified for this session
      const redis = getRedis();
      const ttl = Math.ceil((auth.session_expires_at.getTime() - Date.now()) / 1000);
      await redis.setex(`session:totp:${auth.session_id}`, Math.max(ttl, 1), '1');

      await appendLog({
        event_type: 'auth.totp_verify',
        operator_id: auth.operator_id,
        device_id: auth.device_id,
        session_id: auth.session_id,
        action: 'TOTP verified',
        ip_address: request.ip,
      });

      return reply.send({ verified: true });
    } catch (err) {
      logger.error('TOTP verification error', { error: (err as Error).message });
      return reply.code(429).send({ error: (err as Error).message });
    }
  });

  // --- Logout ---

  app.post('/api/auth/logout', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const auth = request.authContext!;

    await revokeSession(auth.session_id);

    reply.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
    });

    await appendLog({
      event_type: 'auth.logout',
      operator_id: auth.operator_id,
      device_id: auth.device_id,
      session_id: auth.session_id,
      action: 'Logout',
      ip_address: request.ip,
    });

    return reply.send({ success: true });
  });

  // --- Session Info ---

  app.get('/api/auth/session', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const auth = request.authContext!;
    const session = await getSession(auth.session_id);

    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    // Attempt to extend session if within grace period
    await extendSession(auth.session_id);

    return reply.send({
      session_id: session.id,
      operator_id: session.operator_id,
      device_id: session.device_id,
      created_at: session.created_at,
      expires_at: session.expires_at,
      passkey_verified: auth.passkey_verified,
      totp_verified: auth.totp_verified,
    });
  });
}
