import { v4 as uuidv4 } from 'uuid';
import { MemoryStore } from '@dca/memory';
import type { EventBus, DCAEvent } from '@dca/memory/dist/repositories/EventBus';
import type { Task, Subtask, PlanStep, ResultPacket, AgentRole, RiskTier } from '@dca/memory/dist/schema/types';
import { WebSocketManager } from '../events/WebSocketManager';

/**
 * TaskCoordinator is the brain of the orchestrator.
 * It decomposes user requests into plans, creates subtasks,
 * assigns them to agents, and merges results.
 */
export class TaskCoordinator {
  constructor(
    private memory: MemoryStore,
    private eventBus: EventBus,
    private wsManager: WebSocketManager,
  ) {}

  async initialize(): Promise<void> {
    // Subscribe to agent events
    await this.eventBus.subscribe('subtask:update', (event: DCAEvent) => {
      this.handleSubtaskUpdate(event).catch(err =>
        console.error('[coordinator] Error handling subtask update:', err)
      );
    });

    await this.eventBus.subscribe('subtask:complete', (event: DCAEvent) => {
      this.handleSubtaskComplete(event).catch(err =>
        console.error('[coordinator] Error handling subtask complete:', err)
      );
    });

    await this.eventBus.subscribe('approval:needed', (event: DCAEvent) => {
      this.handleApprovalNeeded(event).catch(err =>
        console.error('[coordinator] Error handling approval needed:', err)
      );
    });

    await this.eventBus.subscribe('risk:flagged', (event: DCAEvent) => {
      this.handleRiskFlagged(event).catch(err =>
        console.error('[coordinator] Error handling risk flagged:', err)
      );
    });
  }

  /**
   * Process a new task: decompose into plan and create subtasks
   */
  async processNewTask(task: Task): Promise<Task> {
    // Step 1: Update status to planning
    let updated = await this.memory.updateTask(task.id, { status: 'planning' });
    this.emitTaskEvent(task.id, 'task:planning', { message: 'Decomposing request into plan' });

    // Step 2: Decompose the user request into a plan
    const plan = this.decomposeRequest(task.user_request);
    const assumptions = this.generateAssumptions(task.user_request);
    const objective = this.interpretObjective(task.user_request);

    updated = await this.memory.updateTask(task.id, {
      interpreted_objective: objective,
      assumptions,
      plan,
      status: 'executing',
    });

    this.emitTaskEvent(task.id, 'task:planned', {
      objective,
      assumptions,
      step_count: plan.length,
    });

    // Step 3: Create subtasks from plan
    const subtaskIds: string[] = [];
    for (const step of plan) {
      const subtask = await this.memory.createSubtask(task.id, {
        title: step.title,
        description: step.description,
        assigned_role: step.assigned_role,
        risk_tier: step.risk_tier,
        priority: plan.length - step.step_number, // Higher priority for earlier steps
      });
      subtaskIds.push(subtask.id);

      // Publish event for agents to pick up
      await this.eventBus.publish('subtask:created', {
        id: uuidv4(),
        task_id: task.id,
        subtask_id: subtask.id,
        event_type: 'subtask:created',
        agent_role: step.assigned_role,
        payload: {
          subtask_id: subtask.id,
          title: step.title,
          description: step.description,
          role: step.assigned_role,
          risk_tier: step.risk_tier,
          workspace_root: task.workspace_root,
        },
        timestamp: new Date().toISOString(),
      });
    }

    this.emitTaskEvent(task.id, 'task:executing', {
      subtask_count: subtaskIds.length,
      subtask_ids: subtaskIds,
    });

    return updated;
  }

