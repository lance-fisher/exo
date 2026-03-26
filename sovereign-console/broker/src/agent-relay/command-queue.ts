import { query } from '../db/connection.js';
import { logger } from '../logger.js';
import type { AgentCommand, QueuedCommand } from '../types/index.js';

/** Queue a command for an offline agent */
export async function queueCommand(
  sessionId: string,
  command: AgentCommand,
  ttlSeconds: number,
): Promise<QueuedCommand> {
  const ttlExpiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const result = await query<QueuedCommand>(
    `INSERT INTO command_queue (id, session_id, command, status, ttl_expires_at)
     VALUES ($1, $2, $3, 'queued', $4)
     RETURNING *`,
    [command.id, sessionId, JSON.stringify(command), ttlExpiresAt],
  );

  const queued = result.rows[0];
  if (!queued) {
    throw new Error('Failed to queue command');
  }

  logger.info('Command queued', {
    command_id: command.id,
    session_id: sessionId,
    ttl_expires_at: ttlExpiresAt.toISOString(),
  });

  return queued;
}

/**
 * Get commands that need reconfirmation before execution.
 * When agent comes back online, queued commands move to pending_reconfirm.
 */
export async function getPendingCommands(_agentId: string): Promise<QueuedCommand[]> {
  // Move 'queued' commands to 'pending_reconfirm' since agent is now online
  await query(
    `UPDATE command_queue SET status = 'pending_reconfirm'
     WHERE status = 'queued' AND ttl_expires_at > NOW()`,
  );

  const result = await query<QueuedCommand>(
    `SELECT * FROM command_queue
     WHERE status = 'pending_reconfirm' AND ttl_expires_at > NOW()
     ORDER BY queued_at ASC`,
  );

  return result.rows;
}

/** Reconfirm a queued command — operator confirms they still want it executed */
export async function reconfirmCommand(
  commandId: string,
  sessionId: string,
): Promise<QueuedCommand> {
  const result = await query<QueuedCommand>(
    `UPDATE command_queue SET status = 'confirmed', reconfirmed_at = NOW()
     WHERE id = $1 AND session_id = $2 AND status = 'pending_reconfirm' AND ttl_expires_at > NOW()
     RETURNING *`,
    [commandId, sessionId],
  );

  const command = result.rows[0];
  if (!command) {
    throw new Error('Command not found, not pending reconfirmation, or TTL expired');
  }

  logger.info('Command reconfirmed', { command_id: commandId, session_id: sessionId });

  return command;
}

/** Reject a queued command */
export async function rejectCommand(
  commandId: string,
  sessionId: string,
): Promise<void> {
  const result = await query(
    `UPDATE command_queue SET status = 'rejected'
     WHERE id = $1 AND session_id = $2 AND status IN ('queued', 'pending_reconfirm')`,
    [commandId, sessionId],
  );

  if (result.rowCount === 0) {
    throw new Error('Command not found or not in a rejectable state');
  }

  logger.info('Command rejected', { command_id: commandId });
}

/** Expire commands that have passed their TTL */
export async function expireStaleCommands(): Promise<number> {
  const result = await query(
    `UPDATE command_queue SET status = 'expired'
     WHERE status IN ('queued', 'pending_reconfirm') AND ttl_expires_at < NOW()`,
  );

  const count = result.rowCount ?? 0;
  if (count > 0) {
    logger.info('Expired stale commands', { count });
  }

  return count;
}

/** Get the queue status for a session — for UI display */
export async function getQueueStatus(sessionId: string): Promise<{
  queued: number;
  pending_reconfirm: number;
  confirmed: number;
  executing: number;
  completed: number;
  expired: number;
  rejected: number;
  commands: QueuedCommand[];
}> {
  const result = await query<QueuedCommand>(
    `SELECT * FROM command_queue WHERE session_id = $1 ORDER BY queued_at DESC LIMIT 100`,
    [sessionId],
  );

  const commands = result.rows;
  const counts = {
    queued: 0,
    pending_reconfirm: 0,
    confirmed: 0,
    executing: 0,
    completed: 0,
    expired: 0,
    rejected: 0,
  };

  for (const cmd of commands) {
    const status = cmd.status as keyof typeof counts;
    if (status in counts) {
      counts[status]++;
    }
  }

  return { ...counts, commands };
}

/** Get a specific command by ID */
export async function getCommand(commandId: string): Promise<QueuedCommand | null> {
  const result = await query<QueuedCommand>(
    'SELECT * FROM command_queue WHERE id = $1',
    [commandId],
  );
  return result.rows[0] ?? null;
}
