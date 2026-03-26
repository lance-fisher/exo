# Context Injection Strategy

## Overview

Context injection is the process by which the local agent assembles relevant project information and injects it into each Claude Code task invocation. Because each task is a stateless subprocess, the quality of the injected context directly determines Claude Code's effectiveness.

## Pipeline

```
Project Manifest → File Discovery → Relevance Scoring → Token Budget Allocation
    → Content Assembly → Redaction Pass → Prompt Construction → Submission
```

## Step 1: Project Manifest

Each project has a manifest file at its root: `sovereign-console.manifest.json`.

```json
{
  "project": "sovereign-console",
  "description": "Single-operator remote admin console with Claude Code integration",
  "rootDir": "C:\\Users\\lance\\projects\\sovereign-console",
  "structure": {
    "src/broker": "Fastify broker API and WebSocket server",
    "src/agent": "Local agent, Windows service, Claude Code invocation",
    "src/console-ui": "Next.js console frontend",
    "src/shared": "Shared types, utilities, constants",
    "docs": "Architecture and operational documentation",
    "config": "Configuration files (secrets excluded)",
    "scripts": "Build, deploy, and maintenance scripts"
  },
  "keyFiles": [
    { "path": "src/broker/server.ts", "role": "Broker entry point" },
    { "path": "src/broker/routes/tasks.ts", "role": "Task submission and retrieval API" },
    { "path": "src/broker/routes/auth.ts", "role": "WebAuthn and session endpoints" },
    { "path": "src/broker/ws/agent-relay.ts", "role": "Agent WebSocket connection handler" },
    { "path": "src/agent/agent.ts", "role": "Agent entry point" },
    { "path": "src/agent/task-executor.ts", "role": "Claude Code subprocess management" },
    { "path": "src/agent/context-assembler.ts", "role": "Context injection pipeline" },
    { "path": "src/shared/types.ts", "role": "Shared TypeScript interfaces" }
  ],
  "excludePatterns": [
    "node_modules/**",
    "dist/**",
    ".git/**",
    "*.secret.*",
    ".env*",
    "*.pem",
    "*.key",
    "config/secrets/**"
  ],
  "tokenBudget": {
    "default": 50000,
    "perFile": 5000,
    "projectStructure": 2000,
    "taskHistory": 3000,
    "constraints": 500
  }
}
```

The manifest is maintained by the operator and version-controlled. The agent reads it at startup and on each task invocation (to pick up changes without restart).

## Step 2: File Discovery

The agent builds a file index of the project:

```typescript
interface FileEntry {
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
  lastModified: Date;
  extension: string;
  directory: string;
  estimatedTokens: number;  // ~4 chars per token heuristic
}
```

**Discovery rules:**
1. Walk the project directory tree.
2. Exclude paths matching `excludePatterns` from the manifest.
3. Exclude binary files (images, compiled artifacts, archives).
4. Exclude files larger than 100KB (likely generated or data files).
5. Index remaining files with metadata.

**Caching:** The file index is cached for 60 seconds. If a task arrives within the cache window, the cached index is used. This avoids repeated filesystem walks for rapid task sequences.

## Step 3: Relevance Scoring

Each file receives a relevance score (0.0 to 1.0) based on the task description.

### Scoring Signals

| Signal | Weight | Description |
|---|---|---|
| **Keyword match** | 0.3 | Task description tokens that appear in the file path or first 50 lines |
| **Key file designation** | 0.25 | File is listed in manifest's `keyFiles` array |
| **Directory match** | 0.2 | File is in a directory mentioned or implied by the task |
| **Recency** | 0.15 | Recently modified files are more likely relevant |
| **Extension match** | 0.1 | File extension matches the probable domain (e.g., `.ts` for TypeScript tasks) |

### Scoring Algorithm

```typescript
function scoreFile(file: FileEntry, task: string, manifest: Manifest): number {
  let score = 0;

  // Keyword matching
  const taskTokens = tokenize(task.toLowerCase());
  const pathTokens = tokenize(file.relativePath.toLowerCase());
  const keywordOverlap = intersect(taskTokens, pathTokens).length / taskTokens.length;
  score += keywordOverlap * 0.3;

  // Key file bonus
  if (manifest.keyFiles.some(kf => kf.path === file.relativePath)) {
    score += 0.25;
  }

  // Directory relevance
  const taskDirs = extractDirectoryHints(task, manifest.structure);
  if (taskDirs.some(dir => file.relativePath.startsWith(dir))) {
    score += 0.2;
  }

  // Recency (files modified in last 24h get full weight, decays over 7 days)
  const hoursAgo = (Date.now() - file.lastModified.getTime()) / 3600000;
  score += Math.max(0, 1 - hoursAgo / 168) * 0.15;

  // Extension match
  const taskExtensions = inferExtensions(task);
  if (taskExtensions.includes(file.extension)) {
    score += 0.1;
  }

  return Math.min(1.0, score);
}
```

