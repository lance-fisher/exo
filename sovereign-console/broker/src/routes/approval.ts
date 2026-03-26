import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { requireAuth, requireEnrolledDevice } from '../middleware/auth.js';
import {
  createApprovalToken,
  approveToken,
  rejectToken,
  listPendingTokens,
  getApprovalToken,
} from '../approval/index.js';
import { appendLog } from '../audit/index.js';
import { getConfig } from '../config.js';
import { logger } from '../logger.js';
// ApprovalActionType used via zod enum validation above

const requestApprovalSchema = z.object({
  action_type: z.enum(['file_write', 'file_delete', 'shell_exec', 'config_change', 'deploy', 'dangerous']),
  resource_path: z.string().min(1),
  operation: z.string().min(1).max(64),
  payload_hash: z.string().min(1).optional(),
  payload: z.unknown().optional(),
});

const approveSchema = z.object({
  device_id: z.string().uuid(),
});

const rejectSchema = z.object({
  device_id: z.string().uuid(),
  reason: z.string().max(512).optional(),
});

export async function approvalRoutes(app: FastifyInstance): Promise<void> {
  // --- Request Approval ---

  app.post('/api/approval/request', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const body = requestApprovalSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() });
    }

    const auth = request.authContext!;
    const config = getConfig();

    // Determine TTL based on action type
    const isDangerous = body.data.action_type === 'dangerous' || body.data.action_type === 'deploy';
    const ttlSeconds = isDangerous ? config.APPROVAL_TOKEN_TTL_DANGEROUS : config.APPROVAL_TOKEN_TTL_WRITE;

    // Compute payload hash if not provided
    const payloadHash = body.data.payload_hash ??
      createHash('sha256')
        .update(JSON.stringify(body.data.payload ?? body.data.resource_path))
        .digest('hex');

    try {
      const token = await createApprovalToken({
        action_type: body.data.action_type,
        resource_path: body.data.resource_path,
        operation: body.data.operation,
        device_id: auth.device_id,
        session_id: auth.session_id,
        payload_hash: payloadHash,
        ttl_seconds: ttlSeconds,
      });

      await appendLog({
        event_type: 'approval.request',
        operator_id: auth.operator_id,
        device_id: auth.device_id,
        session_id: auth.session_id,
        action: `Approval requested: ${body.data.action_type}`,
        resource: body.data.resource_path,
        detail: {
          token_id: token.id,
          operation: body.data.operation,
          ttl_seconds: ttlSeconds,
        },
        ip_address: request.ip,
      });

      return reply.code(201).send({
        token_id: token.id,
        action_type: token.action_type,
        resource_path: token.resource_path,
        operation: token.operation,
        status: token.status,
        expires_at: token.expires_at,
        nonce: token.nonce,
      });
    } catch (err) {
      logger.error('Approval request failed', { error: (err as Error).message });
      return reply.code(500).send({ error: 'Failed to create approval token' });
    }
  });

  // --- Approve from Second Device (e.g., iPhone) ---

  app.post('/api/approval/:id/approve', {
    preHandler: [requireEnrolledDevice],
  }, async (request, reply) => {
    const params = request.params as { id: string };
    const body = approveSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() });
    }

    const auth = request.authContext!;

    try {
      const token = await approveToken(params.id, body.data.device_id);

      await appendLog({
        event_type: 'approval.approve',
        operator_id: auth.operator_id,
        device_id: body.data.device_id,
        session_id: auth.session_id,
        action: `Approval granted: ${token.action_type}`,
        resource: token.resource_path,
        detail: {
          token_id: token.id,
          operation: token.operation,
          approved_by_device: body.data.device_id,
        },
        ip_address: request.ip,
      });

      return reply.send({
        token_id: token.id,
        status: token.status,
        approved_at: token.approved_at,
        approved_by_device_id: token.approved_by_device_id,
      });
    } catch (err) {
      logger.error('Approval failed', { error: (err as Error).message });
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // --- Reject ---

  app.post('/api/approval/:id/reject', {
    preHandler: [requireEnrolledDevice],
  }, async (request, reply) => {
    const params = request.params as { id: string };
    const body = rejectSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() });
    }

    const auth = request.authContext!;

    try {
      await rejectToken(params.id, body.data.device_id);

      await appendLog({
        event_type: 'approval.reject',
        operator_id: auth.operator_id,
        device_id: body.data.device_id,
        session_id: auth.session_id,
        action: 'Approval rejected',
        resource: params.id,
        detail: { reason: body.data.reason ?? 'No reason provided' },
        ip_address: request.ip,
      });

      return reply.send({ token_id: params.id, status: 'rejected' });
    } catch (err) {
      logger.error('Rejection failed', { error: (err as Error).message });
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // --- List Pending Approvals ---

  app.get('/api/approval/pending', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const auth = request.authContext!;
    const tokens = await listPendingTokens(auth.session_id);

    return reply.send({
      pending: tokens.map((t) => ({
        id: t.id,
        action_type: t.action_type,
        resource_path: t.resource_path,
        operation: t.operation,
        issued_at: t.issued_at,
        expires_at: t.expires_at,
        status: t.status,
      })),
    });
  });

  // --- Check Approval Status ---

  app.get('/api/approval/:id/status', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const params = request.params as { id: string };
    const token = await getApprovalToken(params.id);

    if (!token) {
      return reply.code(404).send({ error: 'Approval token not found' });
    }

    // Verify the requester has access to this token
    const auth = request.authContext!;
    if (token.session_id !== auth.session_id && token.device_id !== auth.device_id) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    return reply.send({
      id: token.id,
      action_type: token.action_type,
      resource_path: token.resource_path,
      operation: token.operation,
      status: token.status,
      issued_at: token.issued_at,
      expires_at: token.expires_at,
      approved_by_device_id: token.approved_by_device_id,
      approved_at: token.approved_at,
      used_at: token.used_at,
    });
  });
}
