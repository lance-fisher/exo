import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireApproval } from '../middleware/auth.js';
import { appendLog } from '../audit/index.js';
import { sendCommand, onProgress } from '../agent-relay/index.js';
import { query } from '../db/connection.js';
import { getConfig } from '../config.js';
import { logger } from '../logger.js';
import type { AgentResponse } from '../types/index.js';

// Rate limiting for usage stats: max 30 requests per minute per IP
const USAGE_RATE_LIMIT = 30;
const USAGE_RATE_WINDOW_MS = 60 * 1000;
const usageRateLimits = new Map<string, { count: number; windowStart: number }>();

function checkUsageRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = usageRateLimits.get(ip);

  if (!entry || now - entry.windowStart > USAGE_RATE_WINDOW_MS) {
    usageRateLimits.set(ip, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= USAGE_RATE_LIMIT) {
    return false;
  }

  entry.count++;
  return true;
}

const taskSubmitSchema = z.object({
  prompt: z.string().min(1).max(50_000),
  project_path: z.string().min(1),
  allowed_tools: z.array(z.string()).optional(),
  max_tokens: z.number().int().min(100).optional(),
  context_files: z.array(z.string()).optional(),
  agent_id: z.string().uuid(),
  approval_token_id: z.string().uuid().optional(),
});

