// ─────────────────────────────────────────────────────────────────────────────
// Sovereign Console Local Agent — Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

// ── Agent Commands (inbound from broker) ────────────────────────────────────

export interface TaskRequest {
  type: "task";
  requestId: string;
  sessionId: string;
  projectName: string;
  description: string;
  /** Optional list of file paths to focus on */
  focusFiles?: string[];
  /** Optional max tokens override (capped by config) */
  maxTokens?: number;
}

export interface FileReadRequest {
  type: "file_read";
  requestId: string;
  sessionId: string;
  projectName: string;
  filePath: string;
  /** Optional line range */
  startLine?: number;
  endLine?: number;
}

export interface FileBrowseRequest {
  type: "file_browse";
  requestId: string;
  sessionId: string;
  projectName: string;
  relativePath: string;
  /** Max depth for recursive listing (default 1) */
  depth?: number;
}

export interface FileWriteRequest {
  type: "file_write";
  requestId: string;
  sessionId: string;
  projectName: string;
  filePath: string;
  content: string;
  approvalToken: ApprovalToken;
}

export interface DiffRequest {
  type: "file_diff";
  requestId: string;
  sessionId: string;
  projectName: string;
  filePath: string;
  proposedContent: string;
}

export interface ProjectListRequest {
  type: "project_list";
  requestId: string;
  sessionId: string;
}

export interface StatusRequest {
  type: "status";
  requestId: string;
  sessionId: string;
}

export type AgentCommand =
  | TaskRequest
  | FileReadRequest
  | FileBrowseRequest
  | FileWriteRequest
  | DiffRequest
  | ProjectListRequest
  | StatusRequest;

// ── Agent Responses (outbound to broker) ────────────────────────────────────

export interface SuccessResponse<T = unknown> {
  status: "success";
  requestId: string;
  data: T;
  timestamp: string;
}

export interface ErrorResponse {
  status: "error";
  requestId: string;
  error: {
    code: string;
    message: string;
    details?: string;
  };
  timestamp: string;
}

export type AgentResponse<T = unknown> = SuccessResponse<T> | ErrorResponse;

// ── Task Results ────────────────────────────────────────────────────────────

export interface TaskResult {
  output: string;
  tokensUsed: {
    input: number;
    output: number;
    total: number;
  };
  durationMs: number;
  /** Files read or modified during the task */
  filesReferenced: string[];
}

// ── File Operation Results ──────────────────────────────────────────────────

export interface FileContent {
  filePath: string;
  content: string;
  sizeBytes: number;
  lastModified: string;
  mimeType: string;
  lineCount: number;
  /** True if content was truncated to line range */
  truncated: boolean;
}

export interface DirectoryEntry {
  name: string;
  type: "file" | "directory" | "symlink";
  sizeBytes: number;
  lastModified: string;
}

export interface DirectoryListing {
  path: string;
  entries: DirectoryEntry[];
  totalEntries: number;
}

export interface DiffResult {
  filePath: string;
  diff: string;
  linesAdded: number;
  linesRemoved: number;
  /** Whether the file currently exists */
  isNewFile: boolean;
}

export interface FileWriteResult {
  filePath: string;
  bytesWritten: number;
  timestamp: string;
}

// ── Project Manifest ────────────────────────────────────────────────────────

export interface ProjectManifest {
  name: string;
  description?: string;
  /** Key entry-point files or directories */
  entryPoints?: string[];
  /** File patterns to always include in context */
  alwaysInclude?: string[];
  /** File patterns to never include in context */
  alwaysExclude?: string[];
  /** Custom governance overrides (tighter only, never looser) */
  governance?: {
    protectedPaths?: string[];
    maxFileWriteSize?: number;
  };
}

// ── Governance ──────────────────────────────────────────────────────────────

export interface GovernanceRules {
  protected_paths: string[];
  allowed_operations: string[];
  max_file_read_size_bytes: number;
  max_file_write_size_bytes: number;
  max_tasks_per_session: number;
  max_tokens_per_task: number;
  rate_limit_per_minute: number;
  require_approval_for: string[];
}

export interface GovernanceViolation {
  rule: string;
  message: string;
  severity: "block" | "warn";
}

// ── Approval Token ──────────────────────────────────────────────────────────

export interface ApprovalToken {
  tokenId: string;
  action: string;
  resourcePath: string;
  sessionId: string;
  issuedAt: string;
  expiresAt: string;
  issuedBy: string;
  /** HMAC signature from the broker */
  signature: string;
  /** Fingerprint of the approving device */
  deviceFingerprint: string;
}

// ── Secret Patterns ─────────────────────────────────────────────────────────

export interface SecretPattern {
  name: string;
  pattern: RegExp;
  /** Replacement text (default: [REDACTED]) */
  replacement?: string;
}

// ── Connection State ────────────────────────────────────────────────────────

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

// ── Token Usage Tracking ────────────────────────────────────────────────────

export interface TokenUsageRecord {
  sessionId: string;
  taskId: string;
  inputTokens: number;
  outputTokens: number;
  timestamp: string;
}

export interface SessionUsageSummary {
  sessionId: string;
  totalTasks: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
}

export interface DailyUsageSummary {
  date: string;
  totalTokens: number;
  totalTasks: number;
}

// ── Agent Status ────────────────────────────────────────────────────────────

export interface AgentStatus {
  agentId: string;
  connectionState: ConnectionState;
  uptime: number;
  activeTaskCount: number;
  sessionUsage: SessionUsageSummary | null;
  dailyUsage: DailyUsageSummary;
  projectsAvailable: string[];
  version: string;
}
