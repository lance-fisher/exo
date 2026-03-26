// =============================================================================
// Sovereign Operator Console — Command Queue Tests
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import type {
  AgentCommand,
  QueuedCommand,
  CommandStatus,
} from '../../broker/src/types/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TTL_SECONDS = 300; // 5 minutes

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

let commandQueue: Map<string, QueuedCommand>;
let agentOnline: boolean;
let operatorConfirmations: Set<string>; // command IDs confirmed by operator

// ---------------------------------------------------------------------------
// Stub services
// ---------------------------------------------------------------------------

function enqueueCommand(
  sessionId: string,
  command: AgentCommand,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): QueuedCommand {
  const queued: QueuedCommand = {
    id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    session_id: sessionId,
    command,
    status: agentOnline ? 'confirmed' : 'queued',
    queued_at: new Date(),
    ttl_expires_at: new Date(Date.now() + ttlSeconds * 1000),
    reconfirmed_at: null,
    completed_at: null,
    result: null,
  };

  commandQueue.set(queued.id, queued);
  return queued;
}

function getCommandStatus(commandId: string): CommandStatus | null {
  const cmd = commandQueue.get(commandId);
  return cmd?.status ?? null;
}

function expireStaleCommands(): number {
  let count = 0;
  const now = new Date();
  for (const [id, cmd] of commandQueue) {
    if (
      (cmd.status === 'queued' || cmd.status === 'pending_reconfirm') &&
      cmd.ttl_expires_at < now
    ) {
      cmd.status = 'expired';
      count++;
    }
  }
  return count;
}

function onAgentReconnect(): void {
  // All queued commands need reconfirmation
  for (const [, cmd] of commandQueue) {
    if (cmd.status === 'queued') {
      cmd.status = 'pending_reconfirm';
    }
  }
}

function reconfirmCommand(commandId: string): { success: boolean; reason?: string } {
  const cmd = commandQueue.get(commandId);
  if (!cmd) return { success: false, reason: 'not_found' };
  if (cmd.status !== 'pending_reconfirm') {
    return { success: false, reason: `invalid_status: ${cmd.status}` };
  }
  if (cmd.ttl_expires_at < new Date()) {
    cmd.status = 'expired';
    return { success: false, reason: 'expired' };
  }

  cmd.status = 'confirmed';
  cmd.reconfirmed_at = new Date();
  return { success: true };
}

function executeCommand(commandId: string): { executed: boolean; reason?: string } {
  const cmd = commandQueue.get(commandId);
  if (!cmd) return { executed: false, reason: 'not_found' };
  if (cmd.status !== 'confirmed') {
    return { executed: false, reason: `requires_confirmed_status, got: ${cmd.status}` };
  }

  cmd.status = 'executing';
  // Simulate execution completing
  cmd.status = 'completed';
  cmd.completed_at = new Date();
  cmd.result = {
    id: `resp-${Date.now()}`,
    command_id: commandId,
    type: 'result',
    payload: { output: 'Command executed successfully' },
    timestamp: new Date(),
  };

  return { executed: true };
}

function rejectCommand(commandId: string): boolean {
  const cmd = commandQueue.get(commandId);
  if (!cmd) return false;
  if (cmd.status === 'completed' || cmd.status === 'expired') return false;
  cmd.status = 'rejected';
  return true;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Command Queue — Queuing', () => {
  beforeEach(() => {
    commandQueue = new Map();
    agentOnline = false;
    operatorConfirmations = new Set();
  });

  it('queues command when agent is offline', () => {
    agentOnline = false;

    const cmd = enqueueCommand('sess-001', {
      id: 'agent-cmd-001',
      type: 'task',
      payload: { prompt: 'Fix the bug in auth module' },
      session_id: 'sess-001',
      timestamp: new Date(),
    });

    expect(cmd.status).toBe('queued');
    expect(commandQueue.size).toBe(1);
  });

  it('shows queued command status to operator', () => {
    agentOnline = false;

    const cmd = enqueueCommand('sess-001', {
      id: 'agent-cmd-002',
      type: 'file_read',
      payload: { path: '/projects/myapp/src/index.ts' },
      session_id: 'sess-001',
      timestamp: new Date(),
    });

    const status = getCommandStatus(cmd.id);
    expect(status).toBe('queued');
  });

  it('confirms command immediately when agent is online', () => {
    agentOnline = true;

    const cmd = enqueueCommand('sess-001', {
      id: 'agent-cmd-003',
      type: 'task',
      payload: { prompt: 'Deploy the application' },
      session_id: 'sess-001',
      timestamp: new Date(),
    });

    expect(cmd.status).toBe('confirmed');
  });
});