### Explicit Mentions

If the task explicitly mentions a file path (e.g., "fix the bug in src/broker/routes/tasks.ts"), that file is automatically scored at 1.0 regardless of other signals.

## Step 4: Token Budget Allocation

The total token budget (default 50,000) is divided:

| Allocation | Default Budget | Purpose |
|---|---|---|
| Project structure | 2,000 tokens | Directory tree, file listing |
| Key files (always included) | Up to 15,000 tokens | Core files from manifest |
| Scored files | Remaining budget | Files ranked by relevance score |
| Task history | 3,000 tokens | Recent task summaries (if enabled) |
| Constraints + instructions | 500 tokens | Safety constraints, working directory |

### File Truncation

If a file exceeds its allocated budget:

1. Include the first N lines that fit within the budget.
2. Append: `[... truncated, {remaining_lines} lines omitted ...]`
3. Prefer truncating low-scored files before high-scored ones.

### Budget Overflow

If total relevant content exceeds the budget:

1. Sort files by relevance score descending.
2. Include files greedily until budget is exhausted.
3. Files that don't fit are listed by path only (no content) in a "Additional files in project" section.

## Step 5: Content Assembly

The assembled context document follows this structure:

```markdown
# Project Context: sovereign-console

## Project Structure
```
src/
  broker/
    server.ts          - Broker entry point
    routes/
      tasks.ts         - Task submission and retrieval API
      auth.ts          - WebAuthn and session endpoints
    ws/
      agent-relay.ts   - Agent WebSocket connection handler
  agent/
    agent.ts           - Agent entry point
    task-executor.ts   - Claude Code subprocess management
    context-assembler.ts - Context injection pipeline
  console-ui/
    ...
  shared/
    types.ts           - Shared TypeScript interfaces
```

## File: src/broker/routes/tasks.ts
[Role: Task submission and retrieval API]
```typescript
[file contents]
```

## File: src/agent/task-executor.ts
[Role: Claude Code subprocess management]
```typescript
[file contents]
```

[... additional files ...]

## Recent Task History
1. [2 min ago] Updated task validation schema in tasks.ts — added resource_path field
2. [15 min ago] Fixed WebSocket reconnection logic in agent-relay.ts — added exponential backoff

## Additional Files (not included in context)
- src/broker/middleware/rate-limit.ts
- src/console-ui/components/TaskList.tsx
- [... paths only ...]
```

## Step 6: Redaction Pass

Before inclusion in the prompt, all file contents are scanned for secrets:

### Patterns Scanned

| Pattern | Example | Action |
|---|---|---|
| API keys | `sk-ant-...`, `AKIA...` | Replace with `[REDACTED_API_KEY]` |
| Passwords | `password = "..."` in config files | Replace value with `[REDACTED_PASSWORD]` |
| Private keys | `-----BEGIN PRIVATE KEY-----` | Replace entire block with `[REDACTED_PRIVATE_KEY]` |
| Connection strings | `postgresql://user:pass@host` | Redact password portion |
| JWT tokens | `eyJ...` (base64 with dots) | Replace with `[REDACTED_TOKEN]` |
| Bearer tokens | `Bearer ...` | Replace token value |

### Redaction Rules

1. Redaction is conservative — false positives are acceptable (better to over-redact than leak).
2. Redacted content is never logged, even in debug mode.
3. A count of redactions is logged per file for monitoring.
4. If a file has more than 10 redactions, it is excluded entirely with a note: `[File excluded: excessive secret density]`.

## Step 7: Prompt Construction

The final prompt sent to `claude --print`:

```
[Assembled context document from Step 5]

---

## Task

[Operator's task description, verbatim]

## Constraints

- Working directory: C:\Users\lance\projects\sovereign-console
- Only modify files within this project directory.
- Do not execute commands that access the network.
- Do not read, modify, or output contents of: .env files, *.secret.*, *.pem, *.key, config/secrets/*
- If you need information from a file not in the provided context, use your file reading tools.
- Prefer minimal, targeted changes over broad refactors unless explicitly asked.
```

## Configuration

All parameters are configurable in the agent config file:

```json
{
  "contextInjection": {
    "tokenBudget": 50000,
    "perFileBudget": 5000,
    "projectStructureBudget": 2000,
    "taskHistoryBudget": 3000,
    "constraintsBudget": 500,
    "fileSizeLimit": 102400,
    "cacheSeconds": 60,
    "maxRedactionsPerFile": 10,
    "taskHistoryEntries": 5,
    "relevanceThreshold": 0.1
  }
}
```

Files scoring below `relevanceThreshold` are excluded from content inclusion (but still listed by path in the "Additional files" section).
