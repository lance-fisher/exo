import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import type {
  Task,
  Subtask,
  AgentMessage,
  FileChange,
  CommandEntry,
  DecisionEntry,
  TaskEvent,
  TaskStatus,
  SubtaskStatus,
  RiskTier,
  ApprovalState,
  Artifact,
  PlanStep,
  ResultPacket,
  AgentRole,
} from '../schema/types';

export class MemoryStore {
  constructor(private pool: Pool) {}

  // --- Tasks ---

  async createTask(userRequest: string, workspaceRoot?: string): Promise<Task> {
    const id = uuidv4();
    const result = await this.pool.query(
      `INSERT INTO tasks (id, user_request, workspace_root) VALUES ($1, $2, $3) RETURNING *`,
      [id, userRequest, workspaceRoot]
    );
    return this.mapTask(result.rows[0]);
  }

  async getTask(id: string): Promise<Task | null> {
    const result = await this.pool.query(`SELECT * FROM tasks WHERE id = $1`, [id]);
    return result.rows[0] ? this.mapTask(result.rows[0]) : null;
  }

  async listTasks(limit = 50): Promise<Task[]> {
    const result = await this.pool.query(
      `SELECT * FROM tasks ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows.map(row => this.mapTask(row));
  }

  async updateTask(id: string, updates: Partial<Pick<Task, 'interpreted_objective' | 'assumptions' | 'plan' | 'status' | 'risk_tier' | 'result_packet'>>): Promise<Task> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (updates.interpreted_objective !== undefined) {
      fields.push(`interpreted_objective = $${idx++}`);
      values.push(updates.interpreted_objective);
    }
    if (updates.assumptions !== undefined) {
      fields.push(`assumptions = $${idx++}`);
      values.push(JSON.stringify(updates.assumptions));
    }
    if (updates.plan !== undefined) {
      fields.push(`plan = $${idx++}`);
      values.push(JSON.stringify(updates.plan));
    }
    if (updates.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(updates.status);
    }
    if (updates.risk_tier !== undefined) {
      fields.push(`risk_tier = $${idx++}`);
      values.push(updates.risk_tier);
    }
    if (updates.result_packet !== undefined) {
      fields.push(`result_packet = $${idx++}`);
      values.push(JSON.stringify(updates.result_packet));
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const result = await this.pool.query(
      `UPDATE tasks SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return this.mapTask(result.rows[0]);
  }

  // --- Subtasks ---

  async createSubtask(taskId: string, data: {
    title: string;
    description?: string;
    assigned_role: AgentRole;
    risk_tier?: RiskTier;
    depends_on?: string[];
    priority?: number;
  }): Promise<Subtask> {
    const id = uuidv4();
    const result = await this.pool.query(
      `INSERT INTO subtasks (id, task_id, title, description, assigned_role, risk_tier, depends_on, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        id,
        taskId,
        data.title,
        data.description || null,
        data.assigned_role,
        data.risk_tier || 'SAFE',
        data.depends_on || [],
        data.priority || 0,
      ]
    );
    return this.mapSubtask(result.rows[0]);
  }

  async getSubtask(id: string): Promise<Subtask | null> {
    const result = await this.pool.query(`SELECT * FROM subtasks WHERE id = $1`, [id]);
    return result.rows[0] ? this.mapSubtask(result.rows[0]) : null;
  }

  async getSubtasksForTask(taskId: string): Promise<Subtask[]> {
    const result = await this.pool.query(
      `SELECT * FROM subtasks WHERE task_id = $1 ORDER BY priority DESC, created_at ASC`,
      [taskId]
    );
    return result.rows.map(row => this.mapSubtask(row));
  }

  async getSubtasksByRole(role: AgentRole, status?: SubtaskStatus): Promise<Subtask[]> {
    let query = `SELECT * FROM subtasks WHERE assigned_role = $1`;
    const params: unknown[] = [role];
    if (status) {
      query += ` AND status = $2`;
      params.push(status);
    }
    query += ` ORDER BY priority DESC, created_at ASC`;
    const result = await this.pool.query(query, params);
    return result.rows.map(row => this.mapSubtask(row));
  }

  async updateSubtask(id: string, updates: Partial<Pick<Subtask, 'status' | 'artifacts' | 'error'>>): Promise<Subtask> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (updates.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(updates.status);
      if (updates.status === 'in_progress') {
        fields.push(`started_at = NOW()`);
      } else if (updates.status === 'completed' || updates.status === 'failed') {
        fields.push(`completed_at = NOW()`);
      }
    }
    if (updates.artifacts !== undefined) {
      fields.push(`artifacts = $${idx++}`);
      values.push(JSON.stringify(updates.artifacts));
    }
    if (updates.error !== undefined) {
      fields.push(`error = $${idx++}`);
      values.push(updates.error);
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const result = await this.pool.query(
      `UPDATE subtasks SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return this.mapSubtask(result.rows[0]);
  }

  // --- Agent Messages ---

  async addMessage(data: {
    task_id: string;
    subtask_id?: string;
    role: AgentRole;
    message_type: AgentMessage['message_type'];
    content: string;
    attachments?: Artifact[];
  }): Promise<AgentMessage> {
    const id = uuidv4();
    const result = await this.pool.query(
      `INSERT INTO agent_messages (id, task_id, subtask_id, role, message_type, content, attachments)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        id,
        data.task_id,
        data.subtask_id || null,
        data.role,
        data.message_type,
        data.content,
        JSON.stringify(data.attachments || []),
      ]
    );
    return this.mapMessage(result.rows[0]);
  }

  async getMessages(taskId: string, limit = 100): Promise<AgentMessage[]> {
    const result = await this.pool.query(
      `SELECT * FROM agent_messages WHERE task_id = $1 ORDER BY created_at ASC LIMIT $2`,
      [taskId, limit]
    );
    return result.rows.map(row => this.mapMessage(row));
  }

  // --- File Changes ---

  async addFileChange(data: {
    task_id: string;
    subtask_id?: string;
    file_path: string;
    operation: FileChange['operation'];
    diff?: string;
    reason?: string;
    backup_path?: string;
  }): Promise<FileChange> {
    const id = uuidv4();
    const autoApprove = this.getFileChangeRisk(data.operation) === 'SAFE';
    const result = await this.pool.query(
      `INSERT INTO file_changes (id, task_id, subtask_id, file_path, operation, diff, reason, approval_state, backup_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        id,
        data.task_id,
        data.subtask_id || null,
        data.file_path,
        data.operation,
        data.diff || null,
        data.reason || null,
        autoApprove ? 'auto_approved' : 'pending',
        data.backup_path || null,
      ]
    );
    return this.mapFileChange(result.rows[0]);
  }

  async updateFileChangeApproval(id: string, state: ApprovalState, approvedBy?: string): Promise<FileChange> {
    const result = await this.pool.query(
      `UPDATE file_changes SET approval_state = $1, approved_by = $2 WHERE id = $3 RETURNING *`,
      [state, approvedBy || null, id]
    );
    return this.mapFileChange(result.rows[0]);
  }

  async getFileChanges(taskId: string): Promise<FileChange[]> {
    const result = await this.pool.query(
      `SELECT * FROM file_changes WHERE task_id = $1 ORDER BY created_at ASC`,
      [taskId]
    );
    return result.rows.map(row => this.mapFileChange(row));
  }

  // --- Command Ledger ---

  async addCommand(data: {
    task_id: string;
    subtask_id?: string;
    agent_role: AgentRole;
    command: string;
    cwd?: string;
    exit_code?: number;
    stdout?: string;
    stderr?: string;
    duration_ms?: number;
  }): Promise<CommandEntry> {
    const id = uuidv4();
    const result = await this.pool.query(
      `INSERT INTO command_ledger (id, task_id, subtask_id, agent_role, command, cwd, exit_code, stdout, stderr, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        id,
        data.task_id,
        data.subtask_id || null,
        data.agent_role,
        data.command,
        data.cwd || null,
        data.exit_code ?? null,
        data.stdout || null,
        data.stderr || null,
        data.duration_ms ?? null,
      ]
    );
    return this.mapCommand(result.rows[0]);
  }

  async getCommands(taskId: string): Promise<CommandEntry[]> {
    const result = await this.pool.query(
      `SELECT * FROM command_ledger WHERE task_id = $1 ORDER BY created_at ASC`,
      [taskId]
    );
    return result.rows.map(row => this.mapCommand(row));
  }

  // --- Decision Log ---

  async addDecision(data: {
    task_id: string;
    subtask_id?: string;
    agent_role: AgentRole;
    decision: string;
    reasoning?: string;
    alternatives?: Array<{ option: string; pros: string[]; cons: string[] }>;
  }): Promise<DecisionEntry> {
    const id = uuidv4();
    const result = await this.pool.query(
      `INSERT INTO decision_log (id, task_id, subtask_id, agent_role, decision, reasoning, alternatives)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        id,
        data.task_id,
        data.subtask_id || null,
        data.agent_role,
        data.decision,
        data.reasoning || null,
        JSON.stringify(data.alternatives || []),
      ]
    );
    return this.mapDecision(result.rows[0]);
  }

  async getDecisions(taskId: string): Promise<DecisionEntry[]> {
    const result = await this.pool.query(
      `SELECT * FROM decision_log WHERE task_id = $1 ORDER BY created_at ASC`,
      [taskId]
    );
    return result.rows.map(row => this.mapDecision(row));
  }

  // --- Events ---

  async addEvent(data: {
    task_id: string;
    subtask_id?: string;
    event_type: string;
    agent_role?: AgentRole;
    payload?: Record<string, unknown>;
  }): Promise<TaskEvent> {
    const id = uuidv4();
    const result = await this.pool.query(
      `INSERT INTO events (id, task_id, subtask_id, event_type, agent_role, payload)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        id,
        data.task_id,
        data.subtask_id || null,
        data.event_type,
        data.agent_role || null,
        JSON.stringify(data.payload || {}),
      ]
    );
    return this.mapEvent(result.rows[0]);
  }

  async getEvents(taskId: string, since?: Date): Promise<TaskEvent[]> {
    let query = `SELECT * FROM events WHERE task_id = $1`;
    const params: unknown[] = [taskId];
    if (since) {
      query += ` AND created_at > $2`;
      params.push(since.toISOString());
    }
    query += ` ORDER BY created_at ASC`;
    const result = await this.pool.query(query, params);
    return result.rows.map(row => this.mapEvent(row));
  }

  // --- Helpers ---

  private getFileChangeRisk(operation: string): RiskTier {
    switch (operation) {
      case 'create':
      case 'modify':
        return 'SAFE';
      case 'rename':
      case 'move':
        return 'CAUTION';
      case 'delete':
        return 'DANGEROUS';
      default:
        return 'CAUTION';
    }
  }

  private mapTask(row: Record<string, unknown>): Task {
    return {
      id: row.id as string,
      user_request: row.user_request as string,
      interpreted_objective: row.interpreted_objective as string | undefined,
      assumptions: (row.assumptions as string[]) || [],
      plan: (row.plan as PlanStep[]) || [],
      status: row.status as TaskStatus,
      risk_tier: row.risk_tier as RiskTier,
      result_packet: row.result_packet as ResultPacket | undefined,
      workspace_root: row.workspace_root as string | undefined,
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
    };
  }

  private mapSubtask(row: Record<string, unknown>): Subtask {
    return {
      id: row.id as string,
      task_id: row.task_id as string,
      title: row.title as string,
      description: row.description as string | undefined,
      assigned_role: row.assigned_role as AgentRole,
      status: row.status as SubtaskStatus,
      risk_tier: row.risk_tier as RiskTier,
      depends_on: (row.depends_on as string[]) || [],
      priority: row.priority as number,
      artifacts: (row.artifacts as Artifact[]) || [],
      error: row.error as string | undefined,
      started_at: row.started_at ? new Date(row.started_at as string) : undefined,
      completed_at: row.completed_at ? new Date(row.completed_at as string) : undefined,
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
    };
  }

  private mapMessage(row: Record<string, unknown>): AgentMessage {
    return {
      id: row.id as string,
      task_id: row.task_id as string,
      subtask_id: row.subtask_id as string | undefined,
      role: row.role as AgentRole,
      message_type: row.message_type as AgentMessage['message_type'],
      content: row.content as string,
      attachments: (row.attachments as Artifact[]) || [],
      created_at: new Date(row.created_at as string),
    };
  }

  private mapFileChange(row: Record<string, unknown>): FileChange {
    return {
      id: row.id as string,
      task_id: row.task_id as string,
      subtask_id: row.subtask_id as string | undefined,
      file_path: row.file_path as string,
      operation: row.operation as FileChange['operation'],
      diff: row.diff as string | undefined,
      reason: row.reason as string | undefined,
      approval_state: row.approval_state as ApprovalState,
      approved_by: row.approved_by as string | undefined,
      backup_path: row.backup_path as string | undefined,
      created_at: new Date(row.created_at as string),
    };
  }

  private mapCommand(row: Record<string, unknown>): CommandEntry {
    return {
      id: row.id as string,
      task_id: row.task_id as string,
      subtask_id: row.subtask_id as string | undefined,
      agent_role: row.agent_role as AgentRole,
      command: row.command as string,
      cwd: row.cwd as string | undefined,
      exit_code: row.exit_code as number | undefined,
      stdout: row.stdout as string | undefined,
      stderr: row.stderr as string | undefined,
      duration_ms: row.duration_ms as number | undefined,
      created_at: new Date(row.created_at as string),
    };
  }

  private mapDecision(row: Record<string, unknown>): DecisionEntry {
    return {
      id: row.id as string,
      task_id: row.task_id as string,
      subtask_id: row.subtask_id as string | undefined,
      agent_role: row.agent_role as AgentRole,
      decision: row.decision as string,
      reasoning: row.reasoning as string | undefined,
      alternatives: (row.alternatives as DecisionEntry['alternatives']) || [],
      created_at: new Date(row.created_at as string),
    };
  }

  private mapEvent(row: Record<string, unknown>): TaskEvent {
    return {
      id: row.id as string,
      task_id: row.task_id as string,
      subtask_id: row.subtask_id as string | undefined,
      event_type: row.event_type as string,
      agent_role: row.agent_role as AgentRole | undefined,
      payload: (row.payload as Record<string, unknown>) || {},
      created_at: new Date(row.created_at as string),
    };
  }
}
