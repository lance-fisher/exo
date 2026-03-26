# Claude Code Integration Design

## Overview

The local agent invokes Claude Code as a subprocess for each task. This document specifies the invocation mechanism, context injection strategy, token cost controls, and error handling.

## Subprocess Invocation

### CLI Command

```bash
claude --print \
  --max-turns 25 \
  --model claude-sonnet-4-20250514 \
  "<<TASK_PROMPT>>"
```

- `--print`: Non-interactive mode. Claude processes the input and prints the result to stdout. No interactive prompts, no TUI.
- `--max-turns`: Caps the number of tool-use turns to prevent runaway loops. Default 25, configurable per task type.
- `--model`: Explicitly pin the model. Do not rely on defaults.

### Process Management

```typescript
interface TaskExecution {
  // Spawn configuration
  command: 'claude';
  args: ['--print', '--max-turns', '25', '--model', 'claude-sonnet-4-20250514', taskPrompt];
  cwd: projectDirectory;        // Working directory set to the project root
  timeout: 300_000;              // 5 minutes default (ms)
  maxOutputSize: 102_400;        // 100KB stdout capture limit
  maxStderrSize: 10_240;         // 10KB stderr capture limit

  // Environment
  env: {
    PATH: agentPath,             // Include claude CLI location
    HOME: agentHome,
    ANTHROPIC_API_KEY: apiKey,   // Injected from secure config, never logged
    // No CLAUDE_CONFIG — use defaults for clean state
  };
}
```

### Execution Lifecycle

```
1. Agent receives task from broker via WebSocket
2. Agent validates task structure and permissions
3. Agent assembles context (see Context Injection below)
4. Agent constructs task prompt with injected context
5. Agent spawns claude subprocess
6. Agent streams stdout/stderr to buffers
7. On process exit:
   - Exit code 0: Parse stdout as task result
   - Exit code non-zero: Capture stderr as error detail
   - Timeout: Kill process (SIGTERM → 5s → SIGKILL), report timeout error
8. Agent sends result to broker
9. Agent cleans up temp files, if any
```

### Error Classification

| Exit Code | Meaning | Agent Action |
|---|---|---|
| 0 | Success | Return result to broker |
| 1 | General error | Return error with stderr to broker |
| 2 | Invalid arguments | Log config error, notify operator |
| 124/137 | Timeout/killed | Report timeout to broker |
| Other non-zero | Unexpected failure | Log full details, return generic error |

## Context Injection Strategy

See [CONTEXT_INJECTION.md](CONTEXT_INJECTION.md) for the detailed context assembly pipeline.

### Summary

The agent reads a project manifest (`sovereign-console.manifest.json`) that describes the project structure, key files, and their roles. Based on the task description, the agent:

1. Scores files for relevance to the current task
2. Allocates a token budget across relevant files
3. Assembles a context document with file contents
4. Runs a redaction pass to strip secrets
5. Prepends the context to the task prompt

### Task Prompt Structure

```
<system_context>
## Project: sovereign-console
## Task Context

### Project Structure
[directory tree, truncated to relevant subtrees]

### Relevant Files
[file contents, scored and budget-allocated]

### Recent Task History (optional)
[summaries of last N tasks for continuity]
</system_context>

## Task
[Operator's task description]

## Constraints
- Working directory: /path/to/project
- Do not modify files outside the project directory
- Do not execute commands that require network access
- Do not read or modify .env files or files matching *.secret.*
```

## Token Cost Controls

### Per-Task Input Cap

- **Default**: 50,000 tokens input context
- **Configurable**: Via agent config file, per-project or per-task-type overrides
- **Enforcement**: Context assembly pipeline truncates to budget. If the task description itself exceeds the cap, it is rejected.

### Session Task Limit

- **Default**: 20 tasks per session
- **Enforcement**: Broker tracks tasks per session. After limit, session must be refreshed (re-auth).
- **Configurable**: Via broker config.

### Daily Spend Threshold

- **Default**: Configurable dollar amount (e.g., $10/day)
- **Tracking**: Agent tracks estimated token usage per task. Broker aggregates daily totals.
- **Enforcement**: When threshold is reached, new tasks are blocked until the next day or until the operator manually overrides (with step-up auth).
- **Estimation**: Based on token counts from Claude CLI output or estimated from context size + typical output ratio.

### Rate Limiting

- **Max concurrent tasks**: 5 simultaneous subprocess invocations
- **Enforcement**: Agent maintains a semaphore. Tasks beyond the limit are queued locally (FIFO).
- **Backpressure**: If local queue exceeds 10 tasks, agent reports backpressure to broker, which informs the operator.

### Cost Estimation

```typescript
interface TokenEstimate {
  inputTokens: number;      // From context size
  estimatedOutputTokens: number;  // Heuristic: min(inputTokens * 0.5, 4096)
  estimatedCost: number;    // Based on current model pricing
}
```

The agent logs token estimates per task. Actual token usage is captured from Claude CLI output when available.

## Stateless by Default

Each task invocation is stateless — no conversation history is carried between subprocess invocations.

### Optional Session Continuity

For multi-step workflows where context continuity is valuable:

1. Agent maintains a `task_history` buffer (in memory, per project).
2. After each task completes, agent generates a brief summary (1-2 sentences) of what was done.
3. On subsequent tasks, the last N summaries (default: 5) are included in the context under "Recent Task History."
4. This provides lightweight continuity without the fragility of a persistent session.

```typescript
interface TaskHistoryEntry {
  taskId: string;
  timestamp: string;
  summary: string;        // 1-2 sentence summary of task and outcome
  filesModified: string[]; // List of files touched
}
```

### When Full Continuity Is Needed

If a task explicitly requires detailed context from a previous task (e.g., "continue the refactoring from task X"):

1. Agent retrieves the full output of the referenced task from the broker.
2. Agent includes it in the context (within token budget).
3. This is an explicit operator action, not automatic.

## Security Constraints

### File Access Scoping

The Claude Code subprocess runs in the project directory and has access to the filesystem. The agent enforces:

- **Allowed directories**: Only project directories listed in the agent config.
- **Blocked paths**: `.env`, `*.secret.*`, `*.key`, `*.pem`, `credentials.*`, `config/secrets/*` — these are excluded from context injection. Claude Code may still access them during execution; the agent validates file operations post-hoc via audit.
- **No network commands**: Task constraints instruct Claude to avoid network operations.

### API Key Protection

- `ANTHROPIC_API_KEY` is injected via environment variable, never in command-line arguments (visible in process listings).
- The key is loaded from an encrypted config file or OS credential store.
- Key is never logged, never included in context, never sent to the broker.

### Output Sanitization

Before returning results to the broker, the agent:

1. Scans output for patterns matching secrets (API keys, passwords, tokens).
2. Redacts matches with `[REDACTED]`.
3. Logs the redaction event (but not the redacted content).
