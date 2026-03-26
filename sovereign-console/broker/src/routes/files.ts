import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireApproval } from '../middleware/auth.js';
import { appendLog } from '../audit/index.js';
import { sendCommand } from '../agent-relay/index.js';
import { consumeApprovalToken } from '../approval/index.js';
import { logger } from '../logger.js';

/** Patterns to redact from file content */
const REDACTION_PATTERNS = [
  /(?:password|secret|token|api_key|apikey|private_key)\s*[:=]\s*['"][^'"]+['"]/gi,
  /(?:AWS_SECRET_ACCESS_KEY|PRIVATE_KEY)\s*[:=]\s*\S+/gi,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/g,
];

function redactSensitive(content: string): string {
  let redacted = content;
  for (const pattern of REDACTION_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  return redacted;
}

/** Ensure a path is within allowed project directories */
function isPathSafe(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  // Prevent directory traversal
  if (normalized.includes('..')) return false;
  // Must be absolute
  if (!normalized.startsWith('/')) return false;
  // Prevent access to sensitive system directories
  const forbidden = ['/etc/shadow', '/etc/passwd', '/root/.ssh', '/proc', '/sys'];
  for (const dir of forbidden) {
    if (normalized.startsWith(dir)) return false;
  }
  return true;
}

const browseSchema = z.object({
  path: z.string().min(1),
  agent_id: z.string().uuid(),
});

const readSchema = z.object({
  path: z.string().min(1),
  agent_id: z.string().uuid(),
  line_start: z.number().int().min(1).optional(),
  line_end: z.number().int().min(1).optional(),
});

const diffSchema = z.object({
  path: z.string().min(1),
  agent_id: z.string().uuid(),
});

const writeSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  agent_id: z.string().uuid(),
  approval_token_id: z.string().uuid(),
});

const projectsSchema = z.object({
  agent_id: z.string().uuid(),
});

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  // --- Browse Directory ---

  app.get('/api/files/browse', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const params = browseSchema.safeParse(request.query);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid request', details: params.error.flatten() });
    }

    if (!isPathSafe(params.data.path)) {
      return reply.code(403).send({ error: 'Access denied — path not allowed' });
    }

    const auth = request.authContext!;

    try {
      const response = await sendCommand(params.data.agent_id, {
        type: 'file_browse',
        payload: { path: params.data.path },
        session_id: auth.session_id,
      });

      await appendLog({
        event_type: 'file.browse',
        operator_id: auth.operator_id,
        device_id: auth.device_id,
        session_id: auth.session_id,
        action: 'Directory browsed',
        resource: params.data.path,
        ip_address: request.ip,
      });

      return reply.send(response.payload);
    } catch (err) {
      logger.error('File browse failed', { error: (err as Error).message });
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // --- Read File ---

  app.get('/api/files/read', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const params = readSchema.safeParse(request.query);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid request', details: params.error.flatten() });
    }

    if (!isPathSafe(params.data.path)) {
      return reply.code(403).send({ error: 'Access denied — path not allowed' });
    }

    const auth = request.authContext!;

    try {
      const response = await sendCommand(params.data.agent_id, {
        type: 'file_read',
        payload: {
          path: params.data.path,
          line_start: params.data.line_start,
          line_end: params.data.line_end,
        },
        session_id: auth.session_id,
      });

      // Redact sensitive content
      const content = response.payload['content'] as string | undefined;
      const redactedContent = content ? redactSensitive(content) : content;

      await appendLog({
        event_type: 'file.read',
        operator_id: auth.operator_id,
        device_id: auth.device_id,
        session_id: auth.session_id,
        action: 'File read',
        resource: params.data.path,
        detail: { line_start: params.data.line_start, line_end: params.data.line_end },
        ip_address: request.ip,
      });

      return reply.send({
        ...response.payload,
        content: redactedContent,
      });
    } catch (err) {
      logger.error('File read failed', { error: (err as Error).message });
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // --- Get Diff Preview ---

  app.get('/api/files/diff', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const params = diffSchema.safeParse(request.query);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid request', details: params.error.flatten() });
    }

    if (!isPathSafe(params.data.path)) {
      return reply.code(403).send({ error: 'Access denied — path not allowed' });
    }

    const auth = request.authContext!;

    try {
      const response = await sendCommand(params.data.agent_id, {
        type: 'file_diff',
        payload: { path: params.data.path },
        session_id: auth.session_id,
      });

      // Redact sensitive content in diffs
      const diff = response.payload['diff'] as string | undefined;
      const redactedDiff = diff ? redactSensitive(diff) : diff;

      return reply.send({
        ...response.payload,
        diff: redactedDiff,
      });
    } catch (err) {
      logger.error('File diff failed', { error: (err as Error).message });
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // --- Write File (Requires Approval) ---

  app.post('/api/files/write', {
    preHandler: [requireApproval],
  }, async (request, reply) => {
    const body = writeSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() });
    }

    if (!isPathSafe(body.data.path)) {
      return reply.code(403).send({ error: 'Access denied — path not allowed' });
    }

    const auth = request.authContext!;

    try {
      // Consume the approval token
      await consumeApprovalToken(body.data.approval_token_id);

      const response = await sendCommand(body.data.agent_id, {
        type: 'file_write',
        payload: {
          path: body.data.path,
          content: body.data.content,
        },
        session_id: auth.session_id,
      });

      await appendLog({
        event_type: 'file.write',
        operator_id: auth.operator_id,
        device_id: auth.device_id,
        session_id: auth.session_id,
        action: 'File written',
        resource: body.data.path,
        detail: {
          content_length: body.data.content.length,
          approval_token_id: body.data.approval_token_id,
        },
        ip_address: request.ip,
      });

      return reply.send({
        success: true,
        path: body.data.path,
        result: response.payload,
      });
    } catch (err) {
      logger.error('File write failed', { error: (err as Error).message });
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // --- List Projects ---

  app.get('/api/files/projects', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const params = projectsSchema.safeParse(request.query);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid request', details: params.error.flatten() });
    }

    const auth = request.authContext!;

    try {
      const response = await sendCommand(params.data.agent_id, {
        type: 'file_browse',
        payload: { path: '/', list_projects: true },
        session_id: auth.session_id,
      });

      return reply.send(response.payload);
    } catch (err) {
      logger.error('Project listing failed', { error: (err as Error).message });
      return reply.code(500).send({ error: (err as Error).message });
    }
  });
}
