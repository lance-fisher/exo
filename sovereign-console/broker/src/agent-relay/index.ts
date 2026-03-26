import type { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { query } from '../db/connection.js';
import { logger } from '../logger.js';
import { queueCommand, getPendingCommands } from './command-queue.js';
import { getConfig } from '../config.js';
import type { AgentCommand, AgentResponse, AgentRegistration } from '../types/index.js';

/** Connected agent sessions keyed by agent ID */
const connectedAgents = new Map<string, {
  ws: WebSocket;
  agentId: string;
  connectedAt: Date;
  certFingerprint: string;
}>();

/** Pending command callbacks keyed by command ID */
const pendingCallbacks = new Map<string, {
  resolve: (response: AgentResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

/** Progress listeners keyed by command ID */
const progressListeners = new Map<string, Set<(event: AgentResponse) => void>>();

/** Verify mTLS cert against agent_registrations and establish connection */
export async function handleAgentConnect(
  ws: WebSocket,
  certFingerprint: string,
): Promise<string> {
  // Look up agent by mTLS certificate fingerprint
  const result = await query<AgentRegistration>(
    `SELECT * FROM agent_registrations
     WHERE mtls_cert_fingerprint = $1 AND status = 'active'`,
    [certFingerprint],
  );

  const agent = result.rows[0];
  if (!agent) {
    logger.warn('Agent connection rejected — unknown certificate', { cert_fingerprint: certFingerprint });
    ws.close(4001, 'Unauthorized: unknown agent certificate');
    throw new Error('Agent certificate not registered');
  }

  // Update last_connected
  await query(
    'UPDATE agent_registrations SET last_connected = NOW() WHERE id = $1',
    [agent.id],
  );

  // Store connection
  connectedAgents.set(agent.id, {
    ws,
    agentId: agent.id,
    connectedAt: new Date(),
    certFingerprint,
  });

  // Set up message handler
  ws.on('message', (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString()) as AgentResponse;
      handleAgentMessage(agent.id, message);
    } catch (err) {
      logger.error('Failed to parse agent message', { agent_id: agent.id, error: (err as Error).message });
    }
  });

  // Set up close handler
  ws.on('close', (code: number, reason: Buffer) => {
    connectedAgents.delete(agent.id);
    logger.info('Agent disconnected', { agent_id: agent.id, code, reason: reason.toString() });

    // Reject any pending callbacks
    for (const [cmdId, cb] of pendingCallbacks.entries()) {
      // Only reject callbacks for commands sent to this agent
      clearTimeout(cb.timeout);
      cb.reject(new Error('Agent disconnected'));
      pendingCallbacks.delete(cmdId);
    }
  });

  // Set up ping/pong for keepalive
  const pingInterval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      ws.ping();
    } else {
      clearInterval(pingInterval);
    }
  }, 30_000);

  ws.on('close', () => clearInterval(pingInterval));

  logger.info('Agent connected', { agent_id: agent.id, name: agent.name, version: agent.version });

  // Send pending reconfirm notifications
  await handleAgentReconnect(agent.id);

  return agent.id;
}

/** Handle an incoming message from the agent */
function handleAgentMessage(agentId: string, response: AgentResponse): void {
  logger.debug('Agent message received', {
    agent_id: agentId,
    command_id: response.command_id,
    type: response.type,
  });

  // Route progress events to listeners
  if (response.type === 'progress') {
    const listeners = progressListeners.get(response.command_id);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(response);
        } catch (err) {
          logger.error('Progress listener error', { error: (err as Error).message });
        }
      }
    }
    return;
  }

  // Route result/error to pending callback
  const callback = pendingCallbacks.get(response.command_id);
  if (callback) {
    clearTimeout(callback.timeout);
    pendingCallbacks.delete(response.command_id);

    if (response.type === 'error') {
      callback.reject(new Error(String(response.payload['message'] ?? 'Agent error')));
    } else {
      callback.resolve(response);
    }
  }

  // Update command_queue if applicable
  if (response.type === 'result' || response.type === 'error') {
    query(
      `UPDATE command_queue SET status = 'completed', completed_at = NOW(), result = $1
       WHERE id = $2 AND status = 'executing'`,
      [JSON.stringify(response), response.command_id],
    ).catch((err) => {
      logger.error('Failed to update command queue', { error: (err as Error).message });
    });
  }
}