  /**
   * Decompose a user request into plan steps.
   * This is a structured rule-based decomposer.
   * Can be enhanced with LLM integration later.
   */
  private decomposeRequest(request: string): PlanStep[] {
    const lower = request.toLowerCase();
    const steps: PlanStep[] = [];
    let stepNum = 1;

    // Step 1: PM always analyzes requirements
    steps.push({
      step_number: stepNum++,
      title: 'Analyze requirements and success criteria',
      description: `Interpret the user request: "${request}". Define clear requirements, acceptance criteria, and constraints.`,
      assigned_role: 'product_manager',
      risk_tier: 'SAFE',
      depends_on: [],
    });

    // Step 2: Security review of the request
    steps.push({
      step_number: stepNum++,
      title: 'Security and safety review',
      description: 'Review the request for security implications. Identify any risky operations and define guardrails.',
      assigned_role: 'security',
      risk_tier: 'SAFE',
      depends_on: [1],
    });

    // Step 3: Architecture/design (if request involves code or system changes)
    if (this.involvesCode(lower) || this.involvesSystem(lower)) {
      steps.push({
        step_number: stepNum++,
        title: 'Design architecture and interfaces',
        description: 'Design the solution architecture, data models, interfaces, and component boundaries.',
        assigned_role: 'architect',
        risk_tier: 'SAFE',
        depends_on: [1, 2],
      });
    }

    // Step 4: Implementation
    steps.push({
      step_number: stepNum++,
      title: 'Implement the solution',
      description: `Execute the core implementation based on requirements and design. Request: "${request}"`,
      assigned_role: 'implementer',
      risk_tier: this.assessRequestRisk(lower),
      depends_on: steps.map(s => s.step_number),
    });

    // Step 5: Testing
    steps.push({
      step_number: stepNum++,
      title: 'Test and verify',
      description: 'Create test plan, run tests, verify behavior meets acceptance criteria.',
      assigned_role: 'qa_tester',
      risk_tier: 'SAFE',
      depends_on: [stepNum - 2],
    });

    // Step 6: Documentation
    steps.push({
      step_number: stepNum++,
      title: 'Document changes and results',
      description: 'Write documentation for any changes made. Create user-friendly summary.',
      assigned_role: 'docs_trainer',
      risk_tier: 'SAFE',
      depends_on: [stepNum - 2],
    });

    return steps;
  }

  private interpretObjective(request: string): string {
    // Simple heuristic interpretation
    const lower = request.toLowerCase();
    if (lower.includes('fix') || lower.includes('bug')) {
      return `Fix the issue described in: "${request}"`;
    }
    if (lower.includes('add') || lower.includes('create') || lower.includes('build')) {
      return `Build/create as described: "${request}"`;
    }
    if (lower.includes('refactor') || lower.includes('improve')) {
      return `Improve/refactor as described: "${request}"`;
    }
    if (lower.includes('test')) {
      return `Create tests as described: "${request}"`;
    }
    if (lower.includes('explain') || lower.includes('review')) {
      return `Review and explain: "${request}"`;
    }
    return `Complete the following: "${request}"`;
  }

  private generateAssumptions(request: string): string[] {
    const assumptions: string[] = [
      'Working within the configured workspace directory',
      'Using existing project conventions and patterns',
      'Safe operations will proceed without approval',
    ];

    const lower = request.toLowerCase();
    if (this.involvesCode(lower)) {
      assumptions.push('Code follows existing project style and conventions');
      assumptions.push('Tests should be run after implementation');
    }
    if (lower.includes('install') || lower.includes('dependency')) {
      assumptions.push('Package installations will use the project\'s package manager');
    }
    return assumptions;
  }

  private involvesCode(request: string): boolean {
    const codeKeywords = ['code', 'function', 'class', 'implement', 'build', 'feature',
      'component', 'api', 'endpoint', 'service', 'module', 'file', 'script'];
    return codeKeywords.some(kw => request.includes(kw));
  }

  private involvesSystem(request: string): boolean {
    const systemKeywords = ['deploy', 'config', 'server', 'database', 'docker',
      'infrastructure', 'ci', 'pipeline', 'environment'];
    return systemKeywords.some(kw => request.includes(kw));
  }

  private assessRequestRisk(request: string): RiskTier {
    const dangerousKeywords = ['delete', 'remove all', 'drop', 'format', 'destroy'];
    const cautionKeywords = ['install', 'update', 'upgrade', 'migrate', 'rename', 'move'];

    if (dangerousKeywords.some(kw => request.includes(kw))) return 'DANGEROUS';
    if (cautionKeywords.some(kw => request.includes(kw))) return 'CAUTION';
    return 'SAFE';
  }

  // --- Event Handlers ---

  private async handleSubtaskUpdate(event: DCAEvent): Promise<void> {
    const { subtask_id, status, message } = event.payload as {
      subtask_id: string; status: string; message: string
    };

    this.wsManager.broadcastToTask(event.task_id, {
      type: 'subtask:update',
      subtask_id,
      agent_role: event.agent_role,
      status,
      message,
    });
  }

  private async handleSubtaskComplete(event: DCAEvent): Promise<void> {
    const taskId = event.task_id;
    const subtaskId = event.subtask_id;

    if (subtaskId) {
      await this.memory.updateSubtask(subtaskId, { status: 'completed' });
    }

    this.wsManager.broadcastToTask(taskId, {
      type: 'subtask:complete',
      subtask_id: subtaskId,
      agent_role: event.agent_role,
    });

    // Check if all subtasks are done
    await this.checkTaskCompletion(taskId);
  }

  private async handleApprovalNeeded(event: DCAEvent): Promise<void> {
    this.wsManager.broadcastToTask(event.task_id, {
      type: 'approval:needed',
      subtask_id: event.subtask_id,
      agent_role: event.agent_role,
      payload: event.payload,
    });
  }

