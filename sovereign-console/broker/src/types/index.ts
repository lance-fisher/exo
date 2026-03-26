// =============================================================================
// Sovereign Operator Console — Core Types
// =============================================================================

/** Operator identity — the single human user */
export interface Operator {
  id: string;
  username: string;
  created_at: Date;
}

/** Device type — only enrolled personal devices */
export type DeviceType = 'laptop' | 'iphone';

/** Device enrollment status */
export type DeviceStatus = 'pending' | 'enrolled' | 'revoked' | 'suspended';

/** Enrolled device */
export interface Device {
  id: string;
  operator_id: string;
  name: string;
  type: DeviceType;
  status: DeviceStatus;
  enrolled_at: Date;
  revoked_at: Date | null;
  fingerprint: string;
  platform_info: Record<string, unknown>;
  passkey_credential_id: string | null;
  mtls_cert_fingerprint: string | null;
  last_seen: Date | null;
  risk_flags: string[];
}

/** Device enrollment request */
export interface DeviceEnrollment {
  operator_id: string;
  name: string;
  type: DeviceType;
  fingerprint: string;
  platform_info: Record<string, unknown>;
}

/** Passkey credential stored for a device */
export interface PasskeyCredential {
  id: string;
  device_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string[];
  attestation_format: string;
  platform_bound: boolean;
  synced_status: 'synced' | 'device_bound' | 'unknown';
  created_at: Date;
  revoked_at: Date | null;
}

/** TOTP secret (encrypted at rest) */
export interface TotpSecret {
  id: string;
  operator_id: string;
  encrypted_secret: string;
  created_at: Date;
  revoked_at: Date | null;
}

/** Authenticated session */
export interface Session {
  id: string;
  operator_id: string;
  device_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  ip_address: string;
  user_agent: string;
}

/** Approval token action types */
export type ApprovalActionType = 'file_write' | 'file_delete' | 'shell_exec' | 'config_change' | 'deploy' | 'dangerous';

/** Approval token status lifecycle */
export type ApprovalTokenStatus = 'pending' | 'approved' | 'used' | 'rejected' | 'expired' | 'revoked';

/** Approval token per formal spec */
export interface ApprovalToken {
  id: string;
  action_type: ApprovalActionType;
  resource_path: string;
  operation: string;
  device_id: string;
  session_id: string;
  issued_at: Date;
  expires_at: Date;
  nonce: string;
  payload_hash: string;
  status: ApprovalTokenStatus;
  approved_by_device_id: string | null;
  approved_at: Date | null;
  used_at: Date | null;
  revoked_at: Date | null;
}

/** Parameters for creating an approval token */
export interface CreateApprovalTokenParams {
  action_type: ApprovalActionType;
  resource_path: string;
  operation: string;
  device_id: string;
  session_id: string;
  payload_hash: string;
  ttl_seconds: number;
}

/** Audit log event types */
export type AuditEventType =
  | 'auth.login'
  | 'auth.logout'
  | 'auth.passkey_register'
  | 'auth.passkey_revoke'
  | 'auth.totp_verify'
  | 'auth.totp_provision'
  | 'auth.totp_revoke'
  | 'auth.session_extend'
  | 'device.enroll'
  | 'device.revoke'
  | 'device.challenge'
  | 'device.recovery'
  | 'approval.request'
  | 'approval.approve'
  | 'approval.reject'
  | 'approval.expire'
  | 'approval.use'
  | 'task.submit'
  | 'task.complete'
  | 'task.cancel'
  | 'file.read'
  | 'file.write'
  | 'file.browse'
  | 'agent.connect'
  | 'agent.disconnect'
  | 'agent.command'
  | 'agent.response'
  | 'system.emergency_disable'
  | 'system.health_check';

/** Immutable audit log entry */
export interface AuditEntry {
  id: number;
  event_type: AuditEventType;
  operator_id: string | null;
  device_id: string | null;
  session_id: string | null;
  action: string;
  resource: string | null;
  detail: Record<string, unknown>;
  ip_address: string;
  timestamp: Date;
  prev_hash: string;
  entry_hash: string;
}

/** Command queue status lifecycle */
export type CommandStatus = 'queued' | 'pending_reconfirm' | 'confirmed' | 'executing' | 'completed' | 'expired' | 'rejected';

/** Command sent to the local agent */
export interface AgentCommand {
  id: string;
  type: 'task' | 'cancel' | 'status' | 'file_read' | 'file_write' | 'file_browse' | 'file_diff';
  payload: Record<string, unknown>;
  session_id: string;
  timestamp: Date;
}

/** Response received from the local agent */
export interface AgentResponse {
  id: string;
  command_id: string;
  type: 'result' | 'progress' | 'error' | 'status';
  payload: Record<string, unknown>;
  timestamp: Date;
}

/** Command in the queue */
export interface QueuedCommand {
  id: string;
  session_id: string;
  command: AgentCommand;
  status: CommandStatus;
  queued_at: Date;
  ttl_expires_at: Date;
  reconfirmed_at: Date | null;
  completed_at: Date | null;
  result: AgentResponse | null;
}

/** Task request from the console UI */
export interface TaskRequest {
  prompt: string;
  project_path: string;
  allowed_tools?: string[];
  max_tokens?: number;
  context_files?: string[];
}

/** Task execution result */
export interface TaskResult {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
  output: string | null;
  error: string | null;
  files_modified: string[];
  tokens_used: {
    input: number;
    output: number;
  };
  started_at: Date;
  completed_at: Date | null;
}

/** Agent registration record */
export interface AgentRegistration {
  id: string;
  name: string;
  fingerprint: string;
  mtls_cert_fingerprint: string;
  status: 'active' | 'revoked' | 'suspended';
  registered_at: Date;
  last_connected: Date | null;
  version: string;
}

/** Recovery code */
export interface RecoveryCode {
  id: string;
  operator_id: string;
  code_hash: string;
  used_at: Date | null;
  created_at: Date;
}

/** Token usage tracking */
export interface TokenUsage {
  id: string;
  session_id: string;
  task_id: string;
  input_tokens: number;
  output_tokens: number;
  model: string;
  timestamp: Date;
}

/** Fastify request augmentation for auth context */
export interface AuthContext {
  operator_id: string;
  device_id: string;
  session_id: string;
  session_expires_at: Date;
  passkey_verified: boolean;
  totp_verified: boolean;
}

/** SSE event for task streaming */
export interface TaskStreamEvent {
  type: 'progress' | 'output' | 'complete' | 'error';
  data: Record<string, unknown>;
  timestamp: Date;
}

/** Pagination parameters */
export interface PaginationParams {
  page: number;
  limit: number;
}

/** Paginated response wrapper */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}
