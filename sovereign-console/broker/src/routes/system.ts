import type { FastifyInstance } from 'fastify';
import { requireAuth, requirePasskey, requireTotp } from '../middleware/auth.js';
import { appendLog } from '../audit/index.js';
import { getConnectedAgentCount, getOnlineAgentIds, getAgentStatus } from '../agent-relay/index.js';
import { getQueueStatus } from '../agent-relay/command-queue.js';
import { query } from '../db/connection.js';
import { getRedis } from '../redis.js';
import { getPool } from '../db/connection.js';
import { getConfig } from '../config.js';
import { logger } from '../logger.js';

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  // --- Health Check (no auth — used by monitoring) ---

  app.get('/api/system/health', async (_request, reply) => {
    const checks: Record<string, { status: string; latency_ms?: number }> = {};

    // Check PostgreSQL
    try {
      const start = Date.now();
      await getPool().query('SELECT 1');
      checks['database'] = { status: 'ok', latency_ms: Date.now() - start };
    } catch {
      checks['database'] = { status: 'error' };
    }

    // Check Redis
    try {
      const start = Date.now();
      const redis = getRedis();
      await redis.ping();
      checks['redis'] = { status: 'ok', latency_ms: Date.now() - start };
    } catch {
      checks['redis'] = { status: 'error' };
    }

    // Agent status
    checks['agents'] = {
      status: getConnectedAgentCount() > 0 ? 'ok' : 'degraded',
    };

    const allOk = Object.values(checks).every((c) => c.status === 'ok');

    return reply.code(allOk ? 200 : 503).send({
      status: allOk ? 'healthy' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  // --- Agent Status ---

  app.get('/api/system/agent-status', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const auth = request.authContext!;
    const onlineIds = getOnlineAgentIds();

    // Get all registered agents
    const result = await query<{ id: string; name: string; version: string; last_connected: Date | null }>(
      `SELECT id, name, version, last_connected FROM agent_registrations WHERE status = 'active'`,
    );

    const agents = result.rows.map((agent) => {
      const status = getAgentStatus(agent.id);
      return {
        id: agent.id,
        name: agent.name,
        version: agent.version,
        online: status.online,
        connected_at: status.connected_at,
        last_connected: agent.last_connected,
      };
    });

    // Get queue status for the current session
    const queueStatus = await getQueueStatus(auth.session_id);

    return reply.send({
      agents,
      connected_count: onlineIds.length,
      queue: {
        queued: queueStatus.queued,
        pending_reconfirm: queueStatus.pending_reconfirm,
        executing: queueStatus.executing,
      },
    });
  });

  // --- Emergency Disable (Kill Switch) ---

  app.post('/api/system/emergency-disable', {
    preHandler: [requirePasskey, requireTotp],
  }, async (request, reply) => {
    const auth = request.authContext!;

    logger.warn('EMERGENCY DISABLE TRIGGERED', {
      operator_id: auth.operator_id,
      device_id: auth.device_id,
      session_id: auth.session_id,
      ip: request.ip,
    });

    try {
      // 1. Revoke all active sessions
      const sessionResult = await query(
        `UPDATE sessions SET revoked_at = NOW() WHERE revoked_at IS NULL AND expires_at > NOW()`,
      );

      // 2. Expire all pending approval tokens
      const approvalResult = await query(
        `UPDATE approval_tokens SET status = 'expired' WHERE status IN ('pending', 'approved')`,
      );

      // 3. Reject all queued commands
      const commandResult = await query(
        `UPDATE command_queue SET status = 'rejected'
         WHERE status IN ('queued', 'pending_reconfirm', 'confirmed')`,
      );

      // 4. Set global disable flag in Redis
      const redis = getRedis();
      await redis.set('system:emergency_disabled', '1');

      // 5. Suspend all agent registrations
      await query(
        `UPDATE agent_registrations SET status = 'suspended' WHERE status = 'active'`,
      );

      await appendLog({
        event_type: 'system.emergency_disable',
        operator_id: auth.operator_id,
        device_id: auth.device_id,
        session_id: auth.session_id,
        action: 'EMERGENCY DISABLE — all sessions, approvals, and commands terminated',
        detail: {
          sessions_revoked: sessionResult.rowCount,
          approvals_expired: approvalResult.rowCount,
          commands_rejected: commandResult.rowCount,
        },
        ip_address: request.ip,
      });

      return reply.send({
        success: true,
        action: 'emergency_disable',
        sessions_revoked: sessionResult.rowCount,
        approvals_expired: approvalResult.rowCount,
        commands_rejected: commandResult.rowCount,
        message: 'System emergency disabled. All sessions and pending operations terminated.',
      });
    } catch (err) {
      logger.error('Emergency disable failed', { error: (err as Error).message });
      return reply.code(500).send({ error: 'Emergency disable failed' });
    }
  });

  // --- Aggregate Token Usage ---

  app.get('/api/system/token-usage', {
    preHandler: [requireAuth],
  }, async (_request, reply) => {
    const config = getConfig();

    // Today
    const todayResult = await query<{ total_input: string; total_output: string; task_count: string }>(
      `SELECT COALESCE(SUM(input_tokens), 0) as total_input,
              COALESCE(SUM(output_tokens), 0) as total_output,
              COUNT(*) as task_count
       FROM token_usage WHERE timestamp >= NOW() - INTERVAL '24 hours'`,
    );

    // Last 7 days
    const weekResult = await query<{ total_input: string; total_output: string; task_count: string }>(
      `SELECT COALESCE(SUM(input_tokens), 0) as total_input,
              COALESCE(SUM(output_tokens), 0) as total_output,
              COUNT(*) as task_count
       FROM token_usage WHERE timestamp >= NOW() - INTERVAL '7 days'`,
    );

    // Last 30 days
    const monthResult = await query<{ total_input: string; total_output: string; task_count: string }>(
      `SELECT COALESCE(SUM(input_tokens), 0) as total_input,
              COALESCE(SUM(output_tokens), 0) as total_output,
              COUNT(*) as task_count
       FROM token_usage WHERE timestamp >= NOW() - INTERVAL '30 days'`,
    );

    // Per-model breakdown (last 7 days)
    const modelBreakdown = await query<{ model: string; total_input: string; total_output: string; task_count: string }>(
      `SELECT model,
              COALESCE(SUM(input_tokens), 0) as total_input,
              COALESCE(SUM(output_tokens), 0) as total_output,
              COUNT(*) as task_count
       FROM token_usage WHERE timestamp >= NOW() - INTERVAL '7 days'
       GROUP BY model ORDER BY total_output DESC`,
    );

    const formatStats = (row: { total_input: string; total_output: string; task_count: string } | undefined) => ({
      input_tokens: parseInt(row?.total_input ?? '0', 10),
      output_tokens: parseInt(row?.total_output ?? '0', 10),
      task_count: parseInt(row?.task_count ?? '0', 10),
    });

    return reply.send({
      today: formatStats(todayResult.rows[0]),
      week: formatStats(weekResult.rows[0]),
      month: formatStats(monthResult.rows[0]),
      daily_threshold: config.CLAUDE_DAILY_SPEND_THRESHOLD,
      by_model: modelBreakdown.rows.map((row) => ({
        model: row.model,
        ...formatStats(row),
      })),
    });
  });
}
