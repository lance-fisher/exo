# Security Model

## Threat Model

### Assets Protected
- User's filesystem (workspace directory and beyond)
- Credentials and secrets in the environment
- System integrity (no unintended system modifications)

### Threat Vectors and Mitigations

| Threat | Mitigation |
|--------|-----------|
| Arbitrary command execution | Shell allowlist + risk assessment |
| Path traversal (read/write outside workspace) | Workspace root enforcement, path validation |
| Secret leakage in logs | Automatic regex-based secret redaction |
| Destructive file operations | Mandatory backups + approval workflow |
| Dependency confusion attacks | Package installations require CAUTION approval |
| Agent misbehavior | All agents use safe-tools layer (no direct system access) |

## Risk Tiers

### SAFE (auto-proceed)
- Reading files within workspace
- Listing directories
- Running tests
- Git status/diff/log
- Generating new files

### CAUTION (one-click approval)
- Installing dependencies (npm install, pip install)
- Moving or renaming files
- Git push/merge/rebase
- Configuration changes
- Any command not on the allowlist

### DANGEROUS (typed confirmation + backup)
- Deleting files or directories
- Operations outside workspace root
- Commands involving sudo/root
- Credential or secret manipulation
- Destructive git operations (force push, reset)

## Safe Tools Layer

Every agent MUST use the safe-tools layer for all operations:

1. **SafeShell** - Wraps command execution with:
   - Allowlist checking
   - Risk assessment before execution
   - Output truncation (prevents memory exhaustion)
   - Secret redaction in output
   - Workspace directory enforcement

2. **SafeFileSystem** - Wraps file operations with:
   - Path validation (must be within workspace root)
   - Automatic backup before modification
   - Diff generation for all changes
   - Approval gating for risky operations

3. **SafeGit** - Wraps git through SafeShell:
   - Read operations are always allowed
   - Write operations (commit, push) require approval

## Secret Redaction

The following patterns are automatically redacted from all logs and outputs:
- `password=...`
- `secret=...`
- `api_key=...`
- `token=...`
- `Bearer ...`
- Private key blocks
- AWS credentials

## Principle of Least Privilege

- Agents run as non-root users in containers
- Each agent only has access to tools needed for its role
- No agent can directly access the database or Redis
- All inter-agent communication goes through the event bus
