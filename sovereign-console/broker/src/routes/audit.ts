import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requirePasskey } from '../middleware/auth.js';
import { getEntries, verifyChain } from '../audit/index.js';
import type { AuditEventType } from '../types/index.js';

const auditQuerySchema = z.object({
  event_type: z.string().optional(),
  operator_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const exportQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  // --- Paginated Audit Log ---

  app.get('/api/audit', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const params = auditQuerySchema.safeParse(request.query);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid query parameters', details: params.error.flatten() });
    }

    const result = await getEntries({
      event_type: params.data.event_type as AuditEventType | undefined,
      operator_id: params.data.operator_id,
      session_id: params.data.session_id,
      from: params.data.from ? new Date(params.data.from) : undefined,
      to: params.data.to ? new Date(params.data.to) : undefined,
      page: params.data.page,
      limit: params.data.limit,
    });

    return reply.send(result);
  });

  // --- Verify Hash Chain ---

  app.get('/api/audit/verify', {
    preHandler: [requirePasskey],
  }, async (_request, reply) => {
    const result = await verifyChain();

    return reply.send({
      chain_valid: result.valid,
      entries_checked: result.entries_checked,
      broken_at: result.broken_at ?? null,
      verified_at: new Date().toISOString(),
    });
  });

  // --- Export Audit Entries ---

  app.get('/api/audit/export', {
    preHandler: [requirePasskey],
  }, async (request, reply) => {
    const params = exportQuerySchema.safeParse(request.query);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid query parameters', details: params.error.flatten() });
    }

    const result = await getEntries({
      from: params.data.from ? new Date(params.data.from) : undefined,
      to: params.data.to ? new Date(params.data.to) : undefined,
      page: 1,
      limit: 10_000,
    });

    if (params.data.format === 'csv') {
      const headers = [
        'id', 'event_type', 'operator_id', 'device_id', 'session_id',
        'action', 'resource', 'detail', 'ip_address', 'timestamp',
        'prev_hash', 'entry_hash',
      ];

      const csvRows = [headers.join(',')];
      for (const entry of result.data) {
        csvRows.push([
          entry.id,
          `"${entry.event_type}"`,
          entry.operator_id ?? '',
          entry.device_id ?? '',
          entry.session_id ?? '',
          `"${entry.action.replace(/"/g, '""')}"`,
          `"${(entry.resource ?? '').replace(/"/g, '""')}"`,
          `"${JSON.stringify(entry.detail).replace(/"/g, '""')}"`,
          entry.ip_address,
          new Date(entry.timestamp).toISOString(),
          entry.prev_hash,
          entry.entry_hash,
        ].join(','));
      }

      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().split('T')[0]}.csv"`);
      return reply.send(csvRows.join('\n'));
    }

    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().split('T')[0]}.json"`);
    return reply.send(result.data);
  });
}