const taskCancelSchema = z.object({
  agent_id: z.string().uuid(),
});

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  // --- Submit Task ---

  app.post('/api/tasks', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const body = taskSubmitSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() });
    }

    const auth = request.authContext!;
    const config = getConfig();

    // Check per-session task limit
    const taskCountResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM token_usage WHERE session_id = $1`,
      [auth.session_id],
    );
    const taskCount = parseInt(taskCountResult.rows[0]?.count ?? '0', 10);
    if (taskCount >= config.CLAUDE_MAX_TASKS_PER_SESSION) {
      return reply.code(429).send({
        error: `Session task limit reached (${config.CLAUDE_MAX_TASKS_PER_SESSION})`,
        code: 'TASK_LIMIT_REACHED',
      });
    }

    // Check daily spend threshold
    const spendResult = await query<{ total_input: string; total_output: string }>(
      `SELECT COALESCE(SUM(input_tokens), 0) as total_input, COALESCE(SUM(output_tokens), 0) as total_output
       FROM token_usage WHERE timestamp >= NOW() - INTERVAL '24 hours'`,
    );
    const dailyTokens =
      parseInt(spendResult.rows[0]?.total_input ?? '0', 10) +
      parseInt(spendResult.rows[0]?.total_output ?? '0', 10);

    // Rough cost estimate (conservative: $0.01 per 1K tokens)
    const estimatedSpend = (dailyTokens / 1000) * 0.01;
    if (estimatedSpend >= config.CLAUDE_DAILY_SPEND_THRESHOLD) {
      logger.warn('Daily spend threshold exceeded', {
        estimated_spend: estimatedSpend,
        threshold: config.CLAUDE_DAILY_SPEND_THRESHOLD,
      });
      return reply.code(429).send({
        error: 'Daily spend threshold exceeded',
        code: 'SPEND_LIMIT_REACHED',
        estimated_spend: estimatedSpend,
      });
    }

    // If the task involves writing, require approval token
    if (body.data.approval_token_id) {
      await requireApproval(request, reply);
      if (reply.sent) return;
    }

    const maxTokens = Math.min(
      body.data.max_tokens ?? config.CLAUDE_MAX_TOKENS_PER_TASK,
      config.CLAUDE_MAX_TOKENS_PER_TASK,
    );

    try {
      const response = await sendCommand(body.data.agent_id, {
        type: 'task',
        payload: {
          prompt: body.data.prompt,
          project_path: body.data.project_path,
          allowed_tools: body.data.allowed_tools,
          max_tokens: maxTokens,
          context_files: body.data.context_files,
        },
        session_id: auth.session_id,
      });

      // Record token usage
      const tokensUsed = response.payload['tokens_used'] as { input: number; output: number } | undefined;
      if (tokensUsed) {
        await query(
          `INSERT INTO token_usage (session_id, task_id, input_tokens, output_tokens, model, timestamp)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [auth.session_id, response.command_id, tokensUsed.input, tokensUsed.output, response.payload['model'] ?? 'unknown'],
        );
      }

      await appendLog({
        event_type: 'task.submit',
        operator_id: auth.operator_id,
        device_id: auth.device_id,
        session_id: auth.session_id,
        action: 'Task submitted and completed',
        resource: body.data.project_path,
        detail: {
          prompt_length: body.data.prompt.length,
          max_tokens: maxTokens,
          tokens_used: tokensUsed,
        },
        ip_address: request.ip,
      });

      return reply.send({
        task_id: response.command_id,
        status: 'completed',
        result: response.payload,
      });
    } catch (err) {
      const message = (err as Error).message;

      // Agent offline — command was queued
      if (message.includes('queued')) {
        await appendLog({
          event_type: 'task.submit',
          operator_id: auth.operator_id,
          device_id: auth.device_id,
          session_id: auth.session_id,
          action: 'Task queued — agent offline',
          resource: body.data.project_path,
          detail: { prompt_length: body.data.prompt.length },
          ip_address: request.ip,
        });

        return reply.code(202).send({
          status: 'queued',
          message: 'Agent is offline. Command has been queued.',
        });
      }

      logger.error('Task submission failed', { error: message });
      return reply.code(500).send({ error: 'Task submission failed', message });
    }
  });

  // --- Get Task Status ---

  app.get('/api/tasks/:id', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const params = request.params as { id: string };
    const auth = request.authContext!;

    const result = await query<{ command: string; status: string; result: string; queued_at: Date; completed_at: Date | null }>(
      `SELECT * FROM command_queue WHERE id = $1 AND session_id = $2`,
      [params.id, auth.session_id],
    );

    const task = result.rows[0];
    if (!task) {
      return reply.code(404).send({ error: 'Task not found' });
    }

    return reply.send({
      task_id: params.id,
      status: task.status,
      queued_at: task.queued_at,
      completed_at: task.completed_at,
      result: task.result ? JSON.parse(task.result as string) : null,
    });
  });

  // --- SSE Stream for Task Progress ---

  app.get('/api/tasks/:id/stream', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const params = request.params as { id: string };

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const sendEvent = (type: string, data: unknown) => {
      reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Register progress listener
    const unsubscribe = onProgress(params.id, (event: AgentResponse) => {
      sendEvent(event.type, event.payload);
    });

    // Send heartbeat every 15 seconds
    const heartbeat = setInterval(() => {
      reply.raw.write(':heartbeat\n\n');
    }, 15_000);

    // Clean up on close
    request.raw.on('close', () => {
      unsubscribe();
      clearInterval(heartbeat);
    });

    sendEvent('connected', { task_id: params.id });
  });

  // --- List Tasks in Session ---

  app.get('/api/tasks/session', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const auth = request.authContext!;

    const result = await query<{ id: string; command: string; status: string; queued_at: Date; completed_at: Date | null }>(
      `SELECT id, status, queued_at, completed_at
       FROM command_queue WHERE session_id = $1
       ORDER BY queued_at DESC LIMIT 50`,
      [auth.session_id],
    );

    return reply.send({ tasks: result.rows });
  });

  // --- Cancel Task ---

  app.post('/api/tasks/:id/cancel', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const params = request.params as { id: string };
    const body = taskCancelSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() });
    }

    const auth = request.authContext!;

    try {
      // Try to cancel via agent
      await sendCommand(body.data.agent_id, {
        type: 'cancel',
        payload: { task_id: params.id },
        session_id: auth.session_id,
      });

      // Update queue status
      await query(
        `UPDATE command_queue SET status = 'rejected', completed_at = NOW()
         WHERE id = $1 AND session_id = $2 AND status IN ('queued', 'pending_reconfirm', 'confirmed', 'executing')`,
        [params.id, auth.session_id],
      );

      await appendLog({
        event_type: 'task.cancel',
        operator_id: auth.operator_id,
        device_id: auth.device_id,
        session_id: auth.session_id,
        action: 'Task cancelled',
        resource: params.id,
        ip_address: request.ip,
      });

      return reply.send({ success: true, task_id: params.id, status: 'cancelled' });
    } catch (err) {
      // If agent is offline, just update queue
      await query(
        `UPDATE command_queue SET status = 'rejected', completed_at = NOW()
         WHERE id = $1 AND session_id = $2 AND status IN ('queued', 'pending_reconfirm')`,
        [params.id, auth.session_id],
      );

      return reply.send({ success: true, task_id: params.id, status: 'cancelled' });
    }
  });

  // --- Token Usage Stats ---

  app.get('/api/tasks/usage', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    if (!checkUsageRateLimit(request.ip)) {
      logger.warn('Usage stats rate limit exceeded', { ip: request.ip });
      return reply.code(429).send({ error: 'Rate limit exceeded. Try again later.' });
    }

    const auth = request.authContext!;

    // Session usage
    const sessionUsage = await query<{ total_input: string; total_output: string; task_count: string }>(
      `SELECT COALESCE(SUM(input_tokens), 0) as total_input,
              COALESCE(SUM(output_tokens), 0) as total_output,
              COUNT(*) as task_count
       FROM token_usage WHERE session_id = $1`,
      [auth.session_id],
    );

    // Daily usage
    const dailyUsage = await query<{ total_input: string; total_output: string; task_count: string }>(
      `SELECT COALESCE(SUM(input_tokens), 0) as total_input,
              COALESCE(SUM(output_tokens), 0) as total_output,
              COUNT(*) as task_count
       FROM token_usage WHERE timestamp >= NOW() - INTERVAL '24 hours'`,
    );

    const config = getConfig();
    const session = sessionUsage.rows[0];
    const daily = dailyUsage.rows[0];

    return reply.send({
      session: {
        input_tokens: parseInt(session?.total_input ?? '0', 10),
        output_tokens: parseInt(session?.total_output ?? '0', 10),
        task_count: parseInt(session?.task_count ?? '0', 10),
        max_tasks: config.CLAUDE_MAX_TASKS_PER_SESSION,
      },
      daily: {
        input_tokens: parseInt(daily?.total_input ?? '0', 10),
        output_tokens: parseInt(daily?.total_output ?? '0', 10),
        task_count: parseInt(daily?.task_count ?? '0', 10),
        spend_threshold: config.CLAUDE_DAILY_SPEND_THRESHOLD,
      },
    });
  });
}
