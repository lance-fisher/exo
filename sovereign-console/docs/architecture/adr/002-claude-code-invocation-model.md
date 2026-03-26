# ADR-002: Claude Code Invocation Model — Subprocess Per Task

## Status

**Accepted**

## Context

The local agent must invoke Claude Code to execute tasks on the Windows workstation. Claude Code is available as a CLI tool (`claude`) that supports both interactive and non-interactive modes. We need to decide how the agent invokes Claude Code for each task.

Three options were evaluated:

### Option A: Subprocess Per Task

Spawn a new `claude --print` process for each incoming task. The agent assembles context, passes it as input, captures stdout/stderr and exit code, then terminates the process.

**Pros:**
- Each task gets a clean, isolated environment
- No state leakage between tasks
- Process lifecycle is explicit and controllable
- A hung or stuck task can be killed without affecting the agent
- `--print` flag provides non-interactive output suitable for automation
- Full Claude Code toolchain (file read/write, search, etc.) is available
- Simple error handling: non-zero exit = failure
- Resource usage is bounded per task

**Cons:**
- Process startup overhead per task (~1-3 seconds)
- No conversation continuity between tasks (must re-inject context each time)
- Higher token usage since context must be provided each time

### Option B: Long-Running Interactive Session

Maintain a persistent `claude` interactive session via stdin/stdout pipes. Send tasks as messages, parse responses from the output stream.

**Pros:**
- Conversation continuity — Claude remembers previous context within the session
- Lower per-task token cost (context carries forward)
- No process startup overhead after initial launch

**Cons:**
- **Session fragility**: The interactive CLI is designed for human use. It can prompt for confirmations, display spinners, emit ANSI escape codes, and behave unpredictably when driven programmatically.
- **State accumulation**: Context window fills over time, leading to degraded performance or context overflow errors.
- **Parsing complexity**: Must reliably parse structured responses from a stream that includes tool use output, progress indicators, and error messages — none of which have a stable machine-readable format.
- **Hung session recovery**: If the session hangs, all queued tasks are blocked. Recovery requires killing the process and losing session state.
- **Unpredictable memory growth**: Long sessions accumulate memory. No built-in mechanism to bound it.
- **No stable API contract**: The interactive output format is not a documented API. It can change between CLI versions.

### Option C: Claude API Direct (Bypass CLI)

Call the Anthropic API directly from the agent, bypassing the `claude` CLI entirely.

**Pros:**
- Full control over request/response format
- No CLI dependency
- Can use structured tool_use API for file operations

**Cons:**
- **Loses Claude Code toolchain**: The `claude` CLI provides file editing, search, shell execution, and other tools that are implemented in the CLI, not in the raw API. Reimplementing these is a massive effort.
- **Tool orchestration burden**: Must implement the entire tool-use loop (tool calls, tool results, multi-turn) manually.
- **Version coupling**: Must track API version changes, model availability, and feature flags.
- **No benefit for this use case**: The CLI already wraps the API and adds substantial value through its tool implementations.

## Decision

**Option A: Subprocess Per Task.**

Each task is executed by spawning a new `claude --print` process. The agent:

1. Assembles context from the project manifest and relevant files
2. Constructs the invocation: `claude --print` with context injected via stdin or `--context` flag
3. Spawns the process with resource limits (timeout, max output size)
4. Captures stdout (task result), stderr (diagnostics), and exit code
5. Terminates the process after completion or timeout
6. Returns the result to the broker

### Invocation Pattern

```
claude --print \
  --max-turns 25 \
  --model claude-sonnet-4-20250514 \
  "Task description here"
```

Context is provided via the system prompt or prepended to the task description as structured context.

### Resource Controls

- **Process timeout**: 5 minutes default, configurable per task type
- **Output capture limit**: 100KB stdout, 10KB stderr
- **Concurrent tasks**: Max 5 simultaneous subprocess invocations
- **Kill on timeout**: Agent sends SIGTERM, waits 5 seconds, then SIGKILL (or Windows equivalent via `taskkill`)

## Consequences

### Positive

- **Predictable behavior**: Each task is independent. No accumulated state, no session corruption, no memory leaks.
- **Simple error model**: Process exits with code 0 (success) or non-zero (failure). Stderr contains diagnostics.
- **Clean security boundary**: Each process runs with the agent's permissions. No persistent process accumulating privileges or open file handles.
- **Easy to test**: Invoke the same command manually to reproduce any task.
- **Resilient**: A crashed subprocess does not crash the agent.

### Negative

- **Startup overhead**: ~1-3 seconds per task for process creation and CLI initialization. Acceptable for an operator console where tasks are human-initiated and measured in seconds-to-minutes.
- **No conversation memory**: Each task starts fresh. Mitigated by: agent injects relevant context, and optionally includes a summary of recent task history.
- **Higher token cost**: Re-injecting context per task uses more tokens than a persistent session. Mitigated by: intelligent context assembly that includes only relevant files, and configurable token budget caps.
