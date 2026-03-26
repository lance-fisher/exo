import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import {
  enrollDevice,
  verifyDevice,
  revokeDevice,
  getDeviceStatus,
  listDevices,
} from '../device-trust/index.js';
import { requireAuth, requirePasskey, requireTotp } from '../middleware/auth.js';
import { appendLog } from '../audit/index.js';
import { query } from '../db/connection.js';
import { logger } from '../logger.js';

const enrollSchema = z.object({
  name: z.string().min(1).max(128),
  type: z.enum(['laptop', 'iphone']),
  fingerprint: z.string().min(8).max(256),
  platform_info: z.record(z.unknown()).default({}),
});

const enrollCompleteSchema = z.object({
  device_id: z.string().uuid(),
  challenge_response: z.string().min(1),
});

const revokeSchema = z.object({
  reason: z.string().max(512).optional(),
});

const recoveryInitiateSchema = z.object({
  username: z.string().min(1),
});

const recoveryVerifySchema = z.object({
  username: z.string().min(1),
  recovery_code: z.string().min(1),
  new_device_fingerprint: z.string().min(8),
  new_device_name: z.string().min(1).max(128),
  new_device_type: z.enum(['laptop', 'iphone']),
});

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  // --- List Devices ---

  app.get('/api/devices', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const auth = request.authContext!;
    const devices = await listDevices(auth.operator_id);

    return reply.send({
      devices: devices.map((d) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        status: d.status,
        enrolled_at: d.enrolled_at,
        last_seen: d.last_seen,
        risk_flags: d.risk_flags,
        has_passkey: !!d.passkey_credential_id,
      })),
    });
  });

  // --- Initiate Enrollment ---

  app.post('/api/devices/enroll', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const body = enrollSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() });
    }

    const auth = request.authContext!;

    try {
      const { device, challenge } = await enrollDevice(auth.operator_id, {
        operator_id: auth.operator_id,
        ...body.data,
      });

      await appendLog({
        event_type: 'device.enroll',
        operator_id: auth.operator_id,
        device_id: device.id,
        session_id: auth.session_id,
        action: 'Device enrollment initiated',
        resource: device.name,
        detail: { type: device.type, fingerprint: device.fingerprint },
        ip_address: request.ip,
      });

      return reply.code(201).send({
        device_id: device.id,
        challenge,
        expires_in: 300,
      });
    } catch (err) {
      logger.error('Device enrollment failed', { error: (err as Error).message });
      return reply.code(409).send({ error: (err as Error).message });
    }
  });

  // --- Complete Enrollment ---

  app.post('/api/devices/enroll/complete', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const body = enrollCompleteSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() });
    }

    const auth = request.authContext!;

    try {
      const device = await verifyDevice(body.data.device_id, body.data.challenge_response);

      await appendLog({
        event_type: 'device.enroll',
        operator_id: auth.operator_id,
        device_id: device.id,
        session_id: auth.session_id,
        action: 'Device enrollment completed',
        resource: device.name,
        ip_address: request.ip,
      });

      return reply.send({
        device_id: device.id,
        status: device.status,
        enrolled_at: device.enrolled_at,
      });
    } catch (err) {
      logger.error('Device enrollment completion failed', { error: (err as Error).message });
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // --- Revoke Device ---

  app.post('/api/devices/:id/revoke', {
    preHandler: [requirePasskey, requireTotp],
  }, async (request, reply) => {
    const params = request.params as { id: string };
    const body = revokeSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() });
    }

    const auth = request.authContext!;

    try {
      await revokeDevice(params.id);

      await appendLog({
        event_type: 'device.revoke',
        operator_id: auth.operator_id,
        device_id: params.id,
        session_id: auth.session_id,
        action: 'Device revoked',
        detail: { reason: body.data?.reason ?? 'Manual revocation' },
        ip_address: request.ip,
      });

      return reply.send({ success: true, device_id: params.id, status: 'revoked' });
    } catch (err) {
      logger.error('Device revocation failed', { error: (err as Error).message });
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // --- Device Status ---

  app.get('/api/devices/:id/status', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const params = request.params as { id: string };
    const device = await getDeviceStatus(params.id);

    if (!device) {
      return reply.code(404).send({ error: 'Device not found' });
    }

    const auth = request.authContext!;
    if (device.operator_id !== auth.operator_id) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    return reply.send({
      id: device.id,
      name: device.name,
      type: device.type,
      status: device.status,
      enrolled_at: device.enrolled_at,
      last_seen: device.last_seen,
      risk_flags: device.risk_flags,
      has_passkey: !!device.passkey_credential_id,
      has_mtls: !!device.mtls_cert_fingerprint,
    });
  });

  // --- Break-Glass Recovery ---

  app.post('/api/devices/recovery/initiate', async (request, reply) => {
    const body = recoveryInitiateSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request' });
    }

    // Always return success to prevent username enumeration
    await appendLog({
      event_type: 'device.recovery',
      action: 'Recovery initiated',
      detail: { username: body.data.username },
      ip_address: request.ip,
    });

    return reply.send({
      message: 'If the account exists, recovery process has been initiated. Enter your recovery code.',
    });
  });

  app.post('/api/devices/recovery/verify', async (request, reply) => {
    const body = recoveryVerifySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() });
    }

    try {
      // Look up operator
      const opResult = await query<{ id: string }>(
        'SELECT id FROM operators WHERE username = $1',
        [body.data.username],
      );
      const operator = opResult.rows[0];
      if (!operator) {
        return reply.code(401).send({ error: 'Invalid recovery credentials' });
      }

      // Hash the provided recovery code and check
      const codeHash = createHash('sha256').update(body.data.recovery_code).digest('hex');
      const codeResult = await query<{ id: string }>(
        `SELECT id FROM recovery_codes
         WHERE operator_id = $1 AND code_hash = $2 AND used_at IS NULL`,
        [operator.id, codeHash],
      );

      const code = codeResult.rows[0];
      if (!code) {
        await appendLog({
          event_type: 'device.recovery',
          operator_id: operator.id,
          action: 'Recovery verification failed — invalid code',
          ip_address: request.ip,
        });
        return reply.code(401).send({ error: 'Invalid recovery credentials' });
      }

      // Mark recovery code as used
      await query('UPDATE recovery_codes SET used_at = NOW() WHERE id = $1', [code.id]);

      // Enroll the new device
      const { device, challenge } = await enrollDevice(operator.id, {
        operator_id: operator.id,
        name: body.data.new_device_name,
        type: body.data.new_device_type,
        fingerprint: body.data.new_device_fingerprint,
        platform_info: {},
      });

      await appendLog({
        event_type: 'device.recovery',
        operator_id: operator.id,
        device_id: device.id,
        action: 'Recovery successful — new device enrolled',
        detail: {
          new_device_name: body.data.new_device_name,
          new_device_type: body.data.new_device_type,
        },
        ip_address: request.ip,
      });

      return reply.send({
        device_id: device.id,
        challenge,
        expires_in: 300,
        message: 'Recovery successful. Complete device enrollment with the challenge.',
      });
    } catch (err) {
      logger.error('Recovery verification failed', { error: (err as Error).message });
      return reply.code(500).send({ error: 'Recovery failed' });
    }
  });
}
