// ─────────────────────────────────────────────────────────────────────────────
// Sovereign Console UI — API Client
// ─────────────────────────────────────────────────────────────────────────────

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export interface Session {
  id: string;
  operator_id: string;
  device_id: string;
  deviceName: string;
  created_at: string;
  expires_at: string;
  expiresAt: string;
}

export interface Device {
  id: string;
  name: string;
  type: string;
  status: 'enrolled' | 'pending' | 'revoked';
  last_seen: string | null;
  lastSeen: string | null;
  created_at: string;
  enrolledAt: string;
  fingerprint: string;
  security_flags: string[];
  passkeyBound: boolean;
  platformBinding: string;
  riskFlags: string[];
}

export interface SystemStatus {
  broker: 'online' | 'degraded' | 'offline';
  agent: 'connected' | 'disconnected';
  agentOnline: boolean;
  agentLastSeen: string | null;
  database: 'healthy' | 'unhealthy';
  redis: 'healthy' | 'unhealthy';
  uptime_seconds: number;
  queuedCommands: number;
}

export interface TokenUsage {
  session: {
    input_tokens: number;
    output_tokens: number;
    task_count: number;
    max_tasks: number;
  };
  daily: {
    input_tokens: number;
    output_tokens: number;
    task_count: number;
    spend_threshold: number;
  };
  sessionTotal: number;
  dailyTotal: number;
  budgetLimit: number;
  budgetRemaining: number;
  perTask: Array<{ id: string; tokens: number; model: string; timestamp: string }>;
}

export interface Task {
  id: string;
  type: string;
  status: 'queued' | 'executing' | 'completed' | 'cancelled' | 'failed';
  queued_at: string;
  createdAt: string;
  completed_at: string | null;
  result?: Record<string, unknown>;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  status: string;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileEntry[];
}

export interface FileContent {
  path: string;
  content: string;
  size: number;
  encoding: string;
  redacted: boolean;
}

export interface AuditEntry {
  id: string;
  event_type: string;
  eventType: string;
  action: string;
  operator_id?: string;
  device_id?: string;
  deviceName?: string;
  session_id?: string;
  resource?: string;
  detail?: Record<string, unknown>;
  details?: Record<string, unknown>;
  ip_address: string;
  hash: string;
  chainHash: string;
  prev_hash: string | null;
  previousHash: string | null;
  timestamp: string;
  integrityVerified: boolean;
}

export interface AuditPage {
  entries: AuditEntry[];
  total: number;
  page: number;
  per_page: number;
  pageSize: number;
}

export interface ApprovalToken {
  id: string;
  action_type: string;
  resource_path: string;
  operation: string;
  status: 'pending' | 'approved' | 'rejected' | 'used' | 'expired';
  issued_at: string;
  expires_at: string;
  approved_at?: string;
  approved_by_device_id?: string;
  nonce?: string;
}

type ApiResponse<T> = { data: T; error?: never } | { data?: never; error: string };

async function request<T>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: (body as { error?: string }).error ?? `HTTP ${res.status}` };
    }

    const data = (await res.json()) as T;
    return { data };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export const api = {
  auth: {
    session: () => request<Session>('/api/auth/session'),
    provisionTotp: () => request<{ secret: string; otpauthUri: string }>('/api/auth/totp/provision', { method: 'POST' }),
  },

  enrollment: {
    verify: (code: string) => request<{ valid: boolean }>(`/api/enrollment/verify`, { method: 'POST', body: JSON.stringify({ code }) }),
    complete: (data: { code: string; credential: unknown }) =>
      request<{ device_id: string }>('/api/enrollment/complete', { method: 'POST', body: JSON.stringify(data) }),
  },

  devices: {
    list: () => request<Device[]>('/api/devices'),
    revoke: (id: string) => request<void>(`/api/devices/${id}/revoke`, { method: 'POST' }),
    reenroll: (id: string) => request<void>(`/api/devices/${id}/reenroll`, { method: 'POST' }),
    generateRecovery: () => request<{ recovery_code: string; codes: string[] }>('/api/devices/recovery', { method: 'POST' }),
  },

  tasks: {
    list: () => request<Task[]>('/api/tasks/session'),
    create: (task: Record<string, unknown>) =>
      request<{ id: string; task_id: string; status: string }>('/api/tasks', { method: 'POST', body: JSON.stringify(task) }),
    cancel: (id: string) => request<void>(`/api/tasks/${id}/cancel`, { method: 'POST', body: JSON.stringify({}) }),
    usage: () => request<TokenUsage>('/api/tasks/usage'),
    estimateTokens: (prompt: string) => request<{ estimated: number; estimated_tokens: number }>('/api/tasks/estimate', { method: 'POST', body: JSON.stringify({ prompt }) }),
  },

  files: {
    tree: (project: string) => request<FileEntry[]>(`/api/files/tree?project=${encodeURIComponent(project)}`),
    content: (project: string, filePath: string) =>
      request<FileContent>(`/api/files/content?project=${encodeURIComponent(project)}&path=${encodeURIComponent(filePath)}`),
    diff: (project: string, filePath: string) =>
      request<{ diff: string }>(`/api/files/diff?project=${encodeURIComponent(project)}&path=${encodeURIComponent(filePath)}`),
  },

  audit: {
    list: (params: { page?: number; per_page?: number; pageSize?: number; event_type?: string }) => {
      const qs = new URLSearchParams();
      if (params.page) qs.set('page', String(params.page));
      if (params.per_page || params.pageSize) qs.set('per_page', String(params.per_page ?? params.pageSize));
      if (params.event_type) qs.set('event_type', params.event_type);
      return request<AuditPage>(`/api/audit?${qs.toString()}`);
    },
    verifyChain: () => request<{ valid: boolean; checked: number; errors: string[] }>('/api/audit/verify'),
    export: (params: { format?: string }) =>
      request<{ url: string }>(`/api/audit/export?format=${params.format ?? 'json'}`),
  },

  approvals: {
    get: (id: string) => request<ApprovalToken>(`/api/approval/${id}/status`),
    approve: (id: string, deviceId: string) =>
      request<ApprovalToken>(`/api/approval/${id}/approve`, { method: 'POST', body: JSON.stringify({ device_id: deviceId }) }),
    reject: (id: string, deviceId?: string, reason?: string) =>
      request<void>(`/api/approval/${id}/reject`, { method: 'POST', body: JSON.stringify({ device_id: deviceId, reason }) }),
    pending: () => request<{ pending: ApprovalToken[] }>('/api/approval/pending'),
  },

  system: {
    health: () => request<SystemStatus>('/api/system/health'),
    projects: () => request<Project[]>('/api/system/projects'),
    emergencyDisable: () => request<void>('/api/system/emergency-disable', { method: 'POST' }),
  },
};
