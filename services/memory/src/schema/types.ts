export type RiskTier = 'SAFE' | 'CAUTION' | 'DANGEROUS';
export type TaskStatus = 'pending' | 'planning' | 'awaiting_approval' | 'executing' | 'completed' | 'failed';
export type SubtaskStatus = 'pending' | 'assigned' | 'in_progress' | 'awaiting_approval' | 'completed' | 'failed' | 'skipped';
export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'auto_approved';

export type AgentRole =
  | 'orchestrator'
  | 'product_manager'
  | 'architect'
  | 'implementer'
  | 'qa_tester'
  | 'security'
  | 'docs_trainer'
  | 'performance';

export interface Task {
  id: string;
  user_request: string;
  interpreted_objective?: string;
  assumptions: string[];
  plan: PlanStep[];
  status: TaskStatus;
  risk_tier: RiskTier;
  result_packet?: ResultPacket;
  workspace_root?: string;
  created_at: Date;
  updated_at: Date;
}

export interface PlanStep {
  step_number: number;
  title: string;
  description: string;
  assigned_role: AgentRole;
  risk_tier: RiskTier;
  depends_on: number[];
}

export interface Subtask {
  id: string;
  task_id: string;
  title: string;
  description?: string;
  assigned_role: AgentRole;
  status: SubtaskStatus;
  risk_tier: RiskTier;
  depends_on: string[];
  priority: number;
  artifacts: Artifact[];
  error?: string;
  started_at?: Date;
  completed_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface Artifact {
  type: 'file' | 'diff' | 'log' | 'test_result' | 'document' | 'decision';
  name: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface AgentMessage {
  id: string;
  task_id: string;
  subtask_id?: string;
  role: AgentRole;
  message_type: 'info' | 'warning' | 'error' | 'approval_request' | 'decision' | 'artifact' | 'status_update';
  content: string;
  attachments: Artifact[];
  created_at: Date;
}

export interface FileChange {
  id: string;
  task_id: string;
  subtask_id?: string;
  file_path: string;
  operation: 'create' | 'modify' | 'delete' | 'rename' | 'move';
  diff?: string;
  reason?: string;
  approval_state: ApprovalState;
  approved_by?: string;
  backup_path?: string;
  created_at: Date;
}

export interface CommandEntry {
  id: string;
  task_id: string;
  subtask_id?: string;
  agent_role: AgentRole;
  command: string;
  cwd?: string;
  exit_code?: number;
  stdout?: string;
  stderr?: string;
  duration_ms?: number;
  created_at: Date;
}

export interface DecisionEntry {
  id: string;
  task_id: string;
  subtask_id?: string;
  agent_role: AgentRole;
  decision: string;
  reasoning?: string;
  alternatives: Array<{ option: string; pros: string[]; cons: string[] }>;
  created_at: Date;
}

export interface TaskEvent {
  id: string;
  task_id: string;
  subtask_id?: string;
  event_type: string;
  agent_role?: AgentRole;
  payload: Record<string, unknown>;
  created_at: Date;
}

export interface ResultPacket {
  summary: string;
  files_changed: Array<{ path: string; operation: string; diff?: string }>;
  commands_executed: Array<{ command: string; exit_code: number }>;
  test_results: Array<{ name: string; passed: boolean; output?: string }>;
  decisions_made: Array<{ decision: string; reasoning: string }>;
  remaining_todos: string[];
  next_suggestions: string[];
}