  private async handleRiskFlagged(event: DCAEvent): Promise<void> {
    this.wsManager.broadcastToTask(event.task_id, {
      type: 'risk:flagged',
      subtask_id: event.subtask_id,
      agent_role: event.agent_role,
      payload: event.payload,
    });
  }

  /**
   * Check if all subtasks for a task are complete, and if so, generate the result packet.
   */
  async checkTaskCompletion(taskId: string): Promise<void> {
    const subtasks = await this.memory.getSubtasksForTask(taskId);
    const allDone = subtasks.every(s => s.status === 'completed' || s.status === 'failed' || s.status === 'skipped');

    if (!allDone) return;

    // Generate result packet
    const resultPacket = await this.generateResultPacket(taskId, subtasks);
    await this.memory.updateTask(taskId, {
      status: 'completed',
      result_packet: resultPacket,
    });

    this.emitTaskEvent(taskId, 'task:completed', { result_packet: resultPacket });
  }

  private async generateResultPacket(taskId: string, subtasks: Subtask[]): Promise<ResultPacket> {
    const fileChanges = await this.memory.getFileChanges(taskId);
    const commands = await this.memory.getCommands(taskId);
    const decisions = await this.memory.getDecisions(taskId);
    const messages = await this.memory.getMessages(taskId);

    const failedSubtasks = subtasks.filter(s => s.status === 'failed');

    return {
      summary: this.buildSummary(subtasks, messages),
      files_changed: fileChanges.map(fc => ({
        path: fc.file_path,
        operation: fc.operation,
        diff: fc.diff,
      })),
      commands_executed: commands.map(c => ({
        command: c.command,
        exit_code: c.exit_code || 0,
      })),
      test_results: subtasks
        .filter(s => s.assigned_role === 'qa_tester')
        .flatMap(s => s.artifacts
          .filter(a => a.type === 'test_result')
          .map(a => ({
            name: a.name,
            passed: a.metadata?.passed === true,
            output: a.content,
          }))
        ),
      decisions_made: decisions.map(d => ({
        decision: d.decision,
        reasoning: d.reasoning || '',
      })),
      remaining_todos: failedSubtasks.map(s => `[FAILED] ${s.title}: ${s.error || 'Unknown error'}`),
      next_suggestions: this.generateNextSuggestions(subtasks, failedSubtasks),
    };
  }

  private buildSummary(subtasks: Subtask[], messages: Array<{ content: string; role: string }>): string {
    const completed = subtasks.filter(s => s.status === 'completed').length;
    const failed = subtasks.filter(s => s.status === 'failed').length;
    const total = subtasks.length;

    let summary = `Completed ${completed} of ${total} subtasks.`;
    if (failed > 0) {
      summary += ` ${failed} subtask(s) failed.`;
    }

    // Add key messages from PM and docs roles
    const keyMessages = messages
      .filter(m => m.role === 'product_manager' || m.role === 'docs_trainer')
      .slice(-3)
      .map(m => m.content);

    if (keyMessages.length > 0) {
      summary += '\n\nKey notes:\n' + keyMessages.map(m => `- ${m}`).join('\n');
    }

    return summary;
  }

  private generateNextSuggestions(subtasks: Subtask[], failedSubtasks: Subtask[]): string[] {
    const suggestions: string[] = [];
    if (failedSubtasks.length > 0) {
      suggestions.push('Retry failed subtasks after reviewing errors');
    }
    if (subtasks.some(s => s.assigned_role === 'qa_tester' && s.status === 'completed')) {
      suggestions.push('Review test results and add more test coverage if needed');
    }
    suggestions.push('Review the generated diffs and commit if satisfactory');
    return suggestions;
  }

  /**
   * Approve a subtask and resume its execution
   */
  async approveSubtask(taskId: string, subtaskId: string): Promise<void> {
    await this.memory.updateSubtask(subtaskId, { status: 'assigned' });
    await this.eventBus.publish('subtask:approved', {
      id: uuidv4(),
      task_id: taskId,
      subtask_id: subtaskId,
      event_type: 'subtask:approved',
      payload: { approved: true },
      timestamp: new Date().toISOString(),
    });
    this.emitTaskEvent(taskId, 'subtask:approved', { subtask_id: subtaskId });
  }

  private emitTaskEvent(taskId: string, eventType: string, payload: Record<string, unknown>): void {
    this.wsManager.broadcastToTask(taskId, { type: eventType, ...payload });
    this.memory.addEvent({
      task_id: taskId,
      event_type: eventType,
      agent_role: 'orchestrator',
      payload,
    }).catch(err => console.error('[coordinator] Failed to persist event:', err));
  }
}
