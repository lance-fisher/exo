import { v4 as uuidv4 } from 'uuid';
import { MemoryStore } from '@dca/memory';
import type { EventBus, DCAEvent } from '@dca/memory/dist/repositories/EventBus';
import type { Subtask, AgentRole, Artifact } from '@dca/memory/dist/schema/types';
import { SafeShell } from '@dca/tools/dist/shell/SafeShell';
import { SafeFileSystem } from '@dca/tools/dist/filesystem/SafeFileSystem';
import { SafeGit } from '@dca/tools/dist/git/SafeGit';

export interface AgentContext {
  task_id: string;
  subtask: Subtask;
  workspace_root: string;
}

export interface AgentTools {
  shell: SafeShell;
  fs: SafeFileSystem;
  git: SafeGit;
}

/**
 * BaseAgent provides the shared behavior for all agent roles.
 * Each role extends this class and implements the `execute` method.
 */
export abstract class BaseAgent {
  abstract readonly role: AgentRole;
  abstract readonly description: string;

  protected memory: MemoryStore;
  protected eventBus: EventBus;
  private running = false;

  constructor(memory: MemoryStore, eventBus: EventBus) {
    this.memory = memory;
    this.eventBus = eventBus;
  }

  /**
   * Start listening for subtasks assigned to this role
   */
  async start(): Promise<void> {
    this.running = true;
    console.log(`[${this.role}] Agent started, listening for tasks...`);

    await this.eventBus.subscribe('subtask:created', async (event: DCAEvent) => {
      if (!this.running) return;
      const payload = event.payload as { role: string; subtask_id: string; workspace_root?: string };
      if (payload.role !== this.role) return;

      console.log(`[${this.role}] Picked up subtask: ${payload.subtask_id}`);
      await this.handleSubtask(event.task_id, payload.subtask_id, payload.workspace_root || '/workspace');
    });

    // Also listen for approved subtasks (resuming after approval)
    await this.eventBus.subscribe('subtask:approved', async (event: DCAEvent) => {
      if (!this.running || !event.subtask_id) return;
      const subtask = await this.memory.getSubtask(event.subtask_id);
      if (!subtask || subtask.assigned_role !== this.role) return;

      console.log(`[${this.role}] Resuming approved subtask: ${event.subtask_id}`);
      const task = await this.memory.getTask(event.task_id);
      await this.handleSubtask(event.task_id, event.subtask_id, task?.workspace_root || '/workspace');
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    console.log(`[${this.role}] Agent stopped`);
  }

  private async handleSubtask(taskId: string, subtaskId: string, workspaceRoot: string): Promise<void> {
    const subtask = await this.memory.getSubtask(subtaskId);
    if (!subtask) {
      console.error(`[${this.role}] Subtask ${subtaskId} not found`);
      return;
    }

    // Update status to in_progress
    await this.memory.updateSubtask(subtaskId, { status: 'in_progress' });
    await this.publishUpdate(taskId, subtaskId, 'Started working on subtask');

    const context: AgentContext = {
      task_id: taskId,
      subtask,
      workspace_root: workspaceRoot,
    };

    const tools: AgentTools = {
      shell: new SafeShell(workspaceRoot),
      fs: new SafeFileSystem(workspaceRoot),
      git: new SafeGit(workspaceRoot),
    };

    try {
      const artifacts = await this.execute(context, tools);

      // Update subtask with artifacts and mark complete
      await this.memory.updateSubtask(subtaskId, {
        status: 'completed',
        artifacts,
      });

      // Publish completion event
      await this.eventBus.publish('subtask:complete', {
        id: uuidv4(),
        task_id: taskId,
        subtask_id: subtaskId,
        event_type: 'subtask:complete',
        agent_role: this.role,
        payload: { artifacts_count: artifacts.length },
        timestamp: new Date().toISOString(),
      });

      console.log(`[${this.role}] Completed subtask: ${subtaskId}`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[${this.role}] Failed subtask ${subtaskId}:`, errorMessage);

      await this.memory.updateSubtask(subtaskId, {
        status: 'failed',
        error: errorMessage,
      });

      await this.eventBus.publish('subtask:complete', {
        id: uuidv4(),
        task_id: taskId,
        subtask_id: subtaskId,
        event_type: 'subtask:failed',
        agent_role: this.role,
        payload: { error: errorMessage },
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Execute the agent's role-specific logic.
   * Must be implemented by each agent role.
   */
  protected abstract execute(context: AgentContext, tools: AgentTools): Promise<Artifact[]>;

  // --- Helper methods for subclasses ---

  protected async log(taskId: string, content: string, type: 'info' | 'warning' | 'error' = 'info'): Promise<void> {
    await this.memory.addMessage({
      task_id: taskId,
      role: this.role,
      message_type: type,
      content,
    });
  }

  protected async logDecision(taskId: string, decision: string, reasoning: string, alternatives?: Array<{ option: string; pros: string[]; cons: string[] }>): Promise<void> {
    await this.memory.addDecision({
      task_id: taskId,
      agent_role: this.role,
      decision,
      reasoning,
      alternatives,
    });
  }

  protected async publishUpdate(taskId: string, subtaskId: string, message: string): Promise<void> {
    await this.eventBus.publish('subtask:update', {
      id: uuidv4(),
      task_id: taskId,
      subtask_id: subtaskId,
      event_type: 'subtask:update',
      agent_role: this.role,
      payload: { status: 'in_progress', message },
      timestamp: new Date().toISOString(),
    });
  }

  protected async requestApproval(taskId: string, subtaskId: string, description: string, riskTier: string): Promise<void> {
    await this.memory.updateSubtask(subtaskId, { status: 'awaiting_approval' });
    await this.eventBus.publish('approval:needed', {
      id: uuidv4(),
      task_id: taskId,
      subtask_id: subtaskId,
      event_type: 'approval:needed',
      agent_role: this.role,
      payload: { description, risk_tier: riskTier },
      timestamp: new Date().toISOString(),
    });
  }
}