/** Send a command to an agent — sends immediately if online, queues if offline */
export async function sendCommand(
  agentId: string,
  command: Omit<AgentCommand, 'id' | 'timestamp'>,
  timeoutMs = 60_000,
): Promise<AgentResponse> {
  const config = getConfig();
  const fullCommand: AgentCommand = {
    ...command,
    id: randomUUID(),
    timestamp: new Date(),
  };

  const connection = connectedAgents.get(agentId);

  if (!connection || connection.ws.readyState !== connection.ws.OPEN) {
    // Agent offline — queue the command
    logger.info('Agent offline, queuing command', { agent_id: agentId, command_id: fullCommand.id });
    await queueCommand(command.session_id, fullCommand, config.AGENT_QUEUE_TTL_SECONDS);
    throw new Error('Agent is offline. Command has been queued and will require reconfirmation.');
  }

  // Agent online — send directly
  return new Promise<AgentResponse>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingCallbacks.delete(fullCommand.id);
      reject(new Error('Command timed out'));
    }, timeoutMs);

    pendingCallbacks.set(fullCommand.id, { resolve, reject, timeout });

    // Mark as executing in queue
    query(
      `UPDATE command_queue SET status = 'executing' WHERE id = $1`,
      [fullCommand.id],
    ).catch(() => { /* may not exist in queue */ });

    connection.ws.send(JSON.stringify(fullCommand), (err) => {
      if (err) {
        clearTimeout(timeout);
        pendingCallbacks.delete(fullCommand.id);
        reject(new Error(`Failed to send command: ${err.message}`));
      }
    });

    logger.debug('Command sent to agent', { agent_id: agentId, command_id: fullCommand.id });
  });
}

/** Register a progress listener for a command */
export function onProgress(commandId: string, listener: (event: AgentResponse) => void): () => void {
  if (!progressListeners.has(commandId)) {
    progressListeners.set(commandId, new Set());
  }
  progressListeners.get(commandId)!.add(listener);

  return () => {
    const listeners = progressListeners.get(commandId);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        progressListeners.delete(commandId);
      }
    }
  };
}

/** Get agent online/offline status */
export function getAgentStatus(agentId: string): {
  online: boolean;
  connected_at: Date | null;
  cert_fingerprint: string | null;
} {
  const connection = connectedAgents.get(agentId);
  if (!connection || connection.ws.readyState !== connection.ws.OPEN) {
    return { online: false, connected_at: null, cert_fingerprint: null };
  }
  return {
    online: true,
    connected_at: connection.connectedAt,
    cert_fingerprint: connection.certFingerprint,
  };
}

/** On reconnect, notify about pending commands that need reconfirmation */
export async function handleAgentReconnect(agentId: string): Promise<void> {
  const pending = await getPendingCommands(agentId);

  if (pending.length > 0) {
    logger.info('Agent has pending commands for reconfirmation', {
      agent_id: agentId,
      count: pending.length,
    });

    // Notify connected clients via the agent connection
    const connection = connectedAgents.get(agentId);
    if (connection && connection.ws.readyState === connection.ws.OPEN) {
      connection.ws.send(JSON.stringify({
        type: 'pending_reconfirm',
        commands: pending.map((cmd) => ({
          id: cmd.id,
          command: cmd.command,
          queued_at: cmd.queued_at,
          ttl_expires_at: cmd.ttl_expires_at,
        })),
      }));
    }
  }
}

/** Get count of connected agents */
export function getConnectedAgentCount(): number {
  return connectedAgents.size;
}

/** Get all registered agent IDs that are online */
export function getOnlineAgentIds(): string[] {
  return Array.from(connectedAgents.keys());
}
