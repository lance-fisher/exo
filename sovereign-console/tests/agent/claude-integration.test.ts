// =============================================================================
// Sovereign Operator Console — Claude Code Integration Tests
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TaskRequest, TaskResult, TokenUsage } from '../../broker/src/types/index.js';

// ---------------------------------------------------------------------------
// Configuration limits
// ---------------------------------------------------------------------------

const MAX_TOKENS_PER_TASK = 50_000;
const MAX_TASKS_PER_SESSION = 20;
const DAILY_SPEND_THRESHOLD_USD = 25.0;
const TASK_TIMEOUT_MS = 120_000;

// Rough cost model: $3 per 1M input tokens, $15 per 1M output tokens
const COST_PER_INPUT_TOKEN = 3 / 1_000_000;
const COST_PER_OUTPUT_TOKEN = 15 / 1_000_000;

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

let sessionTaskCounts: Map<string, number>;
let dailySpend: number;
let alerts: string[];
let tokenUsageLog: TokenUsage[];
let spawnedProcesses: Array<{ command: string; args: string[]; killed: boolean }>;

// ---------------------------------------------------------------------------
// Stub services
// ---------------------------------------------------------------------------

function countTokens(text: string): number {
  // Rough approximation: ~4 chars per token
  return Math.ceil(text.length / 4);
}

function assembleContext(
  files: string[],
  tokenBudget: number,
  redact: boolean,
): { context: string; tokenCount: number; filesIncluded: string[] } {
  const fileContents: Record<string, string> = {
    'src/index.ts': 'import { app } from "./app";\napp.listen(3000);\n',
    'src/config.ts': 'export const API_KEY = "sk-proj-abc123def456ghi789";\n',
    'src/app.ts': 'export const app = { listen: (port: number) => console.log(`Listening on ${port}`) };\n',
    'src/utils.ts': 'export function add(a: number, b: number) { return a + b; }\n'.repeat(100),
  };

  let context = '';
  let tokenCount = 0;
  const filesIncluded: string[] = [];

  for (const file of files) {
    let content = fileContents[file] ?? '';

    if (redact) {
      content = content.replace(/sk-(?:proj-|live-|test-)[a-zA-Z0-9]+/g, '[REDACTED:api_key]');
    }

    const fileTokens = countTokens(content);
    if (tokenCount + fileTokens > tokenBudget) {
      break; // respect token budget
    }

    context += `--- ${file} ---\n${content}\n`;
    tokenCount += fileTokens;
    filesIncluded.push(file);
  }

  return { context, tokenCount, filesIncluded };
}

function submitTask(
  sessionId: string,
  request: TaskRequest,
): { result: TaskResult | null; error?: string; alert?: string } {
  // Check session task count
  const taskCount = sessionTaskCounts.get(sessionId) ?? 0;
  if (taskCount >= MAX_TASKS_PER_SESSION) {
    return { result: null, error: 'session_task_limit_exceeded' };
  }

  // Count tokens in prompt
  const promptTokens = countTokens(request.prompt);
  const contextTokens = request.context_files
    ? assembleContext(request.context_files, MAX_TOKENS_PER_TASK, true).tokenCount
    : 0;

  const totalTokens = promptTokens + contextTokens;
  if (totalTokens > MAX_TOKENS_PER_TASK) {
    return { result: null, error: 'token_limit_exceeded' };
  }

  // Simulate spawning subprocess
  const proc = {
    command: 'claude',
    args: ['--task', request.prompt, '--project', request.project_path],
    killed: false,
  };
  spawnedProcesses.push(proc);

  // Simulate result
  const outputTokens = Math.floor(promptTokens * 0.5);
  const result: TaskResult = {
    id: `task-${Date.now()}`,
    status: 'completed',
    output: 'Task completed successfully. Modified 2 files.',
    error: null,
    files_modified: ['src/index.ts', 'src/config.ts'],
    tokens_used: { input: totalTokens, output: outputTokens },
    started_at: new Date(),
    completed_at: new Date(),
  };

  // Track usage
  sessionTaskCounts.set(sessionId, taskCount + 1);

  const cost = totalTokens * COST_PER_INPUT_TOKEN + outputTokens * COST_PER_OUTPUT_TOKEN;
  dailySpend += cost;

  tokenUsageLog.push({
    id: `usage-${Date.now()}`,
    session_id: sessionId,
    task_id: result.id,
    input_tokens: totalTokens,
    output_tokens: outputTokens,
    model: 'claude-sonnet-4-20250514',
    timestamp: new Date(),
  });

  let alert: string | undefined;
  if (dailySpend >= DAILY_SPEND_THRESHOLD_USD) {
    alert = `daily_spend_threshold_reached: $${dailySpend.toFixed(2)}`;
    alerts.push(alert);
  }

  return { result, alert };
}

function simulateTimeout(
  sessionId: string,
  request: TaskRequest,
): { result: TaskResult; timedOut: boolean } {
  const proc = {
    command: 'claude',
    args: ['--task', request.prompt],
    killed: false,
  };
  spawnedProcesses.push(proc);

  // Simulate timeout
  proc.killed = true;

  return {
    result: {
      id: `task-${Date.now()}`,
      status: 'failed',
      output: null,
      error: `Task timed out after ${TASK_TIMEOUT_MS}ms`,
      files_modified: [],
      tokens_used: { input: 0, output: 0 },
      started_at: new Date(),
      completed_at: new Date(),
    },
    timedOut: true,
  };
}

