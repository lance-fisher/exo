const API_BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export interface Task {
  id: string;
  user_request: string;
  interpreted_objective?: string;
  assumptions: string[];
  plan: Array<{
    step_number: number;
    title: string;
    description: string;
    assigned_role: string;
    risk_tier: string;
  }>;
  status: string;
  risk_tier: string;
  result_packet?: ResultPacket;
  created_at: string;
  updated_at: string;
}

export interface Subtask {
  id: string;
  task_id: string;
  title: string;
  description?: string;
  assigned_role: string;
  status: string;
  risk_tier: string;
  artifacts: Array<{ type: string; name: string; content: string }>;
  error?: string;
  created_at: string;
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

export interface TaskEvent {
  id: string;
  event_type: string;
  agent_role?: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export const api = {
  submitTask: (userRequest: string) =>
    request<{ id: string; status: string; message: string }>('/tasks', {
      method: 'POST',
      body: JSON.stringify({ request: userRequest }),
    }),

  listTasks: () =>
    request<{ tasks: Task[] }>('/tasks'),

  getTask: (id: string) =>
    request<{ task: Task; subtasks: Subtask[]; messages: Array<{ role: string; content: string; created_at: string }> }>(
      `/tasks/${id}`
    ),

  getEvents: (id: string, since?: string) =>
    request<{ events: TaskEvent[] }>(
      `/tasks/${id}/events${since ? `?since=${since}` : ''}`
    ),

  getResult: (id: string) =>
    request<{ result: ResultPacket }>(`/tasks/${id}/result`),

  approve: (taskId: string, subtaskId: string) =>
    request<{ message: string }>(`/tasks/${taskId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ subtask_id: subtaskId }),
    }),

  getStatus: () =>
    request<{ status: string; connected_clients: number }>('/status'),
};