describe('Command Queue — TTL Expiration', () => {
  beforeEach(() => {
    commandQueue = new Map();
    agentOnline = false;
    operatorConfirmations = new Set();
  });

  it('expires commands past their TTL', () => {
    const cmd = enqueueCommand('sess-001', {
      id: 'agent-cmd-ttl',
      type: 'task',
      payload: { prompt: 'Some task' },
      session_id: 'sess-001',
      timestamp: new Date(),
    }, 1); // 1 second TTL

    // Force expiration
    cmd.ttl_expires_at = new Date(Date.now() - 1000);

    const expired = expireStaleCommands();
    expect(expired).toBe(1);
    expect(cmd.status).toBe('expired');
  });

  it('does not expire commands within TTL', () => {
    enqueueCommand('sess-001', {
      id: 'agent-cmd-fresh',
      type: 'task',
      payload: { prompt: 'Fresh task' },
      session_id: 'sess-001',
      timestamp: new Date(),
    }, 3600); // 1 hour TTL

    const expired = expireStaleCommands();
    expect(expired).toBe(0);
  });
});

describe('Command Queue — Reconnect & Reconfirmation', () => {
  beforeEach(() => {
    commandQueue = new Map();
    agentOnline = false;
    operatorConfirmations = new Set();
  });

  it('marks queued commands as pending_reconfirm on reconnect', () => {
    const cmd = enqueueCommand('sess-001', {
      id: 'agent-cmd-recon',
      type: 'task',
      payload: { prompt: 'Pending task' },
      session_id: 'sess-001',
      timestamp: new Date(),
    });

    expect(cmd.status).toBe('queued');

    onAgentReconnect();

    expect(cmd.status).toBe('pending_reconfirm');
  });

  it('executes command only after reconfirmation', () => {
    const cmd = enqueueCommand('sess-001', {
      id: 'agent-cmd-exec',
      type: 'task',
      payload: { prompt: 'Task needing reconfirm' },
      session_id: 'sess-001',
      timestamp: new Date(),
    });

    onAgentReconnect();
    expect(cmd.status).toBe('pending_reconfirm');

    // Try to execute without reconfirmation — should fail
    const execResult = executeCommand(cmd.id);
    expect(execResult.executed).toBe(false);
    expect(execResult.reason).toContain('requires_confirmed_status');

    // Reconfirm
    const confirmResult = reconfirmCommand(cmd.id);
    expect(confirmResult.success).toBe(true);
    expect(cmd.status).toBe('confirmed');

    // Now execution should succeed
    const execResult2 = executeCommand(cmd.id);
    expect(execResult2.executed).toBe(true);
    expect(cmd.status).toBe('completed');
    expect(cmd.result).not.toBeNull();
  });

  it('rejects command without reconfirmation', () => {
    const cmd = enqueueCommand('sess-001', {
      id: 'agent-cmd-no-reconfirm',
      type: 'file_write',
      payload: { path: '/projects/myapp/src/new.ts', content: 'new content' },
      session_id: 'sess-001',
      timestamp: new Date(),
    });

    onAgentReconnect();

    // Operator decides to reject instead of reconfirm
    const rejected = rejectCommand(cmd.id);
    expect(rejected).toBe(true);
    expect(cmd.status).toBe('rejected');

    // Cannot execute rejected command
    const execResult = executeCommand(cmd.id);
    expect(execResult.executed).toBe(false);
  });
});
