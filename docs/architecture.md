# Distributed Claude Agents - Architecture

## System Overview

```
+------------------+     +--------------------+     +------------------+
|   Control UI     |<--->|   Orchestrator     |<--->|   Agent Workers  |
|   (React/Vite)   |     |   (Express API)    |     |   (7 roles)      |
|   localhost:3000  |     |   localhost:3001   |     |                  |
+------------------+     +--------------------+     +------------------+
        |                       |    |                      |
        | HTTP/WS               |    |                      |
        +------- proxy -------->|    |                      |
                                |    |                      |
                          +-----+    +------+               |
                          |                 |               |
                    +----------+      +-----------+         |
                    | Postgres |      |   Redis   |         |
                    |  (state) |      | (pub/sub) |         |
                    +----------+      +-----------+         |
                          |                 |               |
                          +----- shared ----+---- shared ---+
```

## Components

### Control UI (apps/control-ui)
- React + Vite single-page application
- WebSocket connection for live updates
- Simple Mode: task input + progress + results
- Advanced Mode: full logs, diffs, approvals, event stream
- Accessible: keyboard navigation, ARIA labels, high-contrast mode, screen reader support

### Orchestrator (services/orchestrator)
- Express.js REST API + WebSocket server
- Task decomposition: breaks user requests into plans with 3-7 steps
- Task routing: assigns subtasks to agents by role
- Event coordination: listens for agent updates, merges results
- Result generation: builds Result Packet when all subtasks complete

### Agent Workers (services/agents)
- 7 specialized agents running concurrently
- Each agent subscribes to `subtask:created` events for its role
- Agents use safe-tools for all operations (no direct shell/fs calls)
- Agents report back via Redis pub/sub events

### Shared Memory (services/memory)
- PostgreSQL database with structured tables
- Tables: tasks, subtasks, agent_messages, file_changes, command_ledger, decision_log, events
- MemoryStore class provides typed CRUD operations

### Event Bus
- Redis pub/sub for real-time agent coordination
- Channels: subtask:created, subtask:update, subtask:complete, approval:needed, risk:flagged
- In-process fallback available for simpler deployments

### Safe Tools (services/tools)
- SafeShell: command execution with allowlist, risk assessment, output redaction
- SafeFileSystem: file operations sandboxed to workspace root, automatic backups
- SafeGit: git operations through SafeShell wrapper
- TestRunner: auto-detect test framework and run tests
- RiskAssessor: classifies operations as SAFE, CAUTION, or DANGEROUS

## Agent Roles

| Role | Description | Risk Level |
|------|-------------|-----------|
| Product Manager | Translates requests into requirements | SAFE |
| Security | Reviews for security implications | SAFE |
| Architect | Designs solution structure | SAFE |
| Implementer | Writes code and makes changes | Varies |
| QA/Tester | Runs tests and verifies behavior | SAFE |
| Docs/Trainer | Generates documentation and summaries | SAFE |
| Performance | Monitors metrics and reliability | SAFE |

## Data Flow

1. User submits task via Control UI
2. UI sends POST /api/tasks to Orchestrator
3. Orchestrator decomposes request into plan (3-7 steps)
4. Orchestrator creates subtasks and publishes `subtask:created` events
5. Agents pick up subtasks matching their role
6. Agents execute using safe-tools, report progress via events
7. Orchestrator tracks completion, resolves dependencies
8. When all subtasks done, Orchestrator generates Result Packet
9. UI receives updates via WebSocket, displays results

## Risk and Approval Model

```
SAFE        --> Auto-proceed (read-only, generate files, run tests)
CAUTION     --> One-click approval in UI (install deps, rename files)
DANGEROUS   --> Typed confirmation + auto-backup + restore plan (delete, format)
```

## Security Boundaries

- All file operations sandboxed to workspace root
- Shell commands filtered through allowlist
- Secrets redacted from logs (passwords, tokens, API keys)
- Path traversal prevention (no `..` outside workspace)
- Agents run with least-privilege access
- No external network calls by default