function parseStructuredOutput(raw: string): {
  parsed: boolean;
  summary?: string;
  filesModified?: string[];
} {
  try {
    const parsed = JSON.parse(raw);
    return {
      parsed: true,
      summary: parsed.summary,
      filesModified: parsed.files_modified,
    };
  } catch {
    return { parsed: false };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Claude Integration — Task Execution', () => {
  beforeEach(() => {
    sessionTaskCounts = new Map();
    dailySpend = 0;
    alerts = [];
    tokenUsageLog = [];
    spawnedProcesses = [];
  });

  it('spawns subprocess for task execution', () => {
    const { result } = submitTask('sess-001', {
      prompt: 'Add error handling to the API routes',
      project_path: '/home/user/projects/myapp',
    });

    expect(result).not.toBeNull();
    expect(spawnedProcesses.length).toBe(1);
    expect(spawnedProcesses[0].command).toBe('claude');
    expect(spawnedProcesses[0].args).toContain('--project');
  });

  it('checks token count before submission', () => {
    const shortPrompt = 'Fix the bug';
    const tokens = countTokens(shortPrompt);
    expect(tokens).toBeLessThan(MAX_TOKENS_PER_TASK);

    const { result, error } = submitTask('sess-001', {
      prompt: shortPrompt,
      project_path: '/home/user/projects/myapp',
    });

    expect(error).toBeUndefined();
    expect(result).not.toBeNull();
  });

  it('rejects task when over token limit', () => {
    // Create a prompt that exceeds the token limit
    const hugePrompt = 'x'.repeat(MAX_TOKENS_PER_TASK * 5);

    const { result, error } = submitTask('sess-001', {
      prompt: hugePrompt,
      project_path: '/home/user/projects/myapp',
    });

    expect(error).toBe('token_limit_exceeded');
    expect(result).toBeNull();
  });

  it('enforces session task count limit', () => {
    for (let i = 0; i < MAX_TASKS_PER_SESSION; i++) {
      const { error } = submitTask('sess-001', {
        prompt: `Task ${i + 1}`,
        project_path: '/home/user/projects/myapp',
      });
      expect(error).toBeUndefined();
    }

    // Next task should be rejected
    const { result, error } = submitTask('sess-001', {
      prompt: 'One more task',
      project_path: '/home/user/projects/myapp',
    });

    expect(error).toBe('session_task_limit_exceeded');
    expect(result).toBeNull();
  });

  it('triggers alert when daily spend threshold is reached', () => {
    // Submit enough tasks to exceed the daily threshold
    // Each task costs roughly: (prompt_tokens * $3/M) + (output_tokens * $15/M)
    // We'll force high spend by submitting many tasks
    dailySpend = DAILY_SPEND_THRESHOLD_USD - 0.01; // just under threshold

    const { alert } = submitTask('sess-high-spend', {
      prompt: 'Some task',
      project_path: '/home/user/projects/myapp',
    });

    expect(alert).toBeDefined();
    expect(alert).toContain('daily_spend_threshold_reached');
    expect(alerts.length).toBeGreaterThan(0);
  });
});

describe('Claude Integration — Context Assembly', () => {
  it('includes relevant files in context', () => {
    const { context, filesIncluded } = assembleContext(
      ['src/index.ts', 'src/config.ts'],
      MAX_TOKENS_PER_TASK,
      false,
    );

    expect(filesIncluded).toContain('src/index.ts');
    expect(filesIncluded).toContain('src/config.ts');
    expect(context).toContain('--- src/index.ts ---');
  });

  it('respects token budget', () => {
    const { filesIncluded, tokenCount } = assembleContext(
      ['src/index.ts', 'src/config.ts', 'src/app.ts', 'src/utils.ts'],
      100, // very small budget
      false,
    );

    expect(tokenCount).toBeLessThanOrEqual(100);
    // Should have excluded some files due to budget
    expect(filesIncluded.length).toBeLessThan(4);
  });

  it('applies redaction to context', () => {
    const { context } = assembleContext(
      ['src/config.ts'],
      MAX_TOKENS_PER_TASK,
      true,
    );

    expect(context).not.toContain('sk-proj-abc123def456ghi789');
    expect(context).toContain('[REDACTED:api_key]');
  });
});

describe('Claude Integration — Timeout and Output', () => {
  beforeEach(() => {
    spawnedProcesses = [];
  });

  it('handles task timeout', () => {
    const { result, timedOut } = simulateTimeout('sess-001', {
      prompt: 'Long running task',
      project_path: '/home/user/projects/myapp',
    });

    expect(timedOut).toBe(true);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('timed out');
    expect(spawnedProcesses[0].killed).toBe(true);
  });

  it('parses structured JSON output', () => {
    const rawOutput = JSON.stringify({
      summary: 'Added error handling to 3 routes',
      files_modified: ['src/routes/users.ts', 'src/routes/posts.ts', 'src/middleware/error.ts'],
    });

    const parsed = parseStructuredOutput(rawOutput);
    expect(parsed.parsed).toBe(true);
    expect(parsed.summary).toBe('Added error handling to 3 routes');
    expect(parsed.filesModified).toHaveLength(3);
  });

  it('handles non-JSON output gracefully', () => {
    const rawOutput = 'This is plain text output from Claude';
    const parsed = parseStructuredOutput(rawOutput);
    expect(parsed.parsed).toBe(false);
  });
});
